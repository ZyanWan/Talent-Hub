// 应用根组件：外壳、顶栏、启动流程与视图容器。
// App 是 settings/jobs/currentJob/currentCall 的协调写入方；section 的 hidden 由 src/router 直接管理 DOM，
// React 不参与其显隐 reconcile；历史记录变更由 HistoryMutation 统一提交。

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { api } from "./api/client";
import { onChange, setLanguage, t } from "./i18n";
import { show as routerShow, showSection } from "./router";
import { state } from "./state";
import { Button } from "./ui/Button";
import { HistoryDrawer, type HistoryMutation } from "./ui/HistoryDrawer";
import { SettingsDialog } from "./ui/SettingsDialog";
import { StatusDot } from "./ui/StatusDot";
import { Toast } from "./ui/Toast";
import { ScreeningView } from "./views/ScreeningView";
import { PhoneView } from "./views/PhoneView";

/** 视图名 → section id（与 src/router 的 SECTION_IDS 对应） */
const VIEW_SECTIONS: Record<string, string> = {
  setup: "setupView",
  progress: "progressView",
  criteriaReview: "criteriaReviewView",
  results: "resultsView",
  phone: "phoneView",
};

/** 视图名 → body[data-view] 写入值（criteriaReview 对应 review） */
const VIEW_DATA_VIEW: Record<string, string> = {
  setup: "setup",
  progress: "progress",
  criteriaReview: "review",
  results: "results",
  phone: "phone",
};

/** 任务状态 → 视图名（completed/有结果的 failed → results，waiting → criteriaReview，其余 → progress） */
function jobView(job: Record<string, unknown>): string {
  const status = String(job.status ?? "");
  const hasResults = Array.isArray(job.results) && job.results.length > 0;
  if (status === "completed" || (status === "failed" && hasResults)) return "results";
  if (status === "waiting") return "criteriaReview";
  return "progress";
}

/** 视图标题：默认岗位名回退到通用标题 */
function displayJobTitle(title: string): string {
  return !title || ["岗位候选人筛选", "Candidate Screening"].includes(title) ? t("jobTitle") : title;
}

export function App() {
  const [booting, setBooting] = useState(true);
  const [view, setView] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toolStripOpen, setToolStripOpen] = useState(false);
  const [exited, setExited] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [resetSignal, setResetSignal] = useState(0);
  // 工具切换到电话视图时递增，驱动 PhoneView 重置工作区
  const [phoneResetSignal, setPhoneResetSignal] = useState(0);
  // 历史抽屉打开电话任务的请求；seq 递增保证重复打开同一条目也触发加载
  const [callOpenRequest, setCallOpenRequest] = useState<{ id: string; seq: number } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jobOpenSeqRef = useRef(0);
  const [, forceRender] = useState(0);

  /** 电话任务状态变化通知：历史抽屉每次打开都会重新拉取列表，此处无需额外动作 */
  const onCallHistoryChanged = useCallback(() => { }, []);

  /** 切换视图：router.show（screening 的四个 section 归一到 "screening" 视图，phone 独立）+
   *  显示目标 section + 同步 body[data-view] 与本地镜像 */
  const navigate = useCallback((name: string) => {
    routerShow(name === "phone" ? "phone" : "screening");
    const sectionId = VIEW_SECTIONS[name];
    if (sectionId) showSection(sectionId);
    document.body.dataset.view = VIEW_DATA_VIEW[name] ?? name;
    setView(name);
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const resetScreeningWorkspace = useCallback(() => {
    jobOpenSeqRef.current += 1;
    localStorage.removeItem("talentHub.lastJob");
    state.currentJob = null;
    setResetSignal((n) => n + 1);
  }, []);

  const resetPhoneWorkspace = useCallback(() => {
    localStorage.removeItem("talentHub.lastCall");
    state.currentCall = null;
    setCallOpenRequest(null);
    setPhoneResetSignal((n) => n + 1);
  }, []);

  /** 打开筛选任务：拉取任务并按状态路由 */
  const openJob = useCallback(
    async (jobId: string) => {
      const requestSeq = ++jobOpenSeqRef.current;
      localStorage.setItem("talentHub.activeTool", "screening");
      localStorage.removeItem("talentHub.lastCall");
      try {
        const job = await api<Record<string, unknown>>(`/api/jobs/${jobId}`);
        if (requestSeq !== jobOpenSeqRef.current) return;
        state.currentJob = job;
        localStorage.setItem("talentHub.lastJob", jobId);
        navigate(jobView(job));
        forceRender((n) => n + 1);
      } catch (error) {
        if (requestSeq !== jobOpenSeqRef.current) return;
        showToast((error as Error).message);
        resetScreeningWorkspace();
        navigate("setup");
      }
    },
    [navigate, resetScreeningWorkspace, showToast]
  );

  const handleHistoryMutation = useCallback(
    (mutation: HistoryMutation) => {
      if (mutation.action === "delete") {
        if (mutation.kind === "job" && String(state.currentJob?.id ?? "") === mutation.itemId) {
          resetScreeningWorkspace();
          navigate("setup");
        } else if (mutation.kind === "call" && String(state.currentCall?.id ?? "") === mutation.itemId) {
          resetPhoneWorkspace();
        }
        return;
      }

      if (mutation.kind === "job" && String(state.currentJob?.id ?? "") === mutation.item.id) {
        state.currentJob = { ...state.currentJob, ...mutation.item };
        forceRender((n) => n + 1);
      } else if (mutation.kind === "call" && String(state.currentCall?.id ?? "") === mutation.item.id) {
        state.currentCall = { ...state.currentCall, ...mutation.item };
        forceRender((n) => n + 1);
      }
    },
    [navigate, resetPhoneWorkspace, resetScreeningWorkspace]
  );

  // 首帧隐藏全部视图区与全局动作容器：hidden 由 src/router 直接管理，React 不参与其 reconcile
  useLayoutEffect(() => {
    document.body.dataset.view = "setup";
    for (const id of [...Object.values(VIEW_SECTIONS), "resultActions", "appendResumesButton", "appendCallAudioButton"]) {
      const el = document.getElementById(id);
      if (el) el.hidden = true;
    }
  }, []);

  // 语言：挂载时同步 document.title 与 html lang，切换后经 i18n 广播重渲染
  useEffect(() => {
    let active = true;
    const apply = () => {
      document.documentElement.lang = state.language;
      document.title = t("documentTitle");
    };
    apply();
    onChange(() => {
      if (!active) return;
      apply();
      forceRender((n) => n + 1);
    });
    return () => {
      active = false;
    };
  }, []);

  // 工具条：点击外部或 ESC 关闭（document 级监听）
  useEffect(() => {
    if (!toolStripOpen) return;
    const onDocumentClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("#toolStrip") || target.closest("#newJobButton")) return;
      setToolStripOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setToolStripOpen(false);
    };
    document.addEventListener("click", onDocumentClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("click", onDocumentClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [toolStripOpen]);

  // 启动流程
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await api<{ settings: Record<string, unknown>; jobs?: unknown[] }>("/api/bootstrap");
        if (!active) return;
        state.settings = data.settings;
        state.jobs = data.jobs || [];
        state.historyTotals.recent = state.jobs.length;
        const activeTool = localStorage.getItem("talentHub.activeTool");
        if (activeTool === "phone") {
          navigate("phone");
        } else {
          const lastJobId = localStorage.getItem("talentHub.lastJob");
          if (lastJobId) {
            await openJob(lastJobId);
          } else {
            localStorage.setItem("talentHub.activeTool", "screening");
            navigate("setup");
          }
        }
        if (!state.settings?.is_ready) setSettingsOpen(true);
      } catch (error) {
        if (!active) return;
        showToast((error as Error).message);
        navigate("setup");
      } finally {
        if (active) setBooting(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [navigate, openJob, showToast]);

  const handleLanguage = (language: "zh-CN" | "en") => {
    if (language === state.language) return;
    // 语言切换：支持 View Transition 时整页交叉淡化，过渡回调内用 flushSync 同步提交，
    // 否则新快照会读到切换前文案；prefers-reduced-motion 或无该 API 时立即切换
    const reducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (typeof document.startViewTransition === "function" && !reducedMotion) {
      document.startViewTransition(() => flushSync(() => setLanguage(language)));
    } else {
      setLanguage(language);
    }
  };

  const toggleToolStrip = () => {
    setToolStripOpen((open) => !open);
  };

  /** 工具切换（phone → 重置并打开电话视图，screening → 重置筛选工作区） */
  const switchTool = (tool: "screening" | "phone") => {
    setToolStripOpen(false);
    localStorage.setItem("talentHub.activeTool", tool);
    if (tool === "phone") {
      jobOpenSeqRef.current += 1;
      resetPhoneWorkspace();
      navigate("phone");
    } else {
      localStorage.removeItem("talentHub.lastCall");
      resetScreeningWorkspace();
      navigate("setup");
    }
  };

  const handleExit = async () => {
    if (!window.confirm(t("exitConfirm"))) return;
    try {
      await api("/api/shutdown", { method: "POST" });
      setExited(true);
    } catch (error) {
      showToast((error as Error).message);
    }
  };

  const settingsReady = Boolean(state.settings?.is_ready);
  const configStatusText =
    state.settings === null
      ? t("configLoading")
      : settingsReady
        ? t("modelConnected", { model: String(state.settings.model ?? "") })
        : t("modelPending");
  const activeTool = localStorage.getItem("talentHub.activeTool") === "phone" ? "phone" : "screening";
  const viewTitle =
    view !== null && view !== "phone" && view !== "setup" && state.currentJob
      ? displayJobTitle(String(state.currentJob.title ?? ""))
      : t("jobTitle");

  if (exited) {
    return (
      <main className="shutdown-message">
        <h1>{t("exitedTitle")}</h1>
        <p>{t("closePage")}</p>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspaceContent">
        {t("skipLink")}
      </a>
      <header className="topbar">
        <div className={toolStripOpen ? "brand-group strip-open" : "brand-group"}>
          <Button
            variant="icon"
            id="openHistoryButton"
            title={t("openHistory")}
            aria-label={t("openHistory")}
            onClick={() => setHistoryOpen(true)}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M4 7h16M4 12h16M4 17h10" />
            </svg>
          </Button>
          <Button
            variant="icon"
            id="newJobButton"
            className={toolStripOpen ? "is-open" : undefined}
            title={t("newTool")}
            aria-label={t("newTool")}
            onClick={toggleToolStrip}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </Button>
          <div id="toolStrip" className="tool-strip" hidden={!toolStripOpen}>
            <button
              type="button"
              data-tool="screening"
              className={activeTool === "screening" ? "active" : ""}
              title={t("toolScreening")}
              aria-label={t("toolScreening")}
              onClick={() => switchTool("screening")}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M8 3v3M16 3v3M4 6h16v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
                <path d="M9 11h6M9 15h5" />
              </svg>
            </button>
            <button
              type="button"
              data-tool="phone"
              className={activeTool === "phone" ? "active" : ""}
              title={t("toolPhone")}
              aria-label={t("toolPhone")}
              onClick={() => switchTool("phone")}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92Z" />
              </svg>
            </button>
          </div>
          <div className="brand-wordmark">
            <span className="brand-title">{t("appName")}</span>
          </div>
        </div>
        <div className="view-context">
          <h1 id="viewTitle" hidden={view === "phone"}>
            {viewTitle}
          </h1>
        </div>
        <div className="global-actions">
          <div className="topbar-actions" id="resultActions">
            <button className="secondary-button" id="downloadCriteriaButton" type="button">
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
                <path d="M14 2v6h6M8 13h8M8 17h6" />
              </svg>
              <span>{t("criteria")}</span>
            </button>
            <button className="primary-button" id="downloadResultButton" type="button">
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M3 9h18M8 9v11M15 9v11" />
              </svg>
              <span>{t("workbook")}</span>
            </button>
          </div>
          <div id="languageSwitch" className="language-switch" role="group" aria-label={t("languageLabel")} data-active={state.language}>
            <button
              type="button"
              data-language="zh-CN"
              className={state.language === "zh-CN" ? "active" : ""}
              aria-pressed={state.language === "zh-CN"}
              onClick={() => handleLanguage("zh-CN")}
            >
              中文
            </button>
            <button
              type="button"
              data-language="en"
              className={state.language === "en" ? "active" : ""}
              aria-pressed={state.language === "en"}
              onClick={() => handleLanguage("en")}
            >
              EN
            </button>
          </div>
          <div className="connection-state" title={t("connectionState")}>
            <StatusDot id="configDot" status={settingsReady ? "ready" : "error"} />
            <span id="configStatus">{configStatusText}</span>
          </div>
          <Button
            variant="icon"
            id="openSettingsButton"
            title={t("modelSettings")}
            aria-label={t("modelSettings")}
            onClick={() => setSettingsOpen(true)}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1A1.7 1.7 0 0 0 4.6 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.5 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.15.38.36.72.65 1 .3.3.69.42 1.1.4H21v4h-.1A1.7 1.7 0 0 0 19.4 15Z" />
            </svg>
          </Button>
          <Button
            variant="icon"
            id="exitAppButton"
            title={t("exitApp")}
            aria-label={t("exitApp")}
            onClick={() => void handleExit()}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
            </svg>
          </Button>
        </div>
      </header>

      <main className="workspace">
        <div className="workspace-content" id="workspaceContent">
          <div id="startupLoading" className="startup-loading" role="status" aria-live="polite" hidden={!booting}>
            <span className="startup-spinner" aria-hidden="true" />
            <span>{t("startupLoading")}</span>
          </div>
          <ScreeningView
            view={view}
            onNavigate={navigate}
            onToast={showToast}
            onRequireSettings={() => setSettingsOpen(true)}
            resetSignal={resetSignal}
          />
          <PhoneView
            view={view}
            callOpenRequest={callOpenRequest}
            onToast={showToast}
            onRequireSettings={() => setSettingsOpen(true)}
            onHistoryChanged={onCallHistoryChanged}
            resetSignal={phoneResetSignal}
          />
        </div>
      </main>

      <button className="append-resumes-fab" id="appendResumesButton" type="button" title={t("appendResumes")} aria-label={t("appendResumes")}>
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM19 8v6M16 11h6" />
        </svg>
        <span>{t("appendResumes")}</span>
      </button>
      <button className="append-resumes-fab" id="appendCallAudioButton" type="button" title={t("appendCallAudio")} aria-label={t("appendCallAudio")}>
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span>{t("appendCallAudio")}</span>
      </button>

      <HistoryDrawer
        open={historyOpen}
        initialKind={view === "phone" ? "call" : "job"}
        onClose={() => setHistoryOpen(false)}
        onOpenJob={(jobId) => {
          void openJob(jobId);
        }}
        onOpenCall={(callId) => {
          // 记录到 lastCall 并通知电话视图加载
          localStorage.setItem("talentHub.activeTool", "phone");
          localStorage.setItem("talentHub.lastCall", callId);
          setCallOpenRequest((prev) => ({ id: callId, seq: (prev?.seq ?? 0) + 1 }));
          navigate("phone");
        }}
        onMutation={handleHistoryMutation}
      />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      {toast && <Toast>{toast}</Toast>}
    </div>
  );
}
