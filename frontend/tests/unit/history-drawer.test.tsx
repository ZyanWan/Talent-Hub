// =====================================================================
// 历史列表分页与 job/call 生命周期操作。
// =====================================================================

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
