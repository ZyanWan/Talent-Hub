// =====================================================================
// 产物预览弹窗（src/ui/PreviewDialog.tsx）渲染与交互测试（jsdom）。
// 覆盖：markdown 安全渲染（h1-h3/ul/p 结构与文本节点防注入）、workbook
// sheet 渲染与点击/键盘切换、空表提示、错误状态、truncated 提示、
// 遮罩点击/关闭按钮/ESC 关闭、AbortController 中止旧请求。
// 仅做渲染级断言，不含截图验证（视觉回归由 tests/visual/baseline.spec.ts 覆盖）。
// =====================================================================

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreviewDialog, type PreviewPayload } from "../../src/ui/PreviewDialog";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
    return new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        headers: { "content-type": "application/json", ...init.headers },
    });
}

function markdownPayload(overrides: Partial<{ content: string; truncated: boolean }> = {}): PreviewPayload {
    return { kind: "markdown", content: "# 筛选标准", truncated: false, ...overrides };
}

function workbookPayload(
    sheets: { name: string; rows: unknown[][] }[],
    truncated = false
): PreviewPayload {
    return { kind: "workbook", sheets, truncated };
}

function renderDialog(props: Partial<Parameters<typeof PreviewDialog>[0]> = {}) {
    const onClose = vi.fn();
    const view = render(<PreviewDialog open jobId="job-1" kind="criteria" onClose={onClose} {...props} />);
    return { ...view, onClose };
}

describe("markdown 安全渲染", () => {
    it("h1/h2/h3/ul/p 结构与 textContent 正确", async () => {
        fetchMock.mockResolvedValue(
            jsonResponse(
                markdownPayload({
                    content: "# 标题\n\n## 二级\n\n### 三级\n\n- 项目一\n- 项目二\n\n普通段落",
                })
            )
        );
        renderDialog();

        expect(await screen.findByRole("heading", { level: 1, name: "标题" })).toBeInTheDocument();
        expect(screen.getByRole("heading", { level: 2, name: "二级" })).toBeInTheDocument();
        expect(screen.getByRole("heading", { level: 3, name: "三级" })).toBeInTheDocument();
        const listItems = screen.getAllByRole("listitem");
        expect(listItems).toHaveLength(2);
        expect(listItems[0]).toHaveTextContent("项目一");
        expect(listItems[1]).toHaveTextContent("项目二");
        expect(screen.getByText("普通段落")).toBeInTheDocument();
    });

    it("HTML 不注入：脚本与事件属性以纯文本呈现", async () => {
        fetchMock.mockResolvedValue(
            jsonResponse(
                markdownPayload({
                    content: '# 标题\n\n<img src=x onerror="alert(1)">\n\n<script>alert(2)</script>',
                })
            )
        );
        const { container } = renderDialog();

        expect(await screen.findByRole("heading", { level: 1, name: "标题" })).toBeInTheDocument();
        expect(container.querySelector("img")).toBeNull();
        expect(container.querySelector("script")).toBeNull();
        expect(container.querySelector(".markdown-preview")).toHaveTextContent('<img src=x onerror="alert(1)">');
        expect(container.querySelector(".markdown-preview")).toHaveTextContent("<script>alert(2)</script>");
    });

    it("空内容显示 emptyPreview 文案", async () => {
        fetchMock.mockResolvedValue(jsonResponse(markdownPayload({ content: "" })));
        renderDialog();
        expect(await screen.findByText("文件中没有可预览的内容。")).toBeInTheDocument();
    });
});

describe("workbook 渲染与切换", () => {
    const sheets = [
        { name: "候选人总表", rows: [["姓名", "结论"], ["张三", "A优先约面"]] },
        { name: "电话确认问题", rows: [["候选人", "问题"], ["李四", "请说明项目经历"]] },
    ];

    it("tabs 渲染、默认激活第一个、表格首行作表头", async () => {
        fetchMock.mockResolvedValue(jsonResponse(workbookPayload(sheets)));
        renderDialog({ kind: "workbook" });

        const tabs = await screen.findAllByRole("tab");
        expect(tabs).toHaveLength(2);
        expect(tabs[0]).toHaveTextContent("候选人总表");
        expect(tabs[0]).toHaveAttribute("aria-selected", "true");
        expect(tabs[1]).toHaveAttribute("aria-selected", "false");
        expect(tabs[1]).toHaveAttribute("tabindex", "-1");

        const headers = screen.getAllByRole("columnheader");
        expect(headers.map((node) => node.textContent)).toEqual(["姓名", "结论"]);
        const cells = screen.getAllByRole("cell");
        expect(cells.map((node) => node.textContent)).toEqual(["张三", "A优先约面"]);
    });

    it("点击 tab 切换工作表", async () => {
        fetchMock.mockResolvedValue(jsonResponse(workbookPayload(sheets)));
        renderDialog({ kind: "workbook" });

        fireEvent.click((await screen.findAllByRole("tab"))[1]);
        expect(screen.getByRole("tab", { name: "电话确认问题" })).toHaveAttribute("aria-selected", "true");
        expect(screen.getByRole("tab", { name: "候选人总表" })).toHaveAttribute("aria-selected", "false");
        expect(screen.getByRole("columnheader", { name: "候选人" })).toBeInTheDocument();
        expect(screen.getByRole("cell", { name: "李四" })).toBeInTheDocument();
    });

    it("键盘 ArrowRight / Home / End 切换并聚焦", async () => {
        fetchMock.mockResolvedValue(jsonResponse(workbookPayload(sheets)));
        renderDialog({ kind: "workbook" });

        const tablist = await screen.findByRole("tablist");
        const tabs = screen.getAllByRole("tab");

        fireEvent.keyDown(tablist, { key: "ArrowRight" });
        expect(tabs[1]).toHaveAttribute("aria-selected", "true");
        expect(tabs[1]).toHaveFocus();
        expect(screen.getByRole("columnheader", { name: "候选人" })).toBeInTheDocument();

        fireEvent.keyDown(tablist, { key: "Home" });
        expect(tabs[0]).toHaveAttribute("aria-selected", "true");
        expect(tabs[0]).toHaveFocus();

        fireEvent.keyDown(tablist, { key: "End" });
        expect(tabs[1]).toHaveAttribute("aria-selected", "true");
        expect(tabs[1]).toHaveFocus();

        fireEvent.keyDown(tablist, { key: "ArrowLeft" });
        expect(tabs[0]).toHaveAttribute("aria-selected", "true");
        expect(tabs[0]).toHaveFocus();
    });

    it("空 sheet 显示 emptyWorksheet 提示", async () => {
        fetchMock.mockResolvedValue(jsonResponse(workbookPayload([{ name: "空表", rows: [] }])));
        renderDialog({ kind: "workbook" });

        expect(await screen.findByText("此工作表没有内容。")).toBeInTheDocument();
        expect(screen.queryByRole("columnheader")).toBeNull();
    });
});

describe("加载与错误状态", () => {
    it("加载中显示 previewLoading 且下载按钮禁用", () => {
        fetchMock.mockImplementation(() => new Promise(() => { }));
        renderDialog();
        expect(screen.getByText("正在读取预览…")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /下载 Markdown/ })).toBeDisabled();
    });

    it("请求失败展示错误信息（error 样式）", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ detail: "任务不存在。" }, { status: 404 }));
        renderDialog();

        const status = await screen.findByText("任务不存在。");
        expect(status).toHaveClass("preview-status", "error");
        expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    });
});

describe("截断提示", () => {
    it("truncated=true 显示 previewTruncated，false 不显示", async () => {
        fetchMock.mockResolvedValue(jsonResponse(markdownPayload({ truncated: true })));
        const { rerender, onClose } = renderDialog();
        const notice = await screen.findByText("预览仅显示部分内容，下载文件可查看完整数据。");
        expect(notice).not.toHaveAttribute("hidden");

        // 关闭后重新打开触发重新请求，返回 truncated=false
        rerender(<PreviewDialog open={false} jobId="job-1" kind="criteria" onClose={onClose} />);
        fetchMock.mockResolvedValue(jsonResponse(markdownPayload({ truncated: false })));
        rerender(<PreviewDialog open jobId="job-1" kind="criteria" onClose={onClose} />);
        await screen.findByRole("heading", { level: 1 });
        expect(screen.getByText("预览仅显示部分内容，下载文件可查看完整数据。")).toHaveAttribute("hidden");
    });
});

describe("关闭行为", () => {
    it("点击遮罩自身关闭，点击弹窗内部不关闭", async () => {
        fetchMock.mockResolvedValue(jsonResponse(markdownPayload()));
        const { onClose, container } = renderDialog();
        await screen.findByRole("heading", { level: 1 });

        fireEvent.click(container.querySelector(".preview-backdrop")!);
        expect(onClose).toHaveBeenCalledTimes(1);

        fireEvent.click(container.querySelector(".preview-header h2")!);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("关闭按钮触发 onClose", async () => {
        fetchMock.mockResolvedValue(jsonResponse(markdownPayload()));
        const { onClose } = renderDialog();
        await screen.findByRole("heading", { level: 1 });

        fireEvent.click(screen.getByRole("button", { name: "关闭预览" }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("ESC 触发 onClose", async () => {
        fetchMock.mockResolvedValue(jsonResponse(markdownPayload()));
        const { onClose } = renderDialog();
        await screen.findByRole("heading", { level: 1 });

        fireEvent.keyDown(window, { key: "Escape" });
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});

describe("AbortController 中止旧请求", () => {
    it("打开状态切换 jobId 时中止上一次请求", () => {
        fetchMock.mockImplementation(() => new Promise(() => { }));
        const { rerender, onClose } = renderDialog();

        const firstSignal = fetchMock.mock.calls[0][1].signal as AbortSignal;
        rerender(<PreviewDialog open jobId="job-2" kind="criteria" onClose={onClose} />);

        expect(firstSignal.aborted).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[1][0]).toBe("/api/jobs/job-2/preview/criteria");
    });

    it("卸载时中止当前请求", () => {
        fetchMock.mockImplementation(() => new Promise(() => { }));
        const { unmount } = renderDialog();

        const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
        unmount();

        expect(signal.aborted).toBe(true);
    });
});
