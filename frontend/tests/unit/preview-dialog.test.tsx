import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreviewDialog } from "../../src/ui/PreviewDialog";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function renderDialog(props: Partial<Parameters<typeof PreviewDialog>[0]> = {}) {
  const onClose = vi.fn();
  const view = render(<PreviewDialog open jobId="job-1" kind="criteria" onClose={onClose} {...props} />);
  return { ...view, onClose };
}

describe("产物预览", () => {
  it("Markdown 保留结构并把 HTML 当作纯文本", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      kind: "markdown",
      content: '# 标题\n\n- 项目一\n\n<img src=x onerror="alert(1)">\n\n<script>alert(2)</script>',
      truncated: false,
    }));

    const { container } = renderDialog();

    expect(await screen.findByRole("heading", { name: "标题" })).toBeInTheDocument();
    expect(screen.getByRole("listitem")).toHaveTextContent("项目一");
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector(".markdown-preview")).toHaveTextContent("<script>alert(2)</script>");
  });

  it("工作簿能够在工作表之间切换", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      kind: "workbook",
      truncated: false,
      sheets: [
        { name: "候选人总表", rows: [["姓名"], ["张三"]] },
        { name: "电话确认问题", rows: [["问题"], ["到岗时间"]] },
      ],
    }));
    renderDialog({ kind: "workbook" });

    fireEvent.click(await screen.findByRole("tab", { name: "电话确认问题" }));

    expect(screen.getByRole("columnheader", { name: "问题" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "到岗时间" })).toBeInTheDocument();
  });

  it("服务端错误不会被当作预览内容", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: "任务不存在。" }, 404));
    renderDialog();

    expect(await screen.findByText("任务不存在。")).toHaveClass("preview-status", "error");
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("切换任务会中止尚未完成的预览请求", () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const { rerender, onClose } = renderDialog();
    const firstSignal = fetchMock.mock.calls[0][1].signal as AbortSignal;

    rerender(<PreviewDialog open jobId="job-2" kind="criteria" onClose={onClose} />);

    expect(firstSignal.aborted).toBe(true);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/jobs/job-2/preview/criteria");
  });
});
