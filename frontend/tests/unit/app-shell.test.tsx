// =====================================================================
// 应用根组件（src/App.tsx）shell 渲染与交互测试（jsdom）。
// 覆盖：bootstrap 成功渲染顶栏与默认视图、启动 loading 隐藏、state.settings/jobs
// 写入、连接状态（is_ready 显示已连接模型名 / 未配置显示待配置）、语言切换
// （i18n 语言变化 + document.title / html lang 更新）、历史按钮打开抽屉、
// 设置按钮打开弹窗、未配置模型自动打开设置弹窗、退出确认流程、bootstrap 分流
// （activeTool=phone / lastJob 按状态路由）。
// 仅做渲染级断言，不含截图验证（视觉回归待页面接入后由 Playwright baseline 补齐）。
// =====================================================================

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

describe("连接状态", () => {
  it("is_ready=true 时 configDot 就绪并显示已连接模型名", async () => {
    mockBootstrap(readySettings());
    render(<App />);

    await waitBootstrap();
    expect(document.getElementById("configDot")!.classList.contains("ready")).toBe(true);
    expect(document.getElementById("configStatus")!.textContent).toBe("gpt-4o-mini 已连接");
  });

  it("is_ready=false 时 configDot 未就绪并显示待配置", async () => {
    mockBootstrap({ settings: { is_ready: false }, jobs: [] });
    render(<App />);

    await waitBootstrap();
    expect(document.getElementById("configDot")!.classList.contains("ready")).toBe(false);
    expect(document.getElementById("configStatus")!.textContent).toBe("待配置模型");
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
  it("历史按钮打开任务记录抽屉", async () => {
    mockBootstrap(readySettings());
    render(<App />);
    await waitBootstrap();

    // 抽屉打开后请求列表与存储占用（bootstrap 已完成，替换实现供抽屉使用）
    fetchMock.mockImplementation((url: string) => {
      if (String(url).startsWith("/api/jobs")) return Promise.resolve(jsonResponse({ jobs: [], total: 0 }));
      if (String(url).startsWith("/api/calls")) return Promise.resolve(jsonResponse({ calls: [], total: 0 }));
      if (String(url) === "/api/storage") return Promise.resolve(jsonResponse({ job_count: 0, jobs_bytes: 0 }));
      return Promise.resolve(jsonResponse({}));
    });

    fireEvent.click(screen.getByRole("button", { name: "打开最近任务" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "任务记录" })).toBeInTheDocument();
  });

  it("设置按钮打开设置弹窗", async () => {
    mockBootstrap(readySettings());
    render(<App />);
    await waitBootstrap();

    fireEvent.click(screen.getByRole("button", { name: "模型配置" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "模型服务" })).toBeInTheDocument();
  });

  it("未配置模型（is_ready=false）时自动打开设置弹窗", async () => {
    mockBootstrap({ settings: { is_ready: false }, jobs: [] });
    render(<App />);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "模型服务" })).toBeInTheDocument();
    expect(document.getElementById("configStatus")!.textContent).toBe("待配置模型");
  });

  it("退出确认：确认后 POST /api/shutdown 并展示退出页", async () => {
    mockBootstrap(readySettings());
    render(<App />);
    await waitBootstrap();

    const confirmMock = vi.fn().mockReturnValue(true);
    vi.stubGlobal("confirm", confirmMock);

    fireEvent.click(screen.getByRole("button", { name: "退出应用" }));

    expect(await screen.findByRole("heading", { name: "招聘工作台已退出" })).toBeInTheDocument();
    expect(screen.getByText("可以关闭此页面")).toBeInTheDocument();
    expect(confirmMock).toHaveBeenCalledWith("退出招聘工作台？运行中的任务会被中断。");
    const shutdownCall = fetchMock.mock.calls.find((call) => call[0] === "/api/shutdown");
    expect(shutdownCall).toBeDefined();
    expect(shutdownCall![1].method).toBe("POST");
  });

  it("退出取消：confirm 返回 false 时不发请求、不切换退出页", async () => {
    mockBootstrap(readySettings());
    render(<App />);
    await waitBootstrap();

    vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));
    fireEvent.click(screen.getByRole("button", { name: "退出应用" }));

    expect(fetchMock.mock.calls.some((call) => call[0] === "/api/shutdown")).toBe(false);
    expect(screen.queryByRole("heading", { name: "招聘工作台已退出" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "退出应用" })).toBeInTheDocument();
  });
});
