// =====================================================================
// 历史任务抽屉（src/ui/HistoryDrawer.tsx）渲染与交互测试（jsdom）。
// 覆盖：job/call 按 initialKind 展示、recent/archived tab 切换、列表渲染（标题/meta/tab 计数）、
// 分页加载更多（offset 追加与显隐）、归档/恢复/永久删除流程（请求端点与
// 确认框、删除中按钮禁用 + deleting 文案 + toast）、空状态、存储占用
// 展示、点行触发 onOpenJob/onOpenCall、遮罩/关闭按钮/ESC 关闭行为、
// 生命周期变更回调、语言切换重渲染、active 行高亮。
// 仅做渲染级断言，不含截图验证（视觉回归由 tests/visual/baseline.spec.ts 覆盖）。
// =====================================================================

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLanguage } from "../../src/i18n";
import { state } from "../../src/state";
import { HistoryDrawer, type HistoryItem } from "../../src/ui/HistoryDrawer";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  state.language = "zh-CN";
  state.currentJob = null;
  state.currentCall = null;
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

function genJobs(n: number, prefix = "job"): HistoryItem[] {
  return Array.from({ length: n }, (_, index) => ({
    id: `${prefix}-${index + 1}`,
    title: prefix === "job" ? `任务-${index + 1}` : `归档任务-${index + 1}`,
    status: "completed",
    stage: "评估完成",
    updated_at: "2026-08-31T10:05:00+08:00",
  }));
}

function genCalls(n: number): HistoryItem[] {
  return Array.from({ length: n }, (_, index) => ({
    id: `call-${index + 1}`,
    title: `电话确认-${index + 1}`,
    job_title: "候选人筛选-2026-08-31",
    status: "done",
    stage: "整理完成",
    updated_at: "2026-08-31T11:10:00+08:00",
  }));
}

interface HistoryEndpoints {
  jobRecent?: { items: HistoryItem[]; total: number };
  jobArchived?: { items: HistoryItem[]; total: number };
  callRecent?: { items: HistoryItem[]; total: number };
  callArchived?: { items: HistoryItem[]; total: number };
  storage?: { job_count: number; jobs_bytes: number };
}

/** 按 URL 分发的 fetch mock：GET 列表 / storage / 归档恢复删除（默认成功） */
function setupFetch(endpoints: HistoryEndpoints = {}) {
  const defaults = {
    jobRecent: { items: [] as HistoryItem[], total: 0 },
    jobArchived: { items: [] as HistoryItem[], total: 0 },
    callRecent: { items: [] as HistoryItem[], total: 0 },
    callArchived: { items: [] as HistoryItem[], total: 0 },
    storage: { job_count: 0, jobs_bytes: 0 },
    ...endpoints,
  };
  fetchMock.mockImplementation((url: string) => {
    const parsed = new URL(String(url), "http://localhost");
    const scope = parsed.searchParams.get("scope") ?? "recent";
    const offset = Number(parsed.searchParams.get("offset") ?? "0");
    if (parsed.pathname === "/api/jobs") {
      const page = scope === "archived" ? defaults.jobArchived : defaults.jobRecent;
      return Promise.resolve(
        jsonResponse({ jobs: page.items.slice(offset, offset + 50), total: page.total })
      );
    }
    if (parsed.pathname === "/api/calls") {
      const page = scope === "archived" ? defaults.callArchived : defaults.callRecent;
      return Promise.resolve(
        jsonResponse({ calls: page.items.slice(offset, offset + 50), total: page.total })
      );
    }
    if (parsed.pathname === "/api/storage") {
      return Promise.resolve(jsonResponse(defaults.storage));
    }
    const lifecycle = parsed.pathname.match(/^\/api\/(jobs|calls)\/([^/]+)\/(archive|restore)$/);
    if (lifecycle) {
      const [, resource, id, action] = lifecycle;
      const source = resource === "calls"
        ? [...defaults.callRecent.items, ...defaults.callArchived.items].find((item) => item.id === id)
        : [...defaults.jobRecent.items, ...defaults.jobArchived.items].find((item) => item.id === id);
      return Promise.resolve(jsonResponse({ ...source, archived_at: action === "archive" ? "2026-09-03T12:00:00+08:00" : null }));
    }
    return Promise.resolve(jsonResponse({ ok: true }));
  });
}

function renderDrawer(props: Partial<Parameters<typeof HistoryDrawer>[0]> = {}) {
  const onClose = vi.fn();
  const onOpenJob = vi.fn();
  const onOpenCall = vi.fn();
  const onMutation = vi.fn();
  const view = render(
    <HistoryDrawer open onClose={onClose} onOpenJob={onOpenJob} onOpenCall={onOpenCall} onMutation={onMutation} {...props} />
  );
  return { ...view, onClose, onOpenJob, onOpenCall, onMutation };
}

/** 打开某行的「更多操作」菜单 */
function openRowMenu(index = 0) {
  fireEvent.click(screen.getAllByRole("button", { name: "更多操作" })[index]);
}

function callsWith(method: string, path: string): unknown[][] {
  return fetchMock.mock.calls.filter(
    ([url, init]) => String(url) === path && (init?.method ?? "GET") === method
  );
}

describe("列表渲染", () => {
  it("渲染 job 行（标题 / 状态 meta / tab 计数）", async () => {
    setupFetch({
      jobRecent: { items: genJobs(2), total: 2 },
      jobArchived: { items: genJobs(1, "job-archived"), total: 1 },
      storage: { job_count: 3, jobs_bytes: 3145728 },
    });
    renderDrawer();

    expect(await screen.findByText("任务-1")).toBeInTheDocument();
    expect(screen.getByText("任务-2")).toBeInTheDocument();
    expect(screen.getByText("任务-1").parentElement).toHaveTextContent(/已完成/);

    const recentTab = screen.getByRole("tab", { name: /最近/ });
    expect(recentTab).toHaveTextContent("2");
    expect(screen.getByRole("tab", { name: /已归档/ })).toHaveTextContent("1");
  });

  it("currentJob 匹配时行高亮（active + aria-current）", async () => {
    setupFetch({
      jobRecent: { items: genJobs(2), total: 2 },
      storage: { job_count: 2, jobs_bytes: 0 },
    });
    state.currentJob = { id: "job-2", title: "任务-2" } as unknown as Record<string, unknown>;
    renderDrawer();

    const activeButton = await screen.findByRole("button", { name: /任务-2/ });
    expect(activeButton).toHaveAttribute("aria-current", "page");
    expect(activeButton.closest(".history-row")).toHaveClass("active");
  });
});

describe("分页加载更多", () => {
  it("total 超过首屏时显示「加载更多」，点击按 offset 追加并隐藏", async () => {
    setupFetch({
      jobRecent: { items: genJobs(60), total: 60 },
      storage: { job_count: 60, jobs_bytes: 0 },
    });
    renderDrawer();

    const loadMore = await screen.findByRole("button", { name: "加载更多" });
    expect(screen.getAllByRole("button", { name: "更多操作" })).toHaveLength(50);

    fireEvent.click(loadMore);
    await waitFor(() =>
      expect(callsWith("GET", "/api/jobs?scope=recent&limit=50&offset=50")).toHaveLength(1)
    );
    await waitFor(() => expect(screen.getAllByRole("button", { name: "更多操作" })).toHaveLength(60));
    expect(screen.queryByRole("button", { name: "加载更多" })).not.toBeInTheDocument();
  });

  it("total 不超首屏时不显示「加载更多」", async () => {
    setupFetch({
      jobRecent: { items: genJobs(2), total: 2 },
      storage: { job_count: 2, jobs_bytes: 0 },
    });
    renderDrawer();

    await screen.findByText("任务-1");
    expect(screen.queryByRole("button", { name: "加载更多" })).not.toBeInTheDocument();
  });
});

describe("job/call 展示", () => {
  it("initialKind=\"call\" 时直接加载 call 列表且不显示存储占用", async () => {
    setupFetch({
      callRecent: { items: genCalls(1), total: 1 },
    });
    renderDrawer({ initialKind: "call" });

    expect(await screen.findByText("电话确认-1")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "电话记录" })).toBeInTheDocument();
    expect(screen.queryByTestId("history-storage")).not.toBeInTheDocument();
  });
});

describe("tab 切换", () => {
  it("recent ↔ archived 切换显示对应列表", async () => {
    setupFetch({
      jobRecent: { items: genJobs(1), total: 1 },
      jobArchived: { items: genJobs(1, "job-archived"), total: 1 },
      storage: { job_count: 2, jobs_bytes: 0 },
    });
    renderDrawer();

    expect(await screen.findByText("任务-1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /已归档/ }));
    expect(await screen.findByText("归档任务-1")).toBeInTheDocument();
    expect(screen.queryByText("任务-1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /最近/ }));
    expect(await screen.findByText("任务-1")).toBeInTheDocument();
  });
});

describe("归档与恢复", () => {
  it("归档：POST /api/jobs/{id}/archive + 刷新 + 归档 toast", async () => {
    setupFetch({
      jobRecent: { items: genJobs(1), total: 1 },
      storage: { job_count: 1, jobs_bytes: 0 },
    });
    const { onMutation } = renderDrawer();
    await screen.findByText("任务-1");

    openRowMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "归档" }));

    await waitFor(() =>
      expect(callsWith("POST", "/api/jobs/job-1/archive")).toHaveLength(1)
    );
    expect(onMutation).toHaveBeenCalledWith({
      action: "archive",
      kind: "job",
      item: expect.objectContaining({ id: "job-1", archived_at: "2026-09-03T12:00:00+08:00" }),
    });
    expect(await screen.findByText("任务已归档")).toBeInTheDocument();
  });

  it("恢复：archived tab 下 POST /api/jobs/{id}/restore + 恢复 toast", async () => {
    setupFetch({
      jobRecent: { items: genJobs(1), total: 1 },
      jobArchived: { items: genJobs(1, "job-archived"), total: 1 },
      storage: { job_count: 2, jobs_bytes: 0 },
    });
    renderDrawer();
    await screen.findByText("任务-1");

    fireEvent.click(screen.getByRole("tab", { name: /已归档/ }));
    await screen.findByText("归档任务-1");
    openRowMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "恢复到最近任务" }));

    await waitFor(() =>
      expect(callsWith("POST", "/api/jobs/job-archived-1/restore")).toHaveLength(1)
    );
    expect(await screen.findByText("任务已恢复")).toBeInTheDocument();
  });

  it("call 归档走 /api/calls/{id}/archive 且 toast 为 callArchivedToast", async () => {
    setupFetch({
      callRecent: { items: genCalls(1), total: 1 },
    });
    renderDrawer({ initialKind: "call" });
    await screen.findByText("电话确认-1");

    openRowMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "归档" }));

    await waitFor(() =>
      expect(callsWith("POST", "/api/calls/call-1/archive")).toHaveLength(1)
    );
    expect(await screen.findByText("任务已归档")).toBeInTheDocument();
  });

  it("queued/running 任务禁用归档与删除菜单项", async () => {
    setupFetch({
      jobRecent: {
        items: [{ id: "job-running", title: "运行中任务", status: "running" }],
        total: 1,
      },
      storage: { job_count: 1, jobs_bytes: 0 },
    });
    renderDrawer();
    await screen.findByText("运行中任务");

    openRowMenu();
    expect(screen.getByRole("menuitem", { name: "归档" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "永久删除" })).toBeDisabled();
  });
});

describe("永久删除", () => {
  it("确认框 → DELETE → 刷新 + 已删除 toast", async () => {
    setupFetch({
      jobRecent: { items: genJobs(1), total: 1 },
      storage: { job_count: 1, jobs_bytes: 0 },
    });
    renderDrawer();
    await screen.findByText("任务-1");

    openRowMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "永久删除" }));

    const confirm = screen.getByRole("dialog", { name: "永久删除任务？" });
    expect(confirm).toHaveTextContent("“任务-1”将从本机移除");
    expect(confirm).toHaveTextContent(/岗位说明、原始简历/);

    fireEvent.click(screen.getByRole("button", { name: "永久删除" }));
    await waitFor(() => expect(callsWith("DELETE", "/api/jobs/job-1")).toHaveLength(1));
    expect(await screen.findByText("任务已永久删除")).toBeInTheDocument();
  });

  it("删除中：确认按钮禁用 + 「正在删除…」，完成后恢复", async () => {
    const pending = deferred<Response>();
    const endpoints = {
      jobRecent: { items: genJobs(1), total: 1 },
      storage: { job_count: 1, jobs_bytes: 0 },
    };
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const parsed = new URL(String(url), "http://localhost");
      if (String(url) === "/api/jobs/job-1" && init?.method === "DELETE") return pending.promise;
      if (parsed.pathname === "/api/jobs") {
        const page = endpoints.jobRecent;
        return Promise.resolve(jsonResponse({ jobs: page.items, total: page.total }));
      }
      if (parsed.pathname === "/api/storage") {
        return Promise.resolve(jsonResponse(endpoints.storage));
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    renderDrawer();
    await screen.findByText("任务-1");

    openRowMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "永久删除" }));
    fireEvent.click(screen.getByRole("button", { name: "永久删除" }));

    const deletingButton = await screen.findByRole("button", { name: "正在删除…" });
    expect(deletingButton).toBeDisabled();

    pending.resolve(jsonResponse({ ok: true }));
    expect(await screen.findByText("任务已永久删除")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "永久删除任务？" })).not.toBeInTheDocument());
  });

  it("call 删除确认框与端点：/api/calls/{id} + callDeleteTitle", async () => {
    setupFetch({
      callRecent: { items: genCalls(1), total: 1 },
    });
    const { onMutation } = renderDrawer({ initialKind: "call" });
    await screen.findByText("电话确认-1");

    openRowMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "永久删除" }));
    expect(screen.getByRole("dialog", { name: "永久删除电话确认任务？" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "永久删除" }));
    await waitFor(() => expect(callsWith("DELETE", "/api/calls/call-1")).toHaveLength(1));
    expect(onMutation).toHaveBeenCalledWith({ action: "delete", kind: "call", itemId: "call-1" });
    expect(await screen.findByText("任务已删除")).toBeInTheDocument();
  });
});

describe("空状态", () => {
  it("recent 空与 archived 空分别显示不同文案", async () => {
    setupFetch({
      storage: { job_count: 0, jobs_bytes: 0 },
    });
    renderDrawer();

    expect(await screen.findByText("还没有筛选记录")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /已归档/ }));
    expect(await screen.findByText("归档的任务会保留在这里")).toBeInTheDocument();
  });

  it("加载中显示读取中文案", async () => {
    const pendingRecent = deferred<Response>();
    const pendingArchived = deferred<Response>();
    fetchMock.mockImplementation((url: string) => {
      const parsed = new URL(String(url), "http://localhost");
      if (parsed.pathname === "/api/jobs") {
        return parsed.searchParams.get("scope") === "archived"
          ? pendingArchived.promise
          : pendingRecent.promise;
      }
      if (parsed.pathname === "/api/storage") {
        return Promise.resolve(jsonResponse({ job_count: 0, jobs_bytes: 0 }));
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    renderDrawer();

    expect(screen.getByText("正在读取任务记录…")).toBeInTheDocument();
    pendingRecent.resolve(jsonResponse({ jobs: [], total: 0 }));
    pendingArchived.resolve(jsonResponse({ jobs: [], total: 0 }));
    expect(await screen.findByText("还没有筛选记录")).toBeInTheDocument();
  });
});

describe("存储占用", () => {
  it("job_count > 0 显示 storageUsage（格式化大小）", async () => {
    setupFetch({
      storage: { job_count: 3, jobs_bytes: 3145728 },
    });
    renderDrawer();

    await waitFor(() =>
      expect(screen.getByTestId("history-storage")).toHaveTextContent("本机任务数据 · 3.0 MB")
    );
  });

  it("job_count 为 0 显示 storageEmpty", async () => {
    setupFetch({
      storage: { job_count: 0, jobs_bytes: 0 },
    });
    renderDrawer();

    await waitFor(() => expect(screen.getByTestId("history-storage")).toHaveTextContent("本机暂无任务数据"));
  });
});

describe("当前任务切换", () => {
  it("点击 job 行触发 onOpenJob 并关闭抽屉", async () => {
    setupFetch({
      jobRecent: { items: genJobs(1), total: 1 },
      storage: { job_count: 1, jobs_bytes: 0 },
    });
    const { onClose, onOpenJob } = renderDrawer();
    await screen.findByText("任务-1");

    fireEvent.click(screen.getByRole("button", { name: /任务-1/ }));
    expect(onOpenJob).toHaveBeenCalledWith("job-1");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("点击 call 行触发 onOpenCall", async () => {
    setupFetch({
      callRecent: { items: genCalls(1), total: 1 },
    });
    const { onOpenCall } = renderDrawer({ initialKind: "call" });
    await screen.findByText("电话确认-1");

    fireEvent.click(screen.getByRole("button", { name: /电话确认-1/ }));
    expect(onOpenCall).toHaveBeenCalledWith("call-1");
  });
});

describe("关闭行为", () => {
  it("点遮罩关闭、点抽屉内部不关闭", () => {
    setupFetch();
    const { onClose, container } = renderDrawer();

    fireEvent.click(container.querySelector(".preview-backdrop")!);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("heading", { name: "任务记录" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("关闭按钮与 ESC 关闭抽屉", async () => {
    setupFetch();
    const { onClose } = renderDrawer();
    await screen.findByText("还没有筛选记录");

    fireEvent.click(screen.getByRole("button", { name: "关闭任务记录" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("确认框打开时 ESC 先关闭确认框而非抽屉", async () => {
    setupFetch({
      jobRecent: { items: genJobs(1), total: 1 },
      storage: { job_count: 1, jobs_bytes: 0 },
    });
    const { onClose } = renderDrawer();
    await screen.findByText("任务-1");

    openRowMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "永久删除" }));
    expect(screen.getByRole("dialog", { name: "永久删除任务？" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "永久删除任务？" })).not.toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("语言切换", () => {
  it("切换语言后标题 / tab / 存储文案重渲染", async () => {
    setupFetch({
      jobRecent: { items: genJobs(1), total: 1 },
      storage: { job_count: 3, jobs_bytes: 3145728 },
    });
    renderDrawer();
    await screen.findByText("任务-1");
    await waitFor(() =>
      expect(screen.getByTestId("history-storage")).toHaveTextContent("本机任务数据")
    );

    act(() => setLanguage("en"));
    expect(screen.getByRole("heading", { name: "Task history" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Recent/ })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("history-storage")).toHaveTextContent("Local task data")
    );
  });
});
