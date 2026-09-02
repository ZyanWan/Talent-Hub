// =====================================================================
// 简历工作台（src/views/ResumeWorkspace.tsx）渲染与交互测试（jsdom）。
// 覆盖：本地 PDF 预览（multipart + scale 与页面 img 渲染）、缓存命中不
// 重复请求、切换文件中止旧请求、已存 PDF 预览（不缓存）、本地/已存图片
// Blob 预览（createObjectURL / revokeObjectURL）、错误态（非 PDF 本地
// 拦截 / 415 / 503 detail 透传）、上一个/下一个导航与禁用态、移除（含
// 移除最后一份关闭）、编辑类关闭行为（点遮罩不关闭，按钮与 ESC 关闭）、
// 添加文件去重。
// 仅做渲染级断言，不含截图验证（视觉回归由 tests/visual/baseline.spec.ts 覆盖）。
// =====================================================================

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResumeWorkspace, type StoredResumePreview } from "../../src/views/ResumeWorkspace";
import { state } from "../../src/state";

let fetchMock: ReturnType<typeof vi.fn>;
let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;

function pdfFile(name = "resume.pdf", lastModified = 1000): File {
  return new File(["%PDF-1.4"], name, { type: "application/pdf", lastModified });
}

function imageFile(name = "photo.png", lastModified = 2000): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "image/png", lastModified });
}

function docxFile(name = "notes.docx"): File {
  return new File(["hello"], name, {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    lastModified: 3000,
  });
}

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

function previewPayload(pages: { index: number; data: string }[] = [{ index: 1, data: "data:image/png;base64,AAA" }]) {
  return { page_count: pages.length, pages };
}

function expectedScale(): string {
  return `?scale=${Math.min(4, 3 * (window.devicePixelRatio || 1))}`;
}

function renderWorkspace(props: Partial<Parameters<typeof ResumeWorkspace>[0]> = {}) {
  const onClose = vi.fn();
  const onFilesChanged = vi.fn();
  const view = render(<ResumeWorkspace open onClose={onClose} onFilesChanged={onFilesChanged} {...props} />);
  return { ...view, onClose, onFilesChanged };
}

beforeEach(() => {
  state.selectedResumes = [];
  state.resumeRenderCache.clear();
  state.language = "zh-CN";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  createObjectURL = vi.fn(() => "blob:mock-url");
  revokeObjectURL = vi.fn();
  URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  state.selectedResumes = [];
  state.resumeRenderCache.clear();
});

describe("本地 PDF 预览", () => {
  it("multipart 请求（file 字段 + scale）并渲染页面 img", async () => {
    state.selectedResumes = [pdfFile("a.pdf")];
    fetchMock.mockResolvedValue(
      jsonResponse(
        previewPayload([
          { index: 1, data: "data:image/png;base64,AAA" },
          { index: 2, data: "data:image/png;base64,BBB" },
        ])
      )
    );
    renderWorkspace();

    expect(await screen.findByRole("img", { name: "a.pdf - 1" })).toHaveAttribute("src", "data:image/png;base64,AAA");
    expect(screen.getByRole("img", { name: "a.pdf - 2" })).toHaveAttribute("src", "data:image/png;base64,BBB");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/resumes/preview${expectedScale()}`);
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("file")).toBe(state.selectedResumes[0]);
  });

  it("缓存命中不重复请求：导航回已渲染文件不再发请求", async () => {
    state.selectedResumes = [pdfFile("a.pdf", 1), pdfFile("b.pdf", 2), pdfFile("c.pdf", 3)];
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(previewPayload())));
    renderWorkspace();

    // 当前文件渲染 + 预取其余两个未缓存 PDF（顺序 a → b → c）
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([u]) => String(u).includes("/api/resumes/preview"))).toHaveLength(3)
    );
    expect(state.resumeRenderCache.size).toBe(3);

    fireEvent.click(screen.getByRole("button", { name: "下一份" }));
    fireEvent.click(screen.getByRole("button", { name: "下一份" }));
    fireEvent.click(screen.getByRole("button", { name: "上一份" }));
    await waitFor(() => expect(screen.getByText("2 / 3")).toBeInTheDocument());
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes("/api/resumes/preview"))).toHaveLength(3);
  });

  it("切换文件中止上一次未完成请求", () => {
    state.selectedResumes = [pdfFile("a.pdf", 1), pdfFile("b.pdf", 2)];
    fetchMock.mockImplementation(() => new Promise(() => { }));
    renderWorkspace();

    const firstSignal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    fireEvent.click(screen.getByRole("button", { name: "下一份" }));
    expect(firstSignal.aborted).toBe(true);
  });
});

describe("已存 PDF 预览（历史任务）", () => {
  it("GET /api/jobs/{id}/resumes/{filename}/preview 渲染页面且不缓存", async () => {
    const stored: StoredResumePreview = { jobId: "j1", filename: "b.pdf", candidateName: "张三" };
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse(previewPayload([{ index: 1, data: "data:image/png;base64,CCC" }])))
    );
    const { rerender, onClose } = renderWorkspace({ stored });

    expect(await screen.findByRole("img", { name: "b.pdf - 1" })).toHaveAttribute("src", "data:image/png;base64,CCC");
    expect(screen.getByRole("heading", { name: "张三" })).toBeInTheDocument();
    expect(screen.getAllByText("b.pdf").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole("button", { name: "下一份" })).toBeNull();
    expect(screen.queryByRole("button", { name: "添加简历" })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/jobs/j1/resumes/b.pdf/preview${expectedScale()}`);
    expect(state.resumeRenderCache.size).toBe(0);

    // 重新打开仍会重新请求（stored 预览不缓存）
    rerender(<ResumeWorkspace open={false} stored={stored} onClose={onClose} />);
    rerender(<ResumeWorkspace open stored={stored} onClose={onClose} />);
    await screen.findByRole("img", { name: "b.pdf - 1" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("图片预览（Blob）", () => {
  it("本地图片：createObjectURL 直接预览不发请求，关闭时 revoke", async () => {
    state.selectedResumes = [imageFile("photo.png")];
    const { rerender, onClose } = renderWorkspace();

    const img = await screen.findByRole("img", { name: "photo.png" });
    expect(img).toHaveAttribute("src", "blob:mock-url");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalledWith(state.selectedResumes[0]);

    rerender(<ResumeWorkspace open={false} onClose={onClose} />);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });

  it("已存图片：GET 原文件 Blob → createObjectURL，卸载时 revoke", async () => {
    const stored: StoredResumePreview = { jobId: "j1", filename: "c.png", candidateName: "李四" };
    fetchMock.mockResolvedValue(new Response(new Blob(["png-bytes"], { type: "image/png" })));
    const { unmount } = renderWorkspace({ stored });

    await screen.findByRole("img", { name: "c.png" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/jobs/j1/resumes/c.png");
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));

    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });
});

describe("错误态", () => {
  it("非 PDF 非图片本地文件：显示 previewUnavailable 文案，不发请求", async () => {
    state.selectedResumes = [docxFile()];
    renderWorkspace();

    expect(await screen.findByText("此文件格式暂不支持预览")).toBeInTheDocument();
    expect(screen.getByText("文件仍可正常用于筛选")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("后端 415：detail 透传为「仅支持 PDF 文件预览」", async () => {
    state.selectedResumes = [pdfFile("a.pdf")];
    fetchMock.mockResolvedValue(jsonResponse({ detail: "仅支持 PDF 文件预览" }, { status: 415 }));
    renderWorkspace();

    expect(await screen.findByText("仅支持 PDF 文件预览")).toBeInTheDocument();
    expect(screen.getByText("此文件格式暂不支持预览")).toBeInTheDocument();
  });

  it("pypdfium2 缺失（503）：显示服务端错误信息", async () => {
    state.selectedResumes = [pdfFile("a.pdf")];
    fetchMock.mockResolvedValue(jsonResponse({ detail: "PDF 渲染组件不可用" }, { status: 503 }));
    renderWorkspace();

    expect(await screen.findByText("PDF 渲染组件不可用")).toBeInTheDocument();
    expect(screen.getByText("此文件格式暂不支持预览")).toBeInTheDocument();
  });
});

describe("导航与移除", () => {
  it("上一个/下一个导航：位置计数与按钮禁用态", async () => {
    state.selectedResumes = [pdfFile("a.pdf", 1), pdfFile("b.pdf", 2), pdfFile("c.pdf", 3)];
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(previewPayload())));
    renderWorkspace();

    const prev = screen.getByRole("button", { name: "上一份" });
    const next = screen.getByRole("button", { name: "下一份" });
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
    expect(prev).toBeDisabled();
    expect(next).not.toBeDisabled();

    fireEvent.click(next);
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    expect(prev).not.toBeDisabled();

    fireEvent.click(next);
    expect(screen.getByText("3 / 3")).toBeInTheDocument();
    expect(next).toBeDisabled();

    fireEvent.click(prev);
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
  });

  it("移除文件：列表收缩、移除最后一份触发关闭", async () => {
    state.selectedResumes = [pdfFile("a.pdf", 1), pdfFile("b.pdf", 2)];
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(previewPayload())));
    const { onClose, onFilesChanged } = renderWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "移除 a.pdf" }));
    expect(screen.queryByRole("button", { name: "预览 a.pdf" })).toBeNull();
    expect(screen.getByRole("button", { name: "预览 b.pdf" })).toBeInTheDocument();
    expect(onFilesChanged).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "移除 b.pdf" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("关闭行为（编辑类）", () => {
  it("点遮罩不关闭；ESC 与关闭按钮关闭", async () => {
    state.selectedResumes = [pdfFile("a.pdf")];
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(previewPayload())));
    const { onClose, container } = renderWorkspace();
    await screen.findByRole("img", { name: "a.pdf - 1" });

    fireEvent.click(container.querySelector(".preview-backdrop")!);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "关闭简历工作台" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("添加文件（本地模式）", () => {
  it("经弹窗添加按钮追加文件并按 name:size:lastModified 去重", async () => {
    state.selectedResumes = [pdfFile("a.pdf", 1)];
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(previewPayload())));
    const { onFilesChanged } = renderWorkspace();
    await screen.findByRole("img", { name: "a.pdf - 1" });

    const input = document.getElementById("resumeWorkspaceFiles") as HTMLInputElement;
    expect(input).not.toBeNull();
    fireEvent.change(input, { target: { files: [pdfFile("b.pdf", 2), pdfFile("a.pdf", 1)] } });

    expect(screen.getByRole("button", { name: "预览 b.pdf" })).toBeInTheDocument();
    expect(state.selectedResumes).toHaveLength(2);
    expect(onFilesChanged).toHaveBeenCalledTimes(1);
  });
});
