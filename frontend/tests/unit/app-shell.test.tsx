// =====================================================================
// 应用启动、基础路由与历史任务异步隔离。
// =====================================================================

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/App";
import { getLanguage } from "../../src/i18n";
import { state } from "../../src/state";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  state.settings = null;
  state.jobs = [];
  state.currentJob = null;
  state.language = "zh-CN";
  localStorage.clear();
  document.title = "";
  document.documentElement.lang = "";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  state.settings = null;
  state.jobs = [];
  state.currentJob = null;
  state.language = "zh-CN";
  localStorage.clear();
  document.title = "";
  document.documentElement.lang = "";
});

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function readySettings() {
  return { settings: { is_ready: true, model: "gpt-4o-mini", base_url: "https://api.openai.com/v1" }, jobs: [{ id: "j1" }] };
}

/** 每次调用返回全新的 Response（同一 Response 的 body 只能读取一次） */
function mockBootstrap(payload: unknown) {
  fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(payload)));
}

/** 等待 bootstrap 完成（startup-loading 隐藏即 bootstrap 结束） */
async function waitBootstrap() {
  await waitFor(() => expect(document.getElementById("startupLoading")!.hidden).toBe(true));
}

describe("bootstrap 与顶栏渲染", () => {
  it("bootstrap 成功后渲染顶栏、隐藏 loading、进入默认 setup 视图并写入 state", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === "/api/bootstrap") return Promise.resolve(jsonResponse(readySettings()));
      return Promise.resolve(jsonResponse({}));
    });
    render(<App />);

    // 顶栏元素
    expect(screen.getByRole("button", { name: "打开最近任务" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "模型配置" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "退出应用" })).toBeInTheDocument();
    expect(screen.getByText("招聘工作台")).toBeInTheDocument();

    await waitBootstrap();
    expect(fetchMock).toHaveBeenCalledWith("/api/bootstrap", expect.anything());
    expect(state.settings).toEqual(readySettings().settings);
    expect(state.jobs).toHaveLength(1);
    expect(state.historyTotals.recent).toBe(1);
    expect(localStorage.getItem("talentHub.activeTool")).toBe("screening");

    // 默认视图：仅 setupView 可见
    expect(document.getElementById("setupView")!.hidden).toBe(false);
    for (const id of ["progressView", "criteriaReviewView", "resultsView", "phoneView"]) {
      expect(document.getElementById(id)!.hidden, id).toBe(true);
    }
    expect(document.body.dataset.view).toBe("setup");
  });

  it("bootstrap 分流：activeTool=phone 时进入电话视图并隐藏 viewTitle", async () => {
    localStorage.setItem("talentHub.activeTool", "phone");
    mockBootstrap(readySettings());
    render(<App />);

    await waitBootstrap();
    expect(document.getElementById("phoneView")!.hidden).toBe(false);
    expect(document.getElementById("setupView")!.hidden).toBe(true);
    expect(document.body.dataset.view).toBe("phone");
    expect(document.getElementById("viewTitle")!.hidden).toBe(true);
  });

  it("bootstrap 分流：lastJob 存在时按任务状态进入对应视图", async () => {
    localStorage.setItem("talentHub.lastJob", "j-completed");
    fetchMock.mockImplementation((url: string) => {
      if (url === "/api/bootstrap") return Promise.resolve(jsonResponse(readySettings()));
      if (url === "/api/jobs/j-completed") {
        return Promise.resolve(jsonResponse({ id: "j-completed", status: "completed", results: [{ id: "r1" }] }));
      }
      return Promise.resolve(jsonResponse({}));
    });
    render(<App />);

    await waitBootstrap();
    expect(document.getElementById("resultsView")!.hidden).toBe(false);
    expect(localStorage.getItem("talentHub.lastJob")).toBe("j-completed");
    expect(state.currentJob?.id).toBe("j-completed");
  });

  it("bootstrap 失败：展示 toast 并回落 setup 视图", async () => {
    fetchMock.mockRejectedValue(new Error("服务不可用"));
    render(<App />);

    await waitBootstrap();
    expect(screen.getByText("服务不可用")).toBeInTheDocument();
    expect(document.getElementById("setupView")!.hidden).toBe(false);
    expect(state.settings).toBeNull();
  });
});

describe("语言切换", () => {
  it("点击 EN 后 i18n 语言变化并更新 document.title 与 html lang", async () => {
    mockBootstrap(readySettings());
    render(<App />);
    await waitBootstrap();
    expect(getLanguage()).toBe("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(document.title).toBe("招聘工作台 · 让人才判断有据可循");

    fireEvent.click(screen.getByRole("button", { name: "EN" }));

    expect(getLanguage()).toBe("en");
    expect(localStorage.getItem("talentHub.language")).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    expect(document.title).toBe("Talent Hub | Evidence-led screening");
    // 顶栏随语言重渲染
    expect(screen.getByRole("button", { name: "Exit application" })).toBeInTheDocument();
    expect(screen.getByText("Talent Hub")).toBeInTheDocument();
  });
});

describe("顶栏动作", () => {
  it("快速切换历史筛选任务时只提交最后一次选择", async () => {
    const makeJob = (id: string, title: string) => ({
      id,
      title,
      status: "completed",
      completed: 1,
      total: 1,
      results: [{ source_file: `${id}.pdf`, candidate_name: `候选人 ${title}`, conclusion: "A优先约面", blockers: [] }],
      errors: [],
    });
    const jobA = makeJob("job-a", "A");
    const jobB = makeJob("job-b", "B");
    const jobC = makeJob("job-c", "C");
    const pendingB = deferred<Response>();
    localStorage.setItem("talentHub.lastJob", jobA.id);
    fetchMock.mockImplementation((url: string) => {
      const value = String(url);
      if (value === "/api/bootstrap") return Promise.resolve(jsonResponse(readySettings()));
      if (value === `/api/jobs/${jobA.id}`) return Promise.resolve(jsonResponse(jobA));
      if (value === `/api/jobs/${jobB.id}`) return pendingB.promise;
      if (value === `/api/jobs/${jobC.id}`) return Promise.resolve(jsonResponse(jobC));
      if (value.startsWith("/api/jobs?scope=recent")) {
        return Promise.resolve(jsonResponse({ jobs: [jobB, jobC], total: 2 }));
      }
      if (value.startsWith("/api/jobs?scope=archived")) return Promise.resolve(jsonResponse({ jobs: [], total: 0 }));
      if (value === "/api/storage") return Promise.resolve(jsonResponse({ job_count: 3, jobs_bytes: 0 }));
      return Promise.resolve(jsonResponse({}));
    });
    render(<App />);

    expect(await screen.findAllByText("候选人 A")).not.toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "打开最近任务" }));
    fireEvent.click(await screen.findByRole("button", { name: /B/ }));
    fireEvent.click(screen.getByRole("button", { name: "打开最近任务" }));
    fireEvent.click(await screen.findByRole("button", { name: /C/ }));

    expect(await screen.findAllByText("候选人 C")).not.toHaveLength(0);
    await act(async () => {
      pendingB.resolve(jsonResponse(jobB));
      await pendingB.promise;
    });
    expect(state.currentJob?.id).toBe(jobC.id);
    expect(localStorage.getItem("talentHub.lastJob")).toBe(jobC.id);
    expect(screen.queryAllByText("候选人 B")).toHaveLength(0);
  });

  it("最新筛选任务请求失败时清除旧任务并回到初始页", async () => {
    const jobA = {
      id: "job-a",
      title: "任务 A",
      status: "completed",
      completed: 1,
      total: 1,
      results: [{ source_file: "a.pdf", candidate_name: "候选人 A", conclusion: "A优先约面", blockers: [] }],
      errors: [],
    };
    const missing = { id: "job-missing", title: "失效任务", status: "completed" };
    localStorage.setItem("talentHub.lastJob", jobA.id);
    fetchMock.mockImplementation((url: string) => {
      const value = String(url);
      if (value === "/api/bootstrap") return Promise.resolve(jsonResponse(readySettings()));
      if (value === `/api/jobs/${jobA.id}`) return Promise.resolve(jsonResponse(jobA));
      if (value === `/api/jobs/${missing.id}`) {
        return Promise.resolve(jsonResponse({ detail: "任务不存在" }, { status: 404 }));
      }
      if (value.startsWith("/api/jobs?scope=recent")) {
        return Promise.resolve(jsonResponse({ jobs: [missing], total: 1 }));
      }
      if (value.startsWith("/api/jobs?scope=archived")) return Promise.resolve(jsonResponse({ jobs: [], total: 0 }));
      if (value === "/api/storage") return Promise.resolve(jsonResponse({ job_count: 1, jobs_bytes: 0 }));
      return Promise.resolve(jsonResponse({}));
    });
    render(<App />);

    expect(await screen.findAllByText("候选人 A")).not.toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "打开最近任务" }));
    fireEvent.click(await screen.findByRole("button", { name: /失效任务/ }));

    expect(await screen.findByText("任务不存在")).toBeInTheDocument();
    expect(state.currentJob).toBeNull();
    expect(localStorage.getItem("talentHub.lastJob")).toBeNull();
    expect(document.getElementById("setupView")!.hidden).toBe(false);
    expect(document.getElementById("resultsView")!.hidden).toBe(true);
  });

});
