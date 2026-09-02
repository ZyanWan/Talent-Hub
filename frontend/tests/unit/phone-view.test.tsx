// =====================================================================
// 电话确认任务流视图（src/views/PhoneView.tsx，经 src/App.tsx 集成）渲染与交互测试（jsdom）。
// 覆盖：新建表单渲染与提交（POST /api/calls body 含 soft_skill_focus/dimensions）、
// 关联岗位联动导入（criteria-json bonus_signals 关键词匹配预设维度）、录音上传
// （PUT audio 直传 File + upload.accepted=false/duplicate_of 判重）、全部重复 →
// noNewAudio 不触发整理且表单保留草稿关联信息、process 触发、轮询渲染条目状态与
// 进度与取消（终态后停止轮询）、追加录音（done 且未归档显示 FAB，追加后自动 process；
// 全部重复 → noNewAudio；归档任务隐藏且忽略）、重试、错误处理（上传失败 toast）。
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

describe("录音上传与去重", () => {
  it("全部重复 → noNewAudio 不触发 process；表单保留草稿关联信息", async () => {
    const draftCall = {
      id: "c1",
      title: "默认标题",
      status: "draft",
      items: [],
      soft_skill_focus: "来自岗位加分信号：自驱",
      job_id: "j1",
      soft_skill_dimensions: ["self_drive"],
    };
    mockServer((url, init) => {
      const method = init?.method ?? "GET";
      if (url.pathname === "/api/bootstrap") return Promise.resolve(jsonResponse(readySettings()));
      if (url.pathname === "/api/jobs" && method === "GET") {
        return Promise.resolve(jsonResponse({ jobs: [{ id: "j1", title: "后端工程师" }] }));
      }
      if (url.pathname === "/api/calls" && method === "POST") return Promise.resolve(jsonResponse(draftCall));
      if (url.pathname === "/api/calls/c1/audio" && method === "PUT") {
        return Promise.resolve(jsonResponse({ upload: { accepted: false, duplicate_of: "a.m4a" } }));
      }
      if (url.pathname === "/api/calls/c1" && method === "GET") return Promise.resolve(jsonResponse(draftCall));
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    localStorage.setItem("talentHub.activeTool", "phone");
    render(<App />);
    await waitBootstrap();

    const file = new File(["x"], "a.m4a", { lastModified: 111 });
    fireEvent.change(document.getElementById("callAudioFiles") as HTMLInputElement, { target: { files: [file] } });
    fireEvent.click(document.getElementById("startCallProcessButton") as HTMLButtonElement);

    // 全部重复：noNewAudio 提示，不触发 process
    await screen.findByText("所选录音均已存在，无需重新整理");
    expect(fetchMock.mock.calls.some(([u, i]) => String(u) === "/api/calls/c1/process" && i?.method === "POST")).toBe(false);
    // 表单保留草稿关联信息（focus 文案与关联岗位）；回填经 useEffect 异步落地，等待其完成
    expect(document.getElementById("callCreateView")!.hidden).toBe(false);
    await waitFor(() => {
      expect((document.getElementById("callSoftSkillInput") as HTMLTextAreaElement).value).toBe("来自岗位加分信号：自驱");
      expect((document.getElementById("callJobLinkSelect") as HTMLSelectElement).value).toBe("j1");
    });
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

  it("追加全部重复 → noNewAudio 提示，不触发 process", async () => {
    const doneCall = {
      id: "c2",
      title: "已完成电话",
      status: "done",
      errors: [],
      items: [{ id: "i1", audio_file: "a.m4a", status: "done" }],
    };
    mockServer((url, init) => {
      const method = init?.method ?? "GET";
      if (url.pathname === "/api/bootstrap") return Promise.resolve(jsonResponse(readySettings()));
      if (url.pathname === "/api/calls/c2" && method === "GET") return Promise.resolve(jsonResponse(doneCall));
      if (url.pathname === "/api/calls/c2/audio" && method === "PUT") {
        return Promise.resolve(jsonResponse({ upload: { accepted: false, duplicate_of: "a.m4a" } }));
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    localStorage.setItem("talentHub.activeTool", "phone");
    localStorage.setItem("talentHub.lastCall", "c2");
    render(<App />);

    await waitFor(() => expect(document.getElementById("callDetailTitle")!.textContent).toBe("已完成电话"));
    await waitFor(() => expect(document.getElementById("appendCallAudioButton")!.hidden).toBe(false));

    const dup = new File(["a"], "a.m4a", { lastModified: 111 });
    fireEvent.change(document.getElementById("appendCallAudioFiles") as HTMLInputElement, { target: { files: [dup] } });
    await screen.findByText("所选录音均已存在，无需重新整理");
    expect(fetchMock.mock.calls.some(([u, i]) => String(u) === "/api/calls/c2/process" && i?.method === "POST")).toBe(false);
  });

  it("归档任务：FAB 隐藏，追加文件被忽略", async () => {
    const archivedCall = {
      id: "c2",
      title: "已完成电话",
      status: "done",
      archived_at: "2026-08-30T10:00:00+08:00",
      errors: [],
      items: [{ id: "i1", audio_file: "a.m4a", status: "done" }],
    };
    mockServer((url, init) => {
      const method = init?.method ?? "GET";
      if (url.pathname === "/api/bootstrap") return Promise.resolve(jsonResponse(readySettings()));
      if (url.pathname === "/api/calls/c2" && method === "GET") return Promise.resolve(jsonResponse(archivedCall));
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    localStorage.setItem("talentHub.activeTool", "phone");
    localStorage.setItem("talentHub.lastCall", "c2");
    render(<App />);

    await waitFor(() => expect(document.getElementById("callDetailTitle")!.textContent).toBe("已完成电话"));
    expect(document.getElementById("appendCallAudioButton")!.hidden).toBe(true);

    const dup = new File(["a"], "a.m4a", { lastModified: 111 });
    fireEvent.change(document.getElementById("appendCallAudioFiles") as HTMLInputElement, { target: { files: [dup] } });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(fetchMock.mock.calls.some(([u, i]) => String(u)?.includes("/audio") && i?.method === "PUT")).toBe(false);
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

describe("错误处理", () => {
  it("录音上传失败展示 toast，停留在新建表单", async () => {
    const draftCall = { id: "c1", title: "本周电话确认", status: "draft", items: [] };
    mockServer((url, init) => {
      const method = init?.method ?? "GET";
      if (url.pathname === "/api/bootstrap") return Promise.resolve(jsonResponse(readySettings()));
      if (url.pathname === "/api/calls" && method === "POST") return Promise.resolve(jsonResponse(draftCall));
      if (url.pathname === "/api/calls/c1/audio" && method === "PUT") {
        return Promise.resolve(jsonResponse({ detail: "上传失败" }, { status: 500 }));
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    localStorage.setItem("talentHub.activeTool", "phone");
    render(<App />);
    await waitBootstrap();

    const file = new File(["x"], "a.m4a", { lastModified: 111 });
    fireEvent.change(document.getElementById("callAudioFiles") as HTMLInputElement, { target: { files: [file] } });
    fireEvent.click(document.getElementById("startCallProcessButton") as HTMLButtonElement);

    await screen.findByText("上传失败");
    // 停留在新建表单
    expect(document.getElementById("callCreateView")!.hidden).toBe(false);
  });
});
