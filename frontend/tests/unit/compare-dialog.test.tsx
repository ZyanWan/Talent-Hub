// =====================================================================
// AI 横向对比弹窗（src/ui/CompareDialog.tsx）渲染与交互测试（jsdom）。
// 覆盖：打开即自动发起（结果页勾选后点按钮直接运行）、
// 请求负载（cancel_key + files 为全部传入候选人）、候选人不足 2 人不发起、
// 结果渲染（rank 补零/候选人名/理由/结论徽章/meta）、缓存命中直出结果、
// 取消链路（关闭对话框与取消按钮触发 /compare/cancel 且 cancel_key 一致、
// 完成后关闭不再发取消）、499 取消文案、错误展示（404/400/500 detail 透传）、
// 关闭行为（点遮罩/关闭按钮/ESC）、语言切换重渲染。
// 仅做渲染级断言，不含截图验证（视觉回归由 tests/visual/baseline.spec.ts 覆盖）。
// =====================================================================

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLanguage } from "../../src/i18n";
import { state } from "../../src/state";
import { CompareDialog, type CompareCandidate } from "../../src/ui/CompareDialog";

let fetchMock: ReturnType<typeof vi.fn>;

// 结果页已勾选的候选人（A/B 均可参与；C 类在结果页已被排除，不会传入）
const candidates: CompareCandidate[] = [
  { source_file: "a.pdf", candidate_name: "张三", conclusion: "A优先约面" },
  { source_file: "b.pdf", candidate_name: "李四", conclusion: "B电话确认" },
  { source_file: "c.pdf", candidate_name: "王五", conclusion: "B电话确认" },
];

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  state.language = "zh-CN";
  localStorage.removeItem("talentHub.language");
});

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderDialog(props: Partial<Parameters<typeof CompareDialog>[0]> = {}) {
  const onClose = vi.fn();
  const view = render(<CompareDialog open jobId="job-1" candidates={candidates} onClose={onClose} {...props} />);
  return { ...view, onClose };
}

/** 等待打开后自动发起的对比请求 */
async function awaitAutoLaunch() {
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  return String(fetchMock.mock.calls[0][0]);
}

function cancelKeyOf(url: unknown): string {
  return new URL(String(url), "http://localhost").searchParams.get("cancel_key") ?? "";
}

describe("打开即自动发起", () => {
  it("打开弹窗自动 POST compare：携带 cancel_key 与全部候选人 files", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ranking: [] }));
    renderDialog();

    const url = await awaitAutoLaunch();
    expect(url.startsWith("/api/jobs/job-1/compare?cancel_key=")).toBe(true);
    expect(cancelKeyOf(url)).toMatch(/^[0-9a-f-]{36}$/);
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      files: ["a.pdf", "b.pdf", "c.pdf"],
    });
  });

  it("候选人少于 2 人不自动发起，显示空态兜底", () => {
    renderDialog({ candidates: [{ source_file: "a.pdf", candidate_name: "张三", conclusion: "A优先约面" }] });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("没有符合当前筛选的候选人")).toBeInTheDocument();
  });
});

describe("结果渲染", () => {
  it("ranking 列表渲染：序号补零、候选人名、理由、结论徽章着色、meta", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        ranking: [
          { candidate: "张三（a.pdf）", rank: 1, reason: "项目经历高度匹配" },
          { candidate: "李四（b.pdf）", rank: 2, reason: "沟通表达优秀" },
        ],
      })
    );
    renderDialog();

    expect(await screen.findByText("共 2 位候选人 · 按推荐约面顺序排序")).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);

    expect(rows[0]).toHaveTextContent("01");
    expect(rows[0]).toHaveTextContent("张三");
    expect(rows[0]).toHaveTextContent("项目经历高度匹配");
    expect(rows[0].querySelector(".conclusion")).toHaveClass("a");
    expect(rows[0].querySelector(".conclusion")).toHaveTextContent("优先约面");
    expect(rows[0].querySelector(".compare-rank")).toHaveAttribute("title", "最推荐");

    expect(rows[1]).toHaveTextContent("02");
    expect(rows[1]).toHaveTextContent("李四");
    expect(rows[1].querySelector(".conclusion")).toHaveClass("b");
    expect(rows[1].querySelector(".conclusion")).toHaveTextContent("电话确认");
  });

  it("candidate 无文件名括号时不渲染结论徽章", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ranking: [{ candidate: "张三", rank: 1, reason: "ok" }] }));
    const { container } = renderDialog();

    await screen.findByText("ok");
    expect(container.querySelector(".conclusion")).toBeNull();
  });
});

describe("缓存命中直出结果", () => {
  it("后端缓存命中直接返回 ranking，前端直出结果不进入错误态", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ranking: [{ candidate: "张三（a.pdf）", rank: 1, reason: "缓存直出" }] }));
    renderDialog();

    expect(await screen.findByText("缓存直出")).toBeInTheDocument();
    expect(screen.queryByText(/AI 对比失败/)).toBeNull();
  });
});

describe("取消链路", () => {
  it("对比进行中关闭对话框：POST /compare/cancel（cancel_key 一致）+ onClose + 取消 toast", async () => {
    const pending = deferred<Response>();
    fetchMock.mockImplementation((url: unknown) =>
      String(url).includes("/compare/cancel") ? Promise.resolve(jsonResponse({ ok: true })) : pending.promise
    );
    const { onClose } = renderDialog();
    await screen.findByText("AI 正在对比分析…");
    const key = cancelKeyOf(await awaitAutoLaunch());

    fireEvent.click(screen.getByRole("button", { name: "关闭预览" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe("/api/jobs/job-1/compare/cancel");
    expect(fetchMock.mock.calls[1][1].method).toBe("POST");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({ cancel_key: key });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("已取消对比")).toBeInTheDocument();

    // 晚到的 499 被静默忽略，不覆盖界面状态
    pending.reject(new Error("对比请求已取消。"));
    await waitFor(() => expect(screen.queryByText(/AI 对比失败/)).toBeNull());
  });

  it("对比进行中点击取消按钮：同样走取消链路", async () => {
    const pending = deferred<Response>();
    fetchMock.mockImplementation((url: unknown) =>
      String(url).includes("/compare/cancel") ? Promise.resolve(jsonResponse({ ok: true })) : pending.promise
    );
    const { onClose } = renderDialog();
    await screen.findByText("AI 正在对比分析…");
    const key = cancelKeyOf(await awaitAutoLaunch());

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe("/api/jobs/job-1/compare/cancel");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({ cancel_key: key });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});

describe("499 取消文案", () => {
  it("对比请求返回 499：展示 compareFail 文案", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: "对比请求已取消。" }, { status: 499 }));
    renderDialog();

    expect(await screen.findByText("AI 对比失败：对比请求已取消。")).toBeInTheDocument();
  });
});

describe("错误展示", () => {
  it("404：评估结果未生成（detail 透传）", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: "评估结果尚未生成。" }, { status: 404 }));
    renderDialog();

    expect(await screen.findByText("AI 对比失败：评估结果尚未生成。")).toBeInTheDocument();
  });

  it("400：模型配置不完整（detail 透传）", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: "模型配置不完整，请先填写 API 地址、API Key 和模型名称。" }, { status: 400 })
    );
    renderDialog();

    expect(
      await screen.findByText("AI 对比失败：模型配置不完整，请先填写 API 地址、API Key 和模型名称。")
    ).toBeInTheDocument();
  });

  it("500：非 JSON 错误体展示通用请求失败文案", async () => {
    fetchMock.mockResolvedValue(new Response("Internal Server Error", { status: 500, headers: { "content-type": "text/plain" } }));
    renderDialog();

    expect(await screen.findByText("AI 对比失败：请求失败（500）")).toBeInTheDocument();
  });
});

describe("关闭行为", () => {
  it("点遮罩关闭，点弹窗内部不关闭", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ranking: [] }));
    const { onClose, container } = renderDialog();
    await awaitAutoLaunch();

    fireEvent.click(container.querySelector(".preview-backdrop")!);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("heading", { name: "横向对比" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("关闭按钮与 ESC 触发 onClose", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ranking: [] }));
    const { onClose } = renderDialog();
    await awaitAutoLaunch();

    fireEvent.click(screen.getByRole("button", { name: "关闭预览" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("语言切换", () => {
  it("结果渲染后切换语言：结论徽章、标题、meta 重渲染", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ranking: [{ candidate: "张三（a.pdf）", rank: 1, reason: "匹配" }] }));
    renderDialog();

    expect(await screen.findByText("优先约面")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "横向对比" })).toBeInTheDocument();

    act(() => setLanguage("en"));
    expect(screen.getByRole("heading", { name: "Comparison" })).toBeInTheDocument();
    expect(screen.getByText("Priority interview")).toBeInTheDocument();
    expect(screen.getByText("1 candidates · sorted by interview priority")).toBeInTheDocument();
  });

  it("加载中切换语言：loading 文案更新", async () => {
    fetchMock.mockImplementation(() => deferred<Response>().promise);
    renderDialog();

    expect(await screen.findByText("AI 正在对比分析…")).toBeInTheDocument();
    act(() => setLanguage("en"));
    expect(screen.getByText("AI is comparing candidates…")).toBeInTheDocument();
  });
});
