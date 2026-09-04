// =====================================================================
// 电话任务创建、轮询与取消、追加录音、历史删除与切换隔离、归档恢复和重试。
// 仅做渲染级断言，不含截图验证。
// =====================================================================

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/App";
import { state } from "../../src/state";

let fetchMock: ReturnType<typeof vi.fn>;

function readySettings() {
  return {
    settings: { is_ready: true, asr_configured: true, model: "gpt-4o-mini", base_url: "https://api.openai.com/v1" },
    jobs: [],
  };
}

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

beforeEach(() => {
  state.settings = null;
  state.currentCall = null;
  state.currentJob = null;
  state.pendingCallFiles = [];
  state.pollTimer = null;
  state.callPollTimer = null;
  state.language = "zh-CN";
  localStorage.clear();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  if (state.callPollTimer) clearTimeout(state.callPollTimer);
  if (state.pollTimer) clearTimeout(state.pollTimer);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  state.settings = null;
  state.currentCall = null;
  state.currentJob = null;
  state.pendingCallFiles = [];
  state.pollTimer = null;
  state.callPollTimer = null;
  state.language = "zh-CN";
  localStorage.clear();
});

/** 默认兜底：未匹配路由返回 ok */
function mockServer(handler: (url: URL, init: RequestInit | undefined) => Response | Promise<Response>) {
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    return handler(url, init);
  });
}

async function waitBootstrap() {
  await waitFor(() => expect(document.getElementById("startupLoading")!.hidden).toBe(true));
}

describe("新建表单", () => {
  it("渲染表单；关联岗位联动导入维度；提交 POST /api/calls 后上传录音并 process", async () => {
    let callState: Record<string, unknown> | null = null;
    mockServer((url, init) => {
      const method = init?.method ?? "GET";
      if (url.pathname === "/api/bootstrap") return Promise.resolve(jsonResponse(readySettings()));
      if (url.pathname === "/api/jobs" && method === "GET") {
        return Promise.resolve(jsonResponse({ jobs: [{ id: "j1", title: "后端工程师" }] }));
      }
      if (url.pathname === "/api/jobs/j1/criteria-json" && method === "GET") {
        return Promise.resolve(jsonResponse({ criteria: { bonus_signals: ["自驱", "逻辑"] } }));
      }
      if (url.pathname === "/api/calls" && method === "POST") {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        callState = { id: "c1", ...body, status: "draft", items: [] };
        return Promise.resolve(jsonResponse(callState));
      }
      if (url.pathname === "/api/calls/c1/audio" && method === "PUT") {
        const filename = url.searchParams.get("filename") ?? "";
        const currentItems = (callState?.items as unknown[] | undefined) ?? [];
        callState = {
          ...callState,
          items: [...currentItems, { id: `i${currentItems.length + 1}`, audio_file: filename, status: "queued" }],
        };
        return Promise.resolve(jsonResponse({ upload: { accepted: true } }));
      }
      if (url.pathname === "/api/calls/c1" && method === "GET") {
        return Promise.resolve(jsonResponse(callState));
      }
      if (url.pathname === "/api/calls/c1/process" && method === "POST") {
        callState = { ...callState, status: "running" };
        return Promise.resolve(jsonResponse(callState));
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    localStorage.setItem("talentHub.activeTool", "phone");
    render(<App />);
    await waitBootstrap();

    // 新建表单渲染
    expect(document.getElementById("callCreateView")!.hidden).toBe(false);
    expect(screen.getByText("新建电话确认任务")).toBeInTheDocument();

    // 填写标题与岗位名
    fireEvent.change(document.getElementById("callTitleInput") as HTMLInputElement, { target: { value: "本周电话确认" } });
    fireEvent.change(document.getElementById("callJobInput") as HTMLInputElement, { target: { value: "后端工程师" } });

    // 关联岗位联动导入：bonus_signals 关键词匹配 → 自动勾选维度并填写 focus 文案
    await waitFor(() =>
      expect((document.getElementById("callJobLinkSelect") as HTMLSelectElement).options.length).toBeGreaterThan(1)
    );
    fireEvent.change(document.getElementById("callJobLinkSelect") as HTMLSelectElement, { target: { value: "j1" } });
    await screen.findByDisplayValue("来自岗位加分信号：自驱；逻辑");
    const dimBoxes = Array.from(document.querySelectorAll<HTMLInputElement>("#callSoftSkillDims input[type=checkbox]"));
    expect(dimBoxes.find((box) => box.value === "self_drive")!.checked).toBe(true);
    expect(dimBoxes.find((box) => box.value === "logic")!.checked).toBe(true);

    // 手动补充勾选一个维度
    fireEvent.click(dimBoxes.find((box) => box.value === "resilience")!);

    // 选择录音（pending 列表展示文件名）
    const file = new File(["audio-bytes"], "call-a.m4a", { type: "audio/mp4", lastModified: 111 });
    fireEvent.change(document.getElementById("callAudioFiles") as HTMLInputElement, { target: { files: [file] } });
    expect(screen.getByText("call-a.m4a")).toBeInTheDocument();

    // 开始整理：POST /api/calls → PUT audio → POST process
    fireEvent.click(document.getElementById("startCallProcessButton") as HTMLButtonElement);
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u, i]) => String(u) === "/api/calls/c1/process" && i?.method === "POST")).toBe(true)
    );

    // POST /api/calls body
    const createCall = fetchMock.mock.calls.find(([u, i]) => String(u) === "/api/calls" && i?.method === "POST")!;
    const body = JSON.parse(String(createCall[1]?.body)) as Record<string, unknown>;
    expect(body.title).toBe("本周电话确认");
    expect(body.title_mode).toBe("custom");
    expect(body.job_title).toBe("后端工程师");
    expect(body.job_id).toBe("j1");
    expect(body.soft_skill_focus).toBe("来自岗位加分信号：自驱；逻辑");
    expect(body.soft_skill_dimensions).toEqual(["self_drive", "logic", "resilience"]);

    // PUT audio：filename 查询参数 + File 直传
    const putCall = fetchMock.mock.calls.find(([u, i]) => String(u)?.startsWith("/api/calls/c1/audio?") && i?.method === "PUT")!;
    expect(String(putCall[0])).toContain("filename=call-a.m4a");
    expect(putCall[1]?.body).toBe(file);

    // process 后进入任务详情视图
    await waitFor(() => expect(document.getElementById("callDetailView")!.hidden).toBe(false));
    expect(document.getElementById("callDetailTitle")!.textContent).toBe("本周电话确认");
  });
});

describe("轮询与取消", () => {
  it(
    "轮询渲染条目状态与进度，取消后终态停止轮询",
    async () => {
      const running = {
        id: "c1",
        title: "电话确认",
        status: "running",
        errors: [],
        items: [
          { id: "i1", audio_file: "a.m4a", status: "transcribing", progress: 40 },
          { id: "i2", audio_file: "b.m4a", status: "queued", progress: 0 },
        ],
      };
      const cancelled = { ...running, status: "cancelled" };
      let cancelledFlag = false;
      let getCount = 0;
      const getCall = () => {
        getCount += 1;
        if (cancelledFlag) return jsonResponse(cancelled);
        if (getCount === 1) return jsonResponse(running);
        return jsonResponse({
          ...running,
          items: [{ ...running.items[0], progress: Math.min(40 + getCount * 20, 100) }, running.items[1]],
        });
      };
      mockServer((url, init) => {
        const method = init?.method ?? "GET";
        if (url.pathname === "/api/bootstrap") return Promise.resolve(jsonResponse(readySettings()));
        if (url.pathname === "/api/calls/c1" && method === "GET") return Promise.resolve(getCall());
        if (url.pathname === "/api/calls/c1/cancel" && method === "POST") {
          cancelledFlag = true;
          return Promise.resolve(jsonResponse(cancelled));
        }
        return Promise.resolve(jsonResponse({ ok: true }));
      });
      localStorage.setItem("talentHub.activeTool", "phone");
      localStorage.setItem("talentHub.lastCall", "c1");
      render(<App />);

      // 从历史恢复任务 → 详情视图与条目卡片（状态徽章 / 进度）
      await waitFor(() => expect(document.getElementById("callDetailTitle")!.textContent).toBe("电话确认"));
      expect(screen.getByText("转写中")).toBeInTheDocument();
      expect(screen.getByText("排队中")).toBeInTheDocument();
      expect(document.querySelectorAll(".call-item-card")).toHaveLength(2);
      expect(screen.getByText("40%")).toBeInTheDocument();

      // 2500ms 轮询刷新进度
      await waitFor(() => expect(screen.getByText("80%")).toBeInTheDocument(), { timeout: 4000 });

      // 取消：POST cancel → toast；取消按钮隐藏
      fireEvent.click(document.getElementById("callCancelButton") as HTMLButtonElement);
      await screen.findByText("任务已取消");
      expect(document.getElementById("callCancelButton")!.hidden).toBe(true);

      // 终态后停止轮询：等待可能已排期的轮询执行完毕后取基线，再验证计数不再增长
      const getCallCount = () =>
        fetchMock.mock.calls.filter(([u, i]) => String(u) === "/api/calls/c1" && (i?.method ?? "GET") === "GET").length;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 2600));
      });
      const afterTerminal = getCallCount();
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 2600));
      });
      expect(getCallCount()).toBe(afterTerminal);
    },
    15000
  );
});

describe("追加录音", () => {
  it("done 且未归档显示 FAB，追加新录音后自动 process，running 后隐藏", async () => {
    const doneCall = {
      id: "c2",
      title: "已完成电话",
      status: "done",
      updated_at: "2026-08-30T10:00:00+08:00",
      errors: [],
      items: [{ id: "i1", audio_file: "a.m4a", candidate_name: "张三", status: "done" }],
    };
    let callState: {
      id: string;
      title: string;
      status: string;
      updated_at: string;
      errors: string[];
      items: Array<Record<string, unknown>>;
    } = doneCall;
    mockServer((url, init) => {
      const method = init?.method ?? "GET";
      if (url.pathname === "/api/bootstrap") return Promise.resolve(jsonResponse(readySettings()));
      if (url.pathname === "/api/calls/c2" && method === "GET") return Promise.resolve(jsonResponse(callState));
      if (url.pathname === "/api/calls/c2/audio" && method === "PUT") {
        const filename = url.searchParams.get("filename") ?? "";
        callState = { ...callState, items: [...callState.items, { id: "i2", audio_file: filename, status: "queued" }] };
        return Promise.resolve(jsonResponse({ upload: { accepted: true } }));
      }
      if (url.pathname === "/api/calls/c2/process" && method === "POST") {
        callState = { ...callState, status: "running" };
        return Promise.resolve(jsonResponse(callState));
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    localStorage.setItem("talentHub.activeTool", "phone");
    localStorage.setItem("talentHub.lastCall", "c2");
    render(<App />);

    await waitFor(() => expect(document.getElementById("callDetailTitle")!.textContent).toBe("已完成电话"));
    await waitFor(() => expect(document.getElementById("appendCallAudioButton")!.hidden).toBe(false));

    const fresh = new File(["y"], "new.m4a", { lastModified: 111 });
    fireEvent.change(document.getElementById("appendCallAudioFiles") as HTMLInputElement, { target: { files: [fresh] } });
    // 追加后自动 process
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u, i]) => String(u) === "/api/calls/c2/process" && i?.method === "POST")).toBe(true)
    );
    // process 后 running → FAB 隐藏
    await waitFor(() => expect(document.getElementById("appendCallAudioButton")!.hidden).toBe(true));
  });

});

describe("历史任务删除", () => {
  it("删除当前电话任务后立即回到新建表单并清除恢复状态", async () => {
    const call = {
      id: "c-delete",
      title: "待删除电话",
      status: "done",
      errors: [],
      items: [{ id: "i1", audio_file: "a.m4a", status: "done" }],
    };
    let deleted = false;
    mockServer((url, init) => {
      const method = init?.method ?? "GET";
      if (url.pathname === "/api/bootstrap") return Promise.resolve(jsonResponse(readySettings()));
      if (url.pathname === "/api/calls/c-delete" && method === "GET") return Promise.resolve(jsonResponse(call));
      if (url.pathname === "/api/calls/c-delete" && method === "DELETE") {
        deleted = true;
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      if (url.pathname === "/api/calls" && method === "GET") {
        return Promise.resolve(jsonResponse({ calls: deleted ? [] : [call], total: deleted ? 0 : 1 }));
      }
      if (url.pathname === "/api/storage") return Promise.resolve(jsonResponse({ job_count: 0, jobs_bytes: 0 }));
      if (url.pathname === "/api/jobs") return Promise.resolve(jsonResponse({ jobs: [], total: 0 }));
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    localStorage.setItem("talentHub.activeTool", "phone");
    localStorage.setItem("talentHub.lastCall", call.id);
    render(<App />);

    await waitFor(() => expect(document.getElementById("callDetailTitle")!.textContent).toBe(call.title));
    fireEvent.click(screen.getByRole("button", { name: "打开最近任务" }));
    await screen.findByRole("button", { name: /待删除电话/ });
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "永久删除" }));
    fireEvent.click(screen.getByRole("button", { name: "永久删除" }));

    await waitFor(() => expect(state.currentCall).toBeNull());
    expect(localStorage.getItem("talentHub.lastCall")).toBeNull();
    expect(document.getElementById("callCreateView")!.hidden).toBe(false);
    expect(document.getElementById("callDetailView")!.hidden).toBe(true);
  });

  it("归档与恢复当前电话任务后立即同步追加按钮状态", async () => {
    const call = {
      id: "c-lifecycle",
      title: "电话状态同步",
      status: "done",
      errors: [],
      items: [{ id: "i1", audio_file: "a.m4a", status: "done" }],
    };
    let archived = false;
    mockServer((url, init) => {
      const method = init?.method ?? "GET";
      if (url.pathname === "/api/bootstrap") return Promise.resolve(jsonResponse(readySettings()));
      if (url.pathname === "/api/calls/c-lifecycle" && method === "GET") {
        return Promise.resolve(jsonResponse({ ...call, archived_at: archived ? "2026-09-03T12:00:00+08:00" : null }));
      }
      if (url.pathname === "/api/calls/c-lifecycle/archive" && method === "POST") {
        archived = true;
        return Promise.resolve(jsonResponse({ id: call.id, archived_at: "2026-09-03T12:00:00+08:00" }));
      }
      if (url.pathname === "/api/calls/c-lifecycle/restore" && method === "POST") {
        archived = false;
        return Promise.resolve(jsonResponse({ id: call.id, archived_at: null }));
      }
      if (url.pathname === "/api/calls" && method === "GET") {
        const wantsArchived = url.searchParams.get("scope") === "archived";
        const visible = wantsArchived === archived;
        return Promise.resolve(jsonResponse({ calls: visible ? [{ ...call, archived_at: archived ? "2026-09-03T12:00:00+08:00" : null }] : [], total: visible ? 1 : 0 }));
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    localStorage.setItem("talentHub.activeTool", "phone");
    localStorage.setItem("talentHub.lastCall", call.id);
    render(<App />);

    await waitFor(() => expect(document.getElementById("appendCallAudioButton")!.hidden).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "打开最近任务" }));
    await screen.findByRole("button", { name: /电话状态同步/ });
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "归档" }));

    await waitFor(() => expect(state.currentCall?.archived_at).toBe("2026-09-03T12:00:00+08:00"));
    expect(document.getElementById("appendCallAudioButton")!.hidden).toBe(true);

    fireEvent.click(screen.getByRole("tab", { name: /已归档/ }));
    await screen.findByRole("button", { name: /电话状态同步/ });
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "恢复到最近任务" }));

    await waitFor(() => expect(state.currentCall?.archived_at).toBeNull());
    expect(document.getElementById("appendCallAudioButton")!.hidden).toBe(false);
  });
});

describe("历史任务切换", () => {
  it("较早请求迟到时保持最后选择的电话任务", async () => {
    const callA = { id: "call-a", title: "任务 A", status: "done", errors: [], items: [] };
    const callB = { id: "call-b", title: "任务 B", status: "done", errors: [], items: [] };
    const callC = { id: "call-c", title: "任务 C", status: "done", errors: [], items: [] };
    const pendingB = deferred<Response>();
    mockServer((url, init) => {
      const method = init?.method ?? "GET";
      if (url.pathname === "/api/bootstrap") return Promise.resolve(jsonResponse(readySettings()));
      if (url.pathname === "/api/calls/call-a" && method === "GET") return Promise.resolve(jsonResponse(callA));
      if (url.pathname === "/api/calls/call-b" && method === "GET") return pendingB.promise;
      if (url.pathname === "/api/calls/call-c" && method === "GET") return Promise.resolve(jsonResponse(callC));
      if (url.pathname === "/api/calls" && method === "GET") {
        return Promise.resolve(jsonResponse({ calls: [callB, callC], total: 2 }));
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    localStorage.setItem("talentHub.activeTool", "phone");
    localStorage.setItem("talentHub.lastCall", callA.id);
    render(<App />);

    await waitFor(() => expect(document.getElementById("callDetailTitle")!.textContent).toBe(callA.title));
    fireEvent.click(screen.getByRole("button", { name: "打开最近任务" }));
    fireEvent.click(await screen.findByRole("button", { name: /任务 B/ }));
    fireEvent.click(screen.getByRole("button", { name: "打开最近任务" }));
    fireEvent.click(await screen.findByRole("button", { name: /任务 C/ }));

    await waitFor(() => expect(document.getElementById("callDetailTitle")!.textContent).toBe(callC.title));
    await act(async () => {
      pendingB.resolve(jsonResponse(callB));
      await pendingB.promise;
    });
    expect(state.currentCall?.id).toBe(callC.id);
    expect(localStorage.getItem("talentHub.lastCall")).toBe(callC.id);
  });

  it("最新电话任务请求失败时清除旧详情并回到新建表单", async () => {
    const current = { id: "call-current", title: "当前任务", status: "done", errors: [], items: [] };
    const missing = { id: "call-missing", title: "失效任务", status: "done" };
    mockServer((url, init) => {
      const method = init?.method ?? "GET";
      if (url.pathname === "/api/bootstrap") return Promise.resolve(jsonResponse(readySettings()));
      if (url.pathname === "/api/calls/call-current" && method === "GET") return Promise.resolve(jsonResponse(current));
      if (url.pathname === "/api/calls/call-missing" && method === "GET") {
        return Promise.resolve(jsonResponse({ detail: "任务不存在" }, { status: 404 }));
      }
      if (url.pathname === "/api/calls" && method === "GET") {
        return Promise.resolve(jsonResponse({ calls: [missing], total: 1 }));
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    localStorage.setItem("talentHub.activeTool", "phone");
    localStorage.setItem("talentHub.lastCall", current.id);
    render(<App />);

    await waitFor(() => expect(document.getElementById("callDetailTitle")!.textContent).toBe(current.title));
    fireEvent.click(screen.getByRole("button", { name: "打开最近任务" }));
    fireEvent.click(await screen.findByRole("button", { name: /失效任务/ }));

    expect(await screen.findByText("任务不存在")).toBeInTheDocument();
    expect(state.currentCall).toBeNull();
    expect(localStorage.getItem("talentHub.lastCall")).toBeNull();
    expect(document.getElementById("callCreateView")!.hidden).toBe(false);
    expect(document.getElementById("callDetailView")!.hidden).toBe(true);
  });
});

describe("重试", () => {
  it("failed 任务显示重试按钮，点击后 process 并进入 running", async () => {
    const failedCall = {
      id: "c3",
      title: "失败任务",
      status: "failed",
      errors: ["处理失败"],
      items: [{ id: "i1", audio_file: "a.m4a", status: "failed", error: "转写失败" }],
    };
    let callState = failedCall;
    mockServer((url, init) => {
      const method = init?.method ?? "GET";
      if (url.pathname === "/api/bootstrap") return Promise.resolve(jsonResponse(readySettings()));
      if (url.pathname === "/api/calls/c3" && method === "GET") return Promise.resolve(jsonResponse(callState));
      if (url.pathname === "/api/calls/c3/process" && method === "POST") {
        callState = { ...callState, status: "running", errors: [] };
        return Promise.resolve(jsonResponse(callState));
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    localStorage.setItem("talentHub.activeTool", "phone");
    localStorage.setItem("talentHub.lastCall", "c3");
    render(<App />);

    await waitFor(() => expect(document.getElementById("callDetailTitle")!.textContent).toBe("失败任务"));
    // 条目错误与任务错误列表
    expect(screen.getByText("转写失败")).toBeInTheDocument();
    expect(screen.getByText("处理失败")).toBeInTheDocument();
    // 取消隐藏、重试可见
    expect(document.getElementById("callCancelButton")!.hidden).toBe(true);
    expect(document.getElementById("callRetryButton")!.hidden).toBe(false);

    fireEvent.click(document.getElementById("callRetryButton") as HTMLButtonElement);
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u, i]) => String(u) === "/api/calls/c3/process" && i?.method === "POST")).toBe(true)
    );
    // running 后重试按钮隐藏
    await waitFor(() => expect(document.getElementById("callRetryButton")!.hidden).toBe(true));
  });
});
