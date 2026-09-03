// =====================================================================
// 简历筛选任务流视图（src/views/ScreeningView.tsx，经 src/App.tsx 集成）渲染与交互测试（jsdom）。
// 覆盖：setup 渲染与文件选择去重（name:size:lastModified）、创建任务并上传（含
// duplicate_of 分支与请求顺序）、progress 轮询渲染与取消（终态后停止轮询）、
// criteriaReview 表单编辑与保存并开始、results 汇总统计 / A/B/C 过滤 / 对比勾选、
// 归档任务禁止追加、追加简历（全部重复 → noNewResumes；新文件 → 重新 start）、
// 历史侧栏归档/恢复/删除当前任务后的工作区同步、下载评估表格（PreviewDialog + Blob）。
// 仅做渲染级断言，不含截图验证（视觉回归由 tests/visual/baseline.spec.ts 覆盖）。
// =====================================================================

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/App";
import { state } from "../../src/state";

let fetchMock: ReturnType<typeof vi.fn>;

function readySettings() {
  return { settings: { is_ready: true, model: "gpt-4o-mini", base_url: "https://api.openai.com/v1" }, jobs: [] };
}

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

beforeEach(() => {
  state.settings = null;
  state.jobs = [];
  state.currentJob = null;
  state.selectedResumes = [];
  state.resultFilter = "all";
  state.compareSelection = new Set();
  state.liveResultKeys = null;
  state.language = "zh-CN";
  localStorage.clear();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  state.settings = null;
  state.jobs = [];
  state.currentJob = null;
  state.selectedResumes = [];
  state.resultFilter = "all";
  state.compareSelection = new Set();
  state.liveResultKeys = null;
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

/** 构造带 lastJob 的启动 mock（bootstrap + GET /api/jobs/{id}） */
function mockBootstrapWithJob(job: Record<string, unknown>) {
  const jobId = String(job.id);
  mockServer((url, init) => {
    if (url.pathname === "/api/bootstrap") return Promise.resolve(jsonResponse(readySettings()));
    if (url.pathname === `/api/jobs/${jobId}` && (init?.method ?? "GET") === "GET") {
      return Promise.resolve(jsonResponse(job));
    }
    return Promise.resolve(jsonResponse({ ok: true }));
  });
  localStorage.setItem("talentHub.lastJob", jobId);
}

function runningJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "j1",
    title: "岗位候选人筛选",
    status: "running",
    stage: "评估候选人",
    progress: 10,
    completed: 1,
    total: 5,
    results: [],
    errors: [],
    elapsed_seconds: 30,
    ...overrides,
  };
}

function completedJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "j1",
    title: "后端工程师",
    status: "completed",
    stage: "筛选完成",
    progress: 100,
    completed: 4,
    total: 4,
    elapsed_seconds: 120,
    errors: [],
    results: [
      { source_file: "a.pdf", candidate_name: "张三", conclusion: "A优先约面", one_line: "经验匹配", blockers: [], next_action: "约面" },
      { source_file: "b.pdf", candidate_name: "李四", conclusion: "A优先约面", one_line: "成长快", blockers: [], next_action: "约面" },
      { source_file: "c.pdf", candidate_name: "王五", conclusion: "B电话确认", one_line: "需确认", blockers: [], next_action: "电话" },
      { source_file: "d.pdf", candidate_name: "赵六", conclusion: "C不推进", one_line: "方向不符", blockers: ["行业不符"], next_action: "不推进" },
    ],
    ...overrides,
  };
}

describe("setup 视图", () => {
  it("渲染 JD 输入与拖拽区，文件选择按 name:size:lastModified 去重", async () => {
    mockServer(() => Promise.resolve(jsonResponse(readySettings())));
    render(<App />);
    await waitBootstrap();

    const jd = document.getElementById("jdText") as HTMLTextAreaElement;
    const start = document.getElementById("startButton") as HTMLButtonElement;
    expect(jd).toBeTruthy();
    expect(document.getElementById("resumeDropZone")).toBeTruthy();
    expect(start.disabled).toBe(true);

    const f1 = new File(["a"], "resume-a.pdf", { lastModified: 111 });
    const f1dup = new File(["a"], "resume-a.pdf", { lastModified: 111 });
    const f2 = new File(["b"], "resume-b.pdf", { lastModified: 222 });
    fireEvent.change(document.getElementById("resumeFiles") as HTMLInputElement, {
      target: { files: [f1, f1dup, f2] },
    });

    // name:size:lastModified 全同视为重复，去重后 2 份
    expect(document.getElementById("resumeMaterialMeta")!.textContent).toContain("2 份");

    fireEvent.change(jd, { target: { value: "招聘后端工程师" } });
    expect(start.disabled).toBe(false);
  });

  it("点击候选人简历卡片打开简历工作台（本地模式）并渲染 PDF", async () => {
    mockServer((url, init) => {
      if (url.pathname === "/api/bootstrap") return Promise.resolve(jsonResponse(readySettings()));
      if (url.pathname === "/api/resumes/preview") {
        return Promise.resolve(jsonResponse({ page_count: 1, pages: [{ index: 1, data: "data:image/png;base64,AAA" }] }));
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    render(<App />);
    await waitBootstrap();

    const f1 = new File(["a"], "resume-a.pdf", { lastModified: 111 });
    fireEvent.change(document.getElementById("resumeFiles") as HTMLInputElement, { target: { files: [f1] } });
    fireEvent.click(document.getElementById("openResumeWorkspaceButton") as HTMLButtonElement);

    expect(await screen.findByRole("dialog", { name: "候选人简历" })).toBeInTheDocument();
    expect(await screen.findByRole("img", { name: "resume-a.pdf - 1" })).toHaveAttribute("src", "data:image/png;base64,AAA");
  });
});

describe("创建任务并上传", () => {
  it("POST /api/jobs → PUT jd → 逐份上传（accepted/duplicate_of）→ POST start，展示重复提示", async () => {
    const created = { id: "j1", title: "岗位候选人筛选", status: "draft" };
    const jdSaved = { id: "j1", title: "岗位候选人筛选", status: "draft", stage: "JD 已就绪" };
    const started = { id: "j1", title: "岗位候选人筛选", status: "queued", stage: "准备处理", progress: 1, total: 2, results: [], errors: [] };

    mockServer((url, init) => {
      const method = init?.method ?? "GET";
      if (url.pathname === "/api/bootstrap") return Promise.resolve(jsonResponse(readySettings()));
      if (url.pathname === "/api/jobs" && method === "POST") {
        return Promise.resolve(jsonResponse(created));
      }
      if (url.pathname === "/api/jobs/j1/jd" && method === "PUT") {
        return Promise.resolve(jsonResponse(jdSaved));
      }
      if (url.pathname.startsWith("/api/jobs/j1/resumes") && method === "PUT") {
        const filename = url.searchParams.get("filename");
        if (filename === "resume-b.pdf") {
          return Promise.resolve(jsonResponse({ upload: { accepted: false, duplicate_of: "resume-a.pdf" } }));
        }
        return Promise.resolve(jsonResponse({ upload: { accepted: true } }));
      }
      if (url.pathname === "/api/jobs/j1/start" && method === "POST") {
        return Promise.resolve(jsonResponse(started));
      }
      if (url.pathname === "/api/jobs/j1" && method === "GET") {
        return Promise.resolve(jsonResponse(started));
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });

    render(<App />);
    await waitBootstrap();

    fireEvent.change(document.getElementById("jdText") as HTMLTextAreaElement, { target: { value: "招聘后端工程师" } });
    const f1 = new File(["a"], "resume-a.pdf", { lastModified: 111 });
    const f2 = new File(["b"], "resume-b.pdf", { lastModified: 222 });
    fireEvent.change(document.getElementById("resumeFiles") as HTMLInputElement, {
      target: { files: [f1, f2] },
    });

    fireEvent.click(document.getElementById("startButton") as HTMLButtonElement);

    // 上传完成后进入 progress 视图并提示重复简历
    await screen.findByText("已自动忽略 1 份内容重复的简历");
    expect(document.getElementById("progressView")!.hidden).toBe(false);
    expect(document.getElementById("progressStage")!.textContent).toBe("准备处理");

    const entries = fetchMock.mock.calls as Array<[string, RequestInit | undefined]>;
    const createIdx = entries.findIndex(([u, i]) => String(u) === "/api/jobs" && i?.method === "POST");
    const jdIdx = entries.findIndex(([u, i]) => String(u) === "/api/jobs/j1/jd" && i?.method === "PUT");
    const resumeIdxs = entries
      .map((entry, idx) => ({ entry, idx }))
      .filter(({ entry }) => String(entry[0]).startsWith("/api/jobs/j1/resumes?") && entry[1]?.method === "PUT")
      .map(({ idx }) => idx);
    const startIdx = entries.findIndex(([u, i]) => String(u) === "/api/jobs/j1/start" && i?.method === "POST");

    expect(createIdx).toBeGreaterThanOrEqual(0);
    expect(jdIdx).toBeGreaterThan(createIdx);
    expect(resumeIdxs).toHaveLength(2);
    expect(resumeIdxs[0]).toBeGreaterThan(jdIdx);
    expect(startIdx).toBeGreaterThan(resumeIdxs[1]);
    expect(String(entries[resumeIdxs[0]][0])).toContain("filename=resume-a.pdf");
    expect(String(entries[resumeIdxs[1]][0])).toContain("filename=resume-b.pdf");

    const jdBody = JSON.parse(String(entries[jdIdx][1]?.body)) as { text: string };
    expect(jdBody.text).toBe("招聘后端工程师");
  });
});

describe("progress 轮询", () => {
  it(
    "轮询刷新进度，取消后继续轮询至终态并停止",
    async () => {
      const jobId = "j1";
      let pollCount = 0;
      const cancelResult = { id: jobId, title: "岗位候选人筛选", status: "cancelled", stage: "已取消", progress: 55, completed: 3, total: 5, results: [], errors: [] };
      const getJob = () => {
        pollCount += 1;
        if (pollCount === 1) return jsonResponse(runningJob());
        if (pollCount === 2) return jsonResponse(runningJob({ progress: 55, completed: 3, stage: "评估候选人 3/5" }));
        return jsonResponse(cancelResult);
      };
      mockServer((url, init) => {
        const method = init?.method ?? "GET";
        if (url.pathname === "/api/bootstrap") return Promise.resolve(jsonResponse(readySettings()));
        if (url.pathname === `/api/jobs/${jobId}` && method === "GET") return Promise.resolve(getJob());
        if (url.pathname === `/api/jobs/${jobId}/cancel` && method === "POST") {
          return Promise.resolve(jsonResponse(cancelResult));
        }
        return Promise.resolve(jsonResponse({ ok: true }));
      });
      localStorage.setItem("talentHub.lastJob", jobId);
      render(<App />);

      // 打开任务 → progress 视图显示初始阶段与进度
      await waitFor(() => expect(document.getElementById("progressStage")!.textContent).toBe("评估候选人"));
      expect(document.getElementById("progressPercent")!.textContent).toBe("10%");

      // 轮询 1200ms 后刷新进度
      await waitFor(() => expect(document.getElementById("progressPercent")!.textContent).toBe("55%"), { timeout: 4000 });

      // 取消：POST cancel → 继续轮询至终态 toast
      fireEvent.click(document.getElementById("cancelJobButton") as HTMLButtonElement);
      await waitFor(() => expect(screen.getByText("任务已取消")).toBeInTheDocument(), { timeout: 4000 });

      // 终态后不再轮询（等待超过一个轮询周期验证 GET 计数不再增长）
      const getCount = () =>
        fetchMock.mock.calls.filter(([u, i]) => String(u) === `/api/jobs/${jobId}` && (i?.method ?? "GET") === "GET").length;
      const afterTerminal = getCount();
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1300));
      });
      expect(getCount()).toBe(afterTerminal);
    },
    15000
  );
});

describe("criteriaReview 表单", () => {
  it("拉取标准渲染编辑器，修改后保存并开始筛选", async () => {
    const waiting = { id: "j1", title: "岗位候选人筛选", status: "waiting", stage: "等待校准筛选标准", progress: 30, completed: 0, total: 2, results: [], errors: [] };
    const queued = { id: "j1", title: "岗位候选人筛选", status: "queued", stage: "准备处理", progress: 1, total: 2, results: [], errors: [] };
    const criteria = {
      job_title: "后端工程师",
      essence: "交付高质量后端服务",
      core_outputs: ["产出A"],
      target_objects: [],
      required_scenarios: [],
      allowed_adjacent: [],
      rejected_adjacent: [],
      similar_wrong_profiles: [],
      evaluation_notes: [],
      bonus_signals: [],
      hard_requirements: [{ id: "r1", rule: "门槛1", verification: "核验1" }],
      a_conditions: [],
      b_conditions: [],
      c_conditions: [],
      negative_signals: [],
    };
    mockServer((url, init) => {
      const method = init?.method ?? "GET";
      if (url.pathname === "/api/bootstrap") return Promise.resolve(jsonResponse(readySettings()));
      if (url.pathname === "/api/jobs/j1" && method === "GET") return Promise.resolve(jsonResponse(waiting));
      if (url.pathname === "/api/jobs/j1/criteria-json" && method === "GET") {
        return Promise.resolve(jsonResponse({ criteria }));
      }
      if (url.pathname === "/api/jobs/j1/criteria-json" && method === "PUT") {
        return Promise.resolve(jsonResponse(waiting));
      }
      if (url.pathname === "/api/jobs/j1/start" && method === "POST") {
        return Promise.resolve(jsonResponse(queued));
      }
      if (url.pathname === "/api/jobs/j1" && method === "GET") return Promise.resolve(jsonResponse(queued));
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    localStorage.setItem("talentHub.lastJob", "j1");
    render(<App />);

    // 编辑器渲染：essence / 列表字段 / 规则字段
    const essenceInput = (await screen.findByDisplayValue("交付高质量后端服务")) as HTMLTextAreaElement;
    expect(essenceInput.id).toBe("criteriaEssenceInput");
    expect(screen.getByDisplayValue("产出A")).toBeInTheDocument();
    expect(screen.getByDisplayValue("门槛1")).toBeInTheDocument();
    expect(screen.getByDisplayValue("核验1")).toBeInTheDocument();
    expect(document.getElementById("criteriaReviewView")!.hidden).toBe(false);

    fireEvent.change(essenceInput, { target: { value: "交付高质量且可维护的后端服务" } });

    fireEvent.click(document.getElementById("confirmCriteriaButton") as HTMLButtonElement);

    // 保存并开始：PUT criteria-json（收集编辑后的标准）→ POST start → progress
    await waitFor(() => expect(document.getElementById("progressView")!.hidden).toBe(false));
    const putCall = fetchMock.mock.calls.find(
      ([u, i]) => String(u) === "/api/jobs/j1/criteria-json" && i?.method === "PUT"
    );
    expect(putCall).toBeDefined();
    const body = JSON.parse(String(putCall![1]?.body)) as {
      job_title: string;
      essence: string;
      core_outputs: string[];
      hard_requirements: Array<{ id: string; rule: string; verification: string }>;
    };
    expect(body.job_title).toBe("后端工程师");
    expect(body.essence).toBe("交付高质量且可维护的后端服务");
    expect(body.core_outputs).toEqual(["产出A"]);
    expect(body.hard_requirements).toEqual([{ id: "r1", rule: "门槛1", verification: "核验1" }]);
    expect(
      fetchMock.mock.calls.some(([u, i]) => String(u) === "/api/jobs/j1/start" && i?.method === "POST")
    ).toBe(true);
  });
});

describe("results 视图", () => {
  it("渲染汇总统计与 8 列表格，A/B/C 过滤与对比勾选", async () => {
    mockBootstrapWithJob(completedJob());
    render(<App />);

    await waitFor(() => expect(document.getElementById("resultsView")!.hidden).toBe(false));
    const rv = document.getElementById("resultsView")!;
    await waitFor(() => expect(document.getElementById("resultActions")!.hidden).toBe(false));

    // 汇总统计
    const stats = document.querySelectorAll("#resultSummary .summary-stat");
    expect(stats).toHaveLength(4);
    expect(stats[0].querySelector("strong")!.textContent).toBe("4");
    expect(stats[1].querySelector("strong")!.textContent).toBe("2");
    expect(stats[2].querySelector("strong")!.textContent).toBe("1");
    expect(stats[3].querySelector("strong")!.textContent).toBe("1");

    // 4 行结果
    expect(document.querySelectorAll("#resultsBody tr")).toHaveLength(4);
    expect(within(rv).getByText("张三")).toBeInTheDocument();

    // C 行对比框禁用并带提示
    const checkboxes = Array.from(document.querySelectorAll<HTMLInputElement>("#resultsBody input[type=checkbox]"));
    expect(checkboxes).toHaveLength(4);
    const cBox = checkboxes[3];
    expect(cBox.disabled).toBe(true);
    expect(cBox.title).toBe("C 类候选人不能参与对比");
    expect(checkboxes[0].disabled).toBe(false);

    // A/B/C 过滤
    fireEvent.click(screen.getByRole("button", { name: "电话确认" }));
    expect(within(rv).queryByText("张三")).not.toBeInTheDocument();
    expect(within(rv).getByText("王五")).toBeInTheDocument();
    expect(document.querySelectorAll("#resultsBody tr")).toHaveLength(1);
    expect(document.getElementById("resultCount")!.textContent).toContain("1 位候选人");
    expect(document.getElementById("resultCount")!.textContent).toContain("用时 2 分钟");

    // 全部过滤恢复
    fireEvent.click(screen.getByRole("button", { name: "全部" }));
    expect(document.querySelectorAll("#resultsBody tr")).toHaveLength(4);

    // 勾选 2 个 A/B 后对比按钮可用
    const compareButton = document.getElementById("compareButton") as HTMLButtonElement;
    expect(compareButton.disabled).toBe(true);
    fireEvent.click(document.querySelectorAll<HTMLInputElement>("#resultsBody input[type=checkbox]")[0]);
    fireEvent.click(document.querySelectorAll<HTMLInputElement>("#resultsBody input[type=checkbox]")[1]);
    expect(compareButton.disabled).toBe(false);
  });

  it("归档任务：追加 FAB 与结果动作按钮隐藏，禁止追加", async () => {
    mockBootstrapWithJob(completedJob({ archived_at: "2026-08-31T10:00:00+08:00" }));
    render(<App />);

    await waitFor(() => expect(document.getElementById("resultsView")!.hidden).toBe(false));
    expect(within(document.getElementById("resultsView")!).getByText("张三")).toBeInTheDocument();
    expect(document.getElementById("appendResumesButton")!.hidden).toBe(true);
    expect(document.getElementById("retrySavedJobButton")!.hidden).toBe(true);
    expect(document.getElementById("retryJobNotificationButton")!.hidden).toBe(true);
    expect(document.getElementById("editCriteriaButton")!.hidden).toBe(true);
  });

  it("简历列眼睛按钮打开已存简历预览（stored 模式）", async () => {
    mockServer((url, init) => {
      if (url.pathname === "/api/bootstrap") return Promise.resolve(jsonResponse(readySettings()));
      if (url.pathname === "/api/jobs/j1" && (init?.method ?? "GET") === "GET") {
        return Promise.resolve(jsonResponse(completedJob()));
      }
      if (url.pathname === "/api/jobs/j1/resumes/a.pdf/preview") {
        return Promise.resolve(jsonResponse({ page_count: 1, pages: [{ index: 1, data: "data:image/png;base64,AAA" }] }));
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    localStorage.setItem("talentHub.lastJob", "j1");
    render(<App />);

    await waitFor(() => expect(document.getElementById("resultsView")!.hidden).toBe(false));

    fireEvent.click(screen.getByRole("button", { name: "预览 张三" }));

    const dialog = await screen.findByRole("dialog", { name: "候选人简历" });
    expect(dialog.classList.contains("stored-preview-mode")).toBe(true);
    expect(await screen.findByRole("img", { name: "a.pdf - 1" })).toHaveAttribute("src", "data:image/png;base64,AAA");
    // 已存 PDF 走 GET /api/jobs/{id}/resumes/{filename}/preview，不缓存
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/jobs/j1/resumes/a.pdf/preview"))).toBe(true);
  });
});

describe("追加简历", () => {
  it("全部重复且无 pending 时回读任务并提示 noNewResumes；新文件则重新 start", async () => {
    const job = completedJob();
    mockServer((url, init) => {
      const method = init?.method ?? "GET";
      if (url.pathname === "/api/bootstrap") return Promise.resolve(jsonResponse(readySettings()));
      if (url.pathname === "/api/jobs/j1" && method === "GET") return Promise.resolve(jsonResponse(job));
      if (url.pathname.startsWith("/api/jobs/j1/resumes") && method === "PUT") {
        const filename = url.searchParams.get("filename");
        if (filename === "a.pdf") {
          return Promise.resolve(jsonResponse({ upload: { accepted: false, duplicate_of: "a.pdf" } }));
        }
        return Promise.resolve(jsonResponse({ upload: { accepted: true } }));
      }
      if (url.pathname === "/api/jobs/j1/start" && method === "POST") {
        return Promise.resolve(jsonResponse({ id: "j1", title: "后端工程师", status: "queued", stage: "准备处理", progress: 1, total: 5, results: job.results, errors: [] }));
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    localStorage.setItem("talentHub.lastJob", "j1");
    render(<App />);

    await waitFor(() => expect(document.getElementById("resultsView")!.hidden).toBe(false));
    expect(within(document.getElementById("resultsView")!).getByText("张三")).toBeInTheDocument();
    await waitFor(() => expect(document.getElementById("appendResumesButton")!.hidden).toBe(false));

    // 全部重复（duplicate_of 已在评估结果中）→ 无 pending → 提示 noNewResumes 并回到 results
    const dup = new File(["a"], "a.pdf", { lastModified: 333 });
    fireEvent.change(document.getElementById("appendResumeFiles") as HTMLInputElement, { target: { files: [dup] } });
    await screen.findByText("所选简历均已存在，无需重复筛选");
    expect(document.getElementById("resultsView")!.hidden).toBe(false);

    // 新文件被接受 → POST start → progress
    const fresh = new File(["c"], "new.pdf", { lastModified: 444 });
    fireEvent.change(document.getElementById("appendResumeFiles") as HTMLInputElement, { target: { files: [fresh] } });
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u, i]) => String(u) === "/api/jobs/j1/start" && i?.method === "POST")).toBe(true)
    );
    await waitFor(() => expect(document.getElementById("progressView")!.hidden).toBe(false));
  });
});

describe("历史任务变更", () => {
  it("归档与恢复当前任务后立即同步主区域操作状态", async () => {
    const job = completedJob();
    let archived = false;
    mockServer((url, init) => {
      const method = init?.method ?? "GET";
      if (url.pathname === "/api/bootstrap") return Promise.resolve(jsonResponse(readySettings()));
      if (url.pathname === "/api/jobs/j1" && method === "GET") {
        return Promise.resolve(jsonResponse({ ...job, archived_at: archived ? "2026-09-03T12:00:00+08:00" : null }));
      }
      if (url.pathname === "/api/jobs/j1/archive" && method === "POST") {
        archived = true;
        return Promise.resolve(jsonResponse({ id: "j1", archived_at: "2026-09-03T12:00:00+08:00" }));
      }
      if (url.pathname === "/api/jobs/j1/restore" && method === "POST") {
        archived = false;
        return Promise.resolve(jsonResponse({ id: "j1", archived_at: null }));
      }
      if (url.pathname === "/api/jobs" && method === "GET") {
        const wantsArchived = url.searchParams.get("scope") === "archived";
        const visible = wantsArchived === archived;
        return Promise.resolve(jsonResponse({ jobs: visible ? [{ ...job, archived_at: archived ? "2026-09-03T12:00:00+08:00" : null }] : [], total: visible ? 1 : 0 }));
      }
      if (url.pathname === "/api/storage") return Promise.resolve(jsonResponse({ job_count: 1, jobs_bytes: 0 }));
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    localStorage.setItem("talentHub.lastJob", "j1");
    render(<App />);

    await waitFor(() => expect(document.getElementById("appendResumesButton")!.hidden).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "打开最近任务" }));
    await screen.findByRole("button", { name: /后端工程师/ });
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "归档" }));

    await waitFor(() => expect(state.currentJob?.archived_at).toBe("2026-09-03T12:00:00+08:00"));
    expect(document.getElementById("appendResumesButton")!.hidden).toBe(true);
    expect(document.getElementById("editCriteriaButton")!.hidden).toBe(true);

    fireEvent.click(screen.getByRole("tab", { name: /已归档/ }));
    await screen.findByRole("button", { name: /后端工程师/ });
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "恢复到最近任务" }));

    await waitFor(() => expect(state.currentJob?.archived_at).toBeNull());
    expect(document.getElementById("appendResumesButton")!.hidden).toBe(false);
    expect(document.getElementById("editCriteriaButton")!.hidden).toBe(false);
  });

  it("删除当前简历任务后立即回到初始页并清除恢复状态", async () => {
    const job = completedJob();
    let deleted = false;
    mockServer((url, init) => {
      const method = init?.method ?? "GET";
      if (url.pathname === "/api/bootstrap") return Promise.resolve(jsonResponse(readySettings()));
      if (url.pathname === "/api/jobs/j1" && method === "GET") return Promise.resolve(jsonResponse(job));
      if (url.pathname === "/api/jobs/j1" && method === "DELETE") {
        deleted = true;
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      if (url.pathname === "/api/jobs" && method === "GET") {
        return Promise.resolve(jsonResponse({ jobs: deleted ? [] : [job], total: deleted ? 0 : 1 }));
      }
      if (url.pathname === "/api/storage") return Promise.resolve(jsonResponse({ job_count: deleted ? 0 : 1, jobs_bytes: 0 }));
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    localStorage.setItem("talentHub.lastJob", "j1");
    render(<App />);

    await waitFor(() => expect(document.getElementById("resultsView")!.hidden).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "打开最近任务" }));
    await screen.findByRole("button", { name: /后端工程师/ });
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "永久删除" }));
    fireEvent.click(screen.getByRole("button", { name: "永久删除" }));

    await waitFor(() => expect(state.currentJob).toBeNull());
    expect(localStorage.getItem("talentHub.lastJob")).toBeNull();
    expect(document.getElementById("setupView")!.hidden).toBe(false);
    expect(document.getElementById("resultsView")!.hidden).toBe(true);
  });
});

describe("下载评估表格", () => {
  it("下载按钮打开 PreviewDialog，下载走 Blob 并触发文件保存", async () => {
    const createObjectURL = vi.fn(() => "blob:mock-url");
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => { });

    mockServer((url, init) => {
      if (url.pathname === "/api/bootstrap") return Promise.resolve(jsonResponse(readySettings()));
      if (url.pathname === "/api/jobs/j1" && (init?.method ?? "GET") === "GET") {
        return Promise.resolve(jsonResponse(completedJob()));
      }
      if (url.pathname === "/api/jobs/j1/preview/workbook") {
        return Promise.resolve(jsonResponse({ kind: "workbook", sheets: [{ name: "Sheet1", rows: [["候选人"], ["张三"]] }] }));
      }
      if (url.pathname === "/api/jobs/j1/download") {
        return Promise.resolve(
          new Response("fake-excel-bytes", {
            status: 200,
            headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
          })
        );
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    localStorage.setItem("talentHub.lastJob", "j1");
    render(<App />);

    await waitFor(() => expect(document.getElementById("resultsView")!.hidden).toBe(false));
    fireEvent.click(document.getElementById("downloadResultButton") as HTMLButtonElement);

    expect(await screen.findByRole("dialog", { name: "评估表格预览" })).toBeInTheDocument();
    expect(screen.getByText("Sheet1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "下载 Excel" }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
    expect(clickSpy).toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([u]) => String(u) === "/api/jobs/j1/download")).toBe(true);
  });
});
