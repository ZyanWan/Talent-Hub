import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { state } from "../../src/state";
import { ResumeWorkspace, type StoredResumePreview } from "../../src/views/ResumeWorkspace";

let fetchMock: ReturnType<typeof vi.fn>;
let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;

function file(name: string, type: string, lastModified = 1) {
  return new File(["content"], name, { type, lastModified });
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}

function renderWorkspace(props: Partial<Parameters<typeof ResumeWorkspace>[0]> = {}) {
  const onClose = vi.fn();
  const view = render(<ResumeWorkspace open onClose={onClose} {...props} />);
  return { ...view, onClose };
}

beforeEach(() => {
  state.selectedResumes = [];
  state.resumeRenderCache.clear();
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

describe("简历文件预览", () => {
  it("本地 PDF 通过 multipart 渲染服务生成页面", async () => {
    state.selectedResumes = [file("a.pdf", "application/pdf")];
    fetchMock.mockResolvedValue(jsonResponse({
      page_count: 1,
      pages: [{ index: 1, data: "data:image/png;base64,AAA" }],
    }));
    renderWorkspace();

    expect(await screen.findByRole("img", { name: "a.pdf - 1" })).toHaveAttribute("src", "data:image/png;base64,AAA");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/^\/api\/resumes\/preview\?scale=/);
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
  });

  it("切换文件会中止尚未完成的 PDF 请求", () => {
    state.selectedResumes = [
      file("a.pdf", "application/pdf", 1),
      file("b.pdf", "application/pdf", 2),
    ];
    fetchMock.mockImplementation(() => new Promise(() => {}));
    renderWorkspace();
    const firstSignal = fetchMock.mock.calls[0][1].signal as AbortSignal;

    fireEvent.click(screen.getByRole("button", { name: "下一份" }));

    expect(firstSignal.aborted).toBe(true);
  });

  it("历史任务 PDF 使用受控的已存文件端点", async () => {
    const stored: StoredResumePreview = { jobId: "j1", filename: "b.pdf", candidateName: "张三" };
    fetchMock.mockResolvedValue(jsonResponse({
      page_count: 1,
      pages: [{ index: 1, data: "data:image/png;base64,BBB" }],
    }));
    renderWorkspace({ stored });

    await screen.findByRole("img", { name: "b.pdf - 1" });
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/^\/api\/jobs\/j1\/resumes\/b\.pdf\/preview\?scale=/);
  });

  it("本地图片使用临时 Blob 地址并在关闭时释放", async () => {
    state.selectedResumes = [file("photo.png", "image/png")];
    const { rerender, onClose } = renderWorkspace();
    expect(await screen.findByRole("img", { name: "photo.png" })).toHaveAttribute("src", "blob:mock-url");
    expect(fetchMock).not.toHaveBeenCalled();

    rerender(<ResumeWorkspace open={false} onClose={onClose} />);

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });

  it("不支持的本地文件不会发送到预览端点", async () => {
    state.selectedResumes = [file("notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")];
    renderWorkspace();

    expect(await screen.findByText("此文件格式暂不支持预览")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
