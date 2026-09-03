// =====================================================================
// 简历筛选任务流视图（React）。
// - setup：JD textarea + 简历拖拽/选择（name:size:lastModified 去重）+ 已选列表移除 + 开始筛选
// - 任务创建：POST /api/jobs {title} → PUT /api/jobs/{id}/jd → 逐份 PUT /api/jobs/{id}/resumes
//   （upload.accepted=false + duplicate_of 判重）→ POST /api/jobs/{id}/start → 轮询
// - progress：1200ms 轮询 GET /api/jobs/{id}，回调校验当前视图（router currentView === "screening"）
//   与任务 id 未变（防跨任务串扰），网络错误不停止轮询；阶段/进度/实时结果/取消/重试/错误列表
// - criteriaReview：标准校准表单（essence + 列表字段 + 规则字段），保存并开始/重新筛选
// - results：汇总统计、A/B/C 过滤、8 列表格、编辑标准/重试/飞书通知重试/下载（PreviewDialog）
// - 轮询定时器存全局 state.pollTimer，视图切换经 src/router（"screening" 视图 exit 清轮询）
// - 追加简历（appendResumes）：仅 completed 且未归档任务可追加，全部重复且无 pending 时提示 noNewResumes
// =====================================================================

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { api } from "../api/client";
import { onChange, t } from "../i18n";
import { registerView, currentView } from "../router";
import { state } from "../state";
import { Button } from "../ui/Button";
import { CompareDialog, type CompareCandidate } from "../ui/CompareDialog";
import { EmptyState } from "../ui/EmptyState";
import { PreviewDialog, type PreviewKind } from "../ui/PreviewDialog";
import { Progress } from "../ui/Progress";
import { Tag, type ConclusionGrade } from "../ui/Tag";
import { ResumeWorkspace, type StoredResumePreview } from "./ResumeWorkspace";

// ---------------------------------------------------------------------
// 类型与常量
// ---------------------------------------------------------------------

export interface ScreeningViewProps {
  /** 当前 section 名：setup / progress / criteriaReview / results */
  view: string | null;
  /** 视图切换（外层负责 router.show + showSection + body[data-view]） */
  onNavigate: (name: string) => void;
  onToast: (message: string) => void;
  /** 模型未配置时打开设置弹窗 */
  onRequireSettings: () => void;
  /** 外层切换工具时递增，触发工作区重置 */
  resetSignal?: number;
}

interface ResultRow {
  source_file?: string;
  candidate_name?: string;
  conclusion?: string;
  one_line?: string;
  blockers?: string[] | string;
  next_action?: string[] | string;
}

interface ReviewRuleRow {
  id?: string;
  rule: string;
  verification: string;
}

interface CriteriaEditorState {
  essence: string;
  lists: Record<string, string[]>;
  rules: Record<string, ReviewRuleRow[]>;
}

/** 简历上传响应：任务字段 + upload 判重信息（与后端 PUT /api/jobs/{id}/resumes 契约一致） */
type UploadResponse = Record<string, unknown> & {
  upload?: { accepted: boolean; duplicate_of?: string };
};

type ReviewMode = "calibrate" | "re-edit";

const REVIEW_LIST_FIELDS: Array<[string, string]> = [
  ["core_outputs", "核心产出"],
  ["target_objects", "核心对象"],
  ["required_scenarios", "必需业务场景"],
  ["allowed_adjacent", "允许迁移的相邻场景"],
  ["rejected_adjacent", "不可自动放宽的相邻场景"],
  ["similar_wrong_profiles", "相似但错误的候选人类型"],
  ["evaluation_notes", "评估备注"],
  ["bonus_signals", "加分信号（仅排序，不降级）"],
];
const REVIEW_RULE_FIELDS: Array<[string, string]> = [
  ["hard_requirements", "硬性门槛"],
  ["a_conditions", "A类规则（优先约面）"],
  ["b_conditions", "B类规则（电话确认）"],
  ["c_conditions", "C类规则（不推进）"],
  ["negative_signals", "负向否决信号"],
];
const RESUME_ACCEPT = ".pdf,.docx,.txt,.md,.markdown,.png,.jpg,.jpeg,.webp,.tif,.tiff,.bmp";

/** 任务状态 → 视图名（completed/有结果的 failed → results，waiting → criteriaReview，其余 → progress） */
function jobView(job: Record<string, unknown> | null): string {
  if (!job) return "progress";
  const status = String(job.status ?? "");
  const hasResults = Array.isArray(job.results) && job.results.length > 0;
  if (status === "completed" || (status === "failed" && hasResults)) return "results";
  if (status === "waiting") return "criteriaReview";
  return "progress";
}

// ---------------------------------------------------------------------
// 格式化辅助
// ---------------------------------------------------------------------

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(seconds: unknown): string {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (total < 60) return state.language === "en" ? `${total}s` : `${total} 秒`;
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  if (state.language === "en") return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
  return remainder ? `${minutes} 分 ${remainder} 秒` : `${minutes} 分钟`;
}

function jobElapsed(job: Record<string, unknown>): number {
  const status = String(job.status ?? "");
  if (!["queued", "running"].includes(status) || !job.evaluation_started_at) {
    return Number(job.elapsed_seconds) || 0;
  }
  const live = (Date.now() - new Date(String(job.evaluation_started_at)).getTime()) / 1000;
  return Math.max(Number(job.elapsed_seconds) || 0, live);
}

function stageLabel(stage: string): string {
  if (state.language === "zh-CN") {
    const exactZh: Record<string, string> = {
      "JD 已就绪": "岗位说明已就绪",
      "解析岗位 JD": "解析岗位说明",
      "生成并校验 Excel": "生成并校验表格",
      "上传岗位 JD": "上传岗位说明",
    };
    return exactZh[stage] || stage || t("preparingTask");
  }
  const exact: Record<string, string> = {
    "等待上传": "Waiting for files",
    "JD 已就绪": "Job brief ready",
    "等待开始": "Waiting to start",
    "上次运行被中断": "Previous run interrupted",
    "正在停止任务": "Stopping task",
    "解析岗位 JD": "Parsing job brief",
    "生成岗位筛选标准": "Building screening criteria",
    "评估候选人": "Evaluating candidates",
    "生成并校验 Excel": "Building and validating workbook",
    "筛选完成": "Screening complete",
    "已取消": "Cancelled",
    "任务失败": "Task failed",
    "上传岗位 JD": "Uploading job brief",
    "等待校准筛选标准": "Awaiting criteria review",
    "筛选标准已校准": "Criteria calibrated",
    "准备处理": "Preparing",
    "处理完成": "Processing complete",
    "已完成": "Done",
  };
  if (exact[stage]) return exact[stage];
  const uploaded = String(stage || "").match(/^已上传 (\d+) 份简历$/);
  if (uploaded) return `${uploaded[1]} resumes uploaded`;
  const evaluating = String(stage || "").match(/^评估候选人 (\d+)\/(\d+)$/);
  if (evaluating) return `Evaluating candidates ${evaluating[1]}/${evaluating[2]}`;
  const processing = String(stage || "").match(/^处理中 (\d+)\/(\d+)$/);
  if (processing) return `Processing ${processing[1]}/${processing[2]}`;
  return t("stageFallback");
}

function conclusionClass(conclusion: string): ConclusionGrade {
  return conclusion.startsWith("A") ? "a" : conclusion.startsWith("B") ? "b" : "c";
}

function conclusionLabel(conclusion: string): string {
  if (conclusion.startsWith("A")) return t("conclusionA");
  if (conclusion.startsWith("B")) return t("conclusionB");
  return t("conclusionC");
}

function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

/** 单元格文本：数组按语言分隔符连接，空值显示 missingValue */
function cellText(value: string[] | string | undefined): string {
  const separator = state.language === "en" ? "; " : "；";
  if (Array.isArray(value)) return value.join(separator) || t("missingValue");
  return value || t("missingValue");
}

// ---------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------

export function ScreeningView({ view, onNavigate, onToast, onRequireSettings, resetSignal = 0 }: ScreeningViewProps) {
  const [, forceRender] = useState(0);
  const rerender = useCallback(() => forceRender((n) => n + 1), []);

  // setup 表单
  const [jdText, setJdText] = useState("");
  const [dragging, setDragging] = useState(false);
  const [starting, setStarting] = useState(false);
  // 上传阶段进度（任务创建/追加简历期间的瞬态显示）
  const [upload, setUpload] = useState<{ stage: string; percent: number } | null>(null);
  // 标准校准编辑器
  const [criteriaEditor, setCriteriaEditor] = useState<CriteriaEditorState | null>(null);
  const [reviewMode, setReviewMode] = useState<ReviewMode>("calibrate");
  const pendingReviewMode = useRef<ReviewMode | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [notifying, setNotifying] = useState(false);
  // 下载/预览弹窗
  const [previewKind, setPreviewKind] = useState<PreviewKind | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  // 简历工作台：null 关闭；{ stored: null } 本地模式（setup 入口）；{ stored } 已存预览（results 眼睛按钮）
  const [resumeWorkspace, setResumeWorkspace] = useState<{ stored: StoredResumePreview | null } | null>(null);

  const job = state.currentJob;
  const jobStatus = String(job?.status ?? "");

  // 轮询：定时器存全局 state.pollTimer；"screening" 视图 exit 负责清理（经 src/router 保证互斥）
  const schedulePollRef = useRef<() => void>(() => { });
  const schedulePoll = useCallback(() => {
    clearTimeout(state.pollTimer ?? undefined);
    const id = job?.id ? String(job.id) : null;
    if (!id) return;
    state.pollTimer = setTimeout(async () => {
      // 排期后任务已切换则丢弃本轮（防跨任务串扰）
      if (!state.currentJob || state.currentJob.id !== id) return;
      try {
        const fetched = await api<Record<string, unknown>>(`/api/jobs/${id}`);
        // 已切到电话视图等非筛选视图时丢弃本轮结果
        if (currentView() !== "screening") return;
        if (!state.currentJob || state.currentJob.id !== id) return;
        state.currentJob = fetched;
        const index = state.jobs.findIndex((item) => (item as Record<string, unknown>).id === id);
        if (index >= 0) state.jobs[index] = fetched;
        rerender();
        const status = String(fetched.status ?? "");
        if (status === "completed") {
          onNavigate("results");
          onToast(t("completedToast"));
        } else if (["failed", "cancelled"].includes(status)) {
          if (status === "failed" && Array.isArray(fetched.results) && fetched.results.length) onNavigate("results");
          else onNavigate("progress");
          onToast(t(status === "cancelled" ? "cancelledToast" : "failedToast"));
        } else if (status === "waiting") {
          onNavigate("criteriaReview");
        } else {
          onNavigate("progress");
          schedulePollRef.current();
        }
      } catch (error) {
        // 网络错误不停止轮询；已切走时丢弃本轮错误与重试
        if (!state.currentJob || state.currentJob.id !== id) return;
        onToast((error as Error).message);
        schedulePollRef.current();
      }
    }, 1200);
  }, [job, onNavigate, onToast, rerender]);

  useEffect(() => {
    schedulePollRef.current = schedulePoll;
  }, [schedulePoll]);

  // 挂载：注册 "screening" 视图生命周期（exit 清轮询）；卸载时兜底清理
  useEffect(() => {
    registerView("screening", {
      exit: () => {
        clearTimeout(state.pollTimer ?? undefined);
        state.pollTimer = null;
      },
    });
    return () => {
      clearTimeout(state.pollTimer ?? undefined);
      state.pollTimer = null;
    };
  }, []);

  // 语言切换时重渲染视图文案
  useEffect(() => {
    let active = true;
    onChange(() => {
      if (active) rerender();
    });
    return () => {
      active = false;
    };
  }, [rerender]);

  // 切换工具重置工作区
  useEffect(() => {
    if (!resetSignal) return;
    clearTimeout(state.pollTimer ?? undefined);
    state.pollTimer = null;
    state.currentJob = null;
    state.selectedResumes = [];
    state.resultFilter = "all";
    state.liveResultKeys = null;
    state.compareSelection = new Set();
    setJdText("");
    setUpload(null);
    setCriteriaEditor(null);
  }, [resetSignal]);

  // 打开 queued/running 任务后自动开始轮询（覆盖外层 openJob 路径）
  useEffect(() => {
    if (state.currentJob && ["queued", "running"].includes(String(state.currentJob.status ?? ""))) {
      schedulePollRef.current();
    }
  }, [state.currentJob]);

  // results 视图：同步 resultActions / 追加 FAB 显隐。
  // 不依赖 deps：显隐同时受 view（App 状态）与 state.currentJob（全局对象）影响，
  // 每次渲染后按当前值同步，避免任何一方变化未触发重跑。
  useEffect(() => {
    const resultActions = document.getElementById("resultActions");
    const appendFab = document.getElementById("appendResumesButton");
    const completed = state.currentJob?.status === "completed";
    const archived = Boolean(state.currentJob?.archived_at);
    if (resultActions) resultActions.hidden = !(view === "results" && completed);
    if (appendFab) appendFab.hidden = !(view === "results" && completed && !archived);
  });

  // criteriaReview：进入时拉取标准并渲染编辑器（失败回退到任务状态视图）
  useEffect(() => {
    if (view !== "criteriaReview" || !state.currentJob) return;
    let active = true;
    const jobId = String(state.currentJob.id);
    (async () => {
      try {
        const payload = await api<{ criteria: Record<string, unknown> }>(`/api/jobs/${jobId}/criteria-json`);
        if (!active) return;
        const criteria = payload.criteria;
        const lists: Record<string, string[]> = {};
        const rules: Record<string, ReviewRuleRow[]> = {};
        for (const [name] of REVIEW_LIST_FIELDS) {
          lists[name] = Array.isArray(criteria[name]) ? (criteria[name] as string[]) : [];
        }
        for (const [name] of REVIEW_RULE_FIELDS) {
          rules[name] = Array.isArray(criteria[name])
            ? (criteria[name] as Array<{ id?: string; rule?: string; verification?: string }>).map((item) => ({
              id: item.id,
              rule: item.rule || "",
              verification: item.verification || "",
            }))
            : [];
        }
        setCriteriaEditor({ essence: String(criteria.essence || ""), lists, rules });
        setReviewMode(pendingReviewMode.current || "calibrate");
        pendingReviewMode.current = null;
      } catch (error) {
        if (!active) return;
        onToast((error as Error).message);
        onNavigate(jobView(state.currentJob));
      }
    })();
    return () => {
      active = false;
    };
  }, [view, state.currentJob, onNavigate, onToast]);

  // 挂载：下载按钮（resultActions 由 App 渲染）与追加 FAB/隐藏输入的事件接线
  useEffect(() => {
    const downloadResult = document.getElementById("downloadResultButton");
    const downloadCriteria = document.getElementById("downloadCriteriaButton");
    const appendFab = document.getElementById("appendResumesButton");
    const appendInput = document.getElementById("appendResumeFiles") as HTMLInputElement | null;
    const onDownloadResult = () => setPreviewKind("workbook");
    const onDownloadCriteria = () => setPreviewKind("criteria");
    const onAppendClick = () => appendInput?.click();
    const onAppendChange = (event: Event) => {
      const input = event.target as HTMLInputElement;
      if (!input.files) return;
      appendResumes(input.files);
      input.value = "";
    };
    downloadResult?.addEventListener("click", onDownloadResult);
    downloadCriteria?.addEventListener("click", onDownloadCriteria);
    appendFab?.addEventListener("click", onAppendClick);
    appendInput?.addEventListener("change", onAppendChange);
    return () => {
      downloadResult?.removeEventListener("click", onDownloadResult);
      downloadCriteria?.removeEventListener("click", onDownloadCriteria);
      appendFab?.removeEventListener("click", onAppendClick);
      appendInput?.removeEventListener("change", onAppendChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- setup：文件选择去重（name:size:lastModified）与移除 ----

  const addFiles = (fileList: FileList | File[]) => {
    const known = new Set(state.selectedResumes.map(fileKey));
    const additions: File[] = [];
    for (const file of Array.from(fileList)) {
      const key = fileKey(file);
      if (!known.has(key)) {
        additions.push(file);
        known.add(key);
      }
    }
    if (additions.length) {
      state.selectedResumes = [...state.selectedResumes, ...additions];
      rerender();
    }
  };

  const handleResumeInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) addFiles(event.target.files);
    event.target.value = "";
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files) addFiles(event.dataTransfer.files);
  };

  const uploadFile = async (jobId: string, endpoint: string, file: File) => {
    return api<UploadResponse>(`/api/jobs/${jobId}/${endpoint}?filename=${encodeURIComponent(file.name)}`, {
      method: "PUT",
      body: file,
    });
  };

  // ---- 任务流动作 ----

  const startScreening = async () => {
    if (!state.settings?.is_ready) {
      onRequireSettings();
      return;
    }
    if (!jdText.trim()) return;
    if (!state.selectedResumes.length) return;
    setStarting(true);
    try {
      const created = await api<Record<string, unknown>>("/api/jobs", {
        method: "POST",
        body: JSON.stringify({ title: "岗位候选人筛选" }),
      });
      state.currentJob = created;
      state.jobs.unshift(created);
      const total = state.selectedResumes.length;
      setUpload({ stage: t("savingJobBrief"), percent: 1 });
      onNavigate("progress");
      await api(`/api/jobs/${String(created.id)}/jd`, { method: "PUT", body: JSON.stringify({ text: jdText }) });
      let duplicateCount = 0;
      for (let index = 0; index < total; index += 1) {
        setUpload({
          stage: t("uploadingResume", { current: index + 1, total }),
          percent: Math.max(1, Math.round(((index + 1) / total) * 8)),
        });
        const uploadResult = await uploadFile(String(created.id), "resumes", state.selectedResumes[index]);
        if (uploadResult.upload?.accepted === false) duplicateCount += 1;
      }
      state.currentJob = await api(`/api/jobs/${String(created.id)}/start`, { method: "POST" });
      setUpload(null);
      if (duplicateCount) onToast(t("duplicateResumesSkipped", { count: duplicateCount }));
      schedulePollRef.current();
    } catch (error) {
      onToast((error as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const appendResumes = async (fileList: FileList) => {
    const current = state.currentJob;
    if (!current || current.status !== "completed" || current.archived_at) return;
    if (!state.settings?.is_ready) {
      onRequireSettings();
      return;
    }
    const files = Array.from(fileList);
    if (!files.length) return;
    const jobId = String(current.id);
    const evaluatedFiles = new Set(
      ((current.results as ResultRow[] | undefined) || []).map((item) => item.source_file || "")
    );
    setUpload({ stage: t("uploading"), percent: 1 });
    onNavigate("progress");
    try {
      let acceptedCount = 0;
      let duplicateCount = 0;
      let pendingDuplicateCount = 0;
      for (let index = 0; index < files.length; index += 1) {
        setUpload({
          stage: t("uploadingResume", { current: index + 1, total: files.length }),
          percent: Math.max(1, Math.round(((index + 1) / files.length) * 8)),
        });
        const uploadResult = await uploadFile(jobId, "resumes", files[index]);
        if (uploadResult.upload?.accepted === false) {
          duplicateCount += 1;
          if (!evaluatedFiles.has(String(uploadResult.upload.duplicate_of ?? ""))) pendingDuplicateCount += 1;
        } else {
          acceptedCount += 1;
        }
      }
      if (!acceptedCount && !pendingDuplicateCount) {
        state.currentJob = await api(`/api/jobs/${jobId}`);
        setUpload(null);
        onNavigate(jobView(state.currentJob));
        onToast(t("noNewResumes"));
        return;
      }
      state.currentJob = await api(`/api/jobs/${jobId}/start`, { method: "POST" });
      setUpload(null);
      if (duplicateCount) onToast(t("duplicateResumesSkipped", { count: duplicateCount }));
      schedulePollRef.current();
    } catch (error) {
      onToast((error as Error).message);
      try {
        state.currentJob = await api(`/api/jobs/${jobId}`);
        setUpload(null);
        onNavigate(jobView(state.currentJob));
      } catch {
        // 保留当前错误提示；轮询或重新打开历史任务时会恢复服务端状态
      }
    }
  };

  const cancelCurrentJob = async () => {
    if (!state.currentJob || cancelling) return;
    setCancelling(true);
    try {
      state.currentJob = await api(`/api/jobs/${String(state.currentJob.id)}/cancel`, { method: "POST" });
      setUpload(null);
      onNavigate("progress");
      schedulePollRef.current();
    } catch (error) {
      onToast((error as Error).message);
    } finally {
      setCancelling(false);
    }
  };

  const retryCurrentJob = async () => {
    if (!state.currentJob) return;
    state.compareSelection = new Set();
    try {
      state.currentJob = await api(`/api/jobs/${String(state.currentJob.id)}/start`, { method: "POST" });
      setUpload(null);
      onNavigate("progress");
      schedulePollRef.current();
    } catch (error) {
      onToast((error as Error).message);
    }
  };

  const retryJobNotification = async () => {
    if (!state.currentJob) return;
    setNotifying(true);
    try {
      const result = await api<{ job?: Record<string, unknown>; errors?: string[]; sent?: boolean }>(
        `/api/jobs/${String(state.currentJob.id)}/retry-notification`,
        { method: "POST" }
      );
      state.currentJob = result.job || state.currentJob;
      rerender();
      if (result.errors?.length) onToast(result.errors.join("\n"));
      else onToast(t(result.sent ? "feishuNotificationSent" : "feishuNotificationNotSent"));
    } catch (error) {
      onToast((error as Error).message);
    } finally {
      setNotifying(false);
    }
  };

  const collectCriteria = (): Record<string, unknown> => {
    if (!criteriaEditor) return {};
    const result: Record<string, unknown> = { essence: criteriaEditor.essence.trim() };
    for (const [name] of REVIEW_LIST_FIELDS) {
      result[name] = (criteriaEditor.lists[name] || []).map((value) => value.trim()).filter(Boolean);
    }
    for (const [name] of REVIEW_RULE_FIELDS) {
      result[name] = (criteriaEditor.rules[name] || [])
        .map((item) => {
          const row: Record<string, string> = {};
          if (item.id) row.id = item.id;
          row.rule = item.rule.trim();
          row.verification = item.verification.trim();
          return row;
        })
        .filter((item) => item.rule);
    }
    return result;
  };

  const confirmCriteriaAndStart = async () => {
    if (!state.currentJob || confirming) return;
    setConfirming(true);
    try {
      await api(`/api/jobs/${String(state.currentJob.id)}/criteria-json`, {
        method: "PUT",
        body: JSON.stringify(collectCriteria()),
      });
      state.currentJob = await api(`/api/jobs/${String(state.currentJob.id)}/start`, { method: "POST" });
      setUpload(null);
      onNavigate("progress");
      schedulePollRef.current();
    } catch (error) {
      onToast((error as Error).message);
    } finally {
      setConfirming(false);
    }
  };

  const handleEditCriteria = () => {
    if (!state.currentJob || state.currentJob.archived_at) return;
    pendingReviewMode.current = "re-edit";
    onNavigate("criteriaReview");
  };

  const handleFilter = (filter: string) => {
    state.resultFilter = filter;
    rerender();
  };

  const toggleCompare = (item: ResultRow) => {
    const file = item.source_file || "";
    if (!file) return;
    if (state.compareSelection.has(file)) state.compareSelection.delete(file);
    else state.compareSelection.add(file);
    rerender();
  };

  // ---- 派生渲染数据 ----

  const selectedCount = state.selectedResumes.length;
  const totalSize = state.selectedResumes.reduce((sum, file) => sum + file.size, 0);
  const hasJd = Boolean(jdText.trim());
  const setupReady = hasJd && selectedCount > 0;
  const setupMeta = selectedCount
    ? t(state.language === "en" && selectedCount === 1 ? "resumeSelectedMetaOne" : "resumeSelectedMeta", {
      count: selectedCount,
      size: formatSize(totalSize),
    })
    : t("resumeEmptyMeta");

  const queuedRunning = ["queued", "running"].includes(jobStatus);
  const stageText = upload ? upload.stage : stageLabel(String(job?.stage ?? ""));
  const percent = upload ? upload.percent : Number(job?.progress) || 0;
  const progressDone = Number(job?.completed) || 0;
  const progressTotal = Number(job?.total) || 0;
  const elapsed = job ? jobElapsed(job) : 0;
  const perMinute = elapsed > 0 ? ((Number(job?.completed) || 0) / elapsed) * 60 : 0;
  const progressPerformance = perMinute > 0
    ? t("speed", { time: formatDuration(elapsed), rate: perMinute.toFixed(1) })
    : t("elapsed", { time: formatDuration(elapsed) });
  const liveRows = ((job?.results as ResultRow[] | undefined) || []).slice(-8).reverse();
  const progressErrors = (job?.errors as string[] | undefined) || [];

  const completed = jobStatus === "completed";
  const archived = Boolean(job?.archived_at);
  const allResults = (job?.results as ResultRow[] | undefined) || [];
  const counts = {
    all: allResults.length,
    a: allResults.filter((item) => item.conclusion === "A优先约面").length,
    b: allResults.filter((item) => item.conclusion === "B电话确认").length,
    c: allResults.filter((item) => item.conclusion === "C不推进").length,
  };
  const filter = state.resultFilter;
  const filtered = filter === "all" ? allResults : allResults.filter((item) => item.conclusion === filter);
  const resultErrors = (job?.errors as string[] | undefined) || [];
  const resultMeta = [
    t("candidateCount", { count: filtered.length }),
    t("durationMeta", { time: formatDuration(job?.elapsed_seconds) }),
  ].join(" · ");
  const compareCandidates: CompareCandidate[] = allResults
    .filter((item) => item.source_file && state.compareSelection.has(item.source_file))
    .map((item) => ({
      source_file: item.source_file as string,
      candidate_name: item.candidate_name,
      conclusion: item.conclusion,
    }));
  const compareEnabled = completed && state.compareSelection.size >= 2;

  // ---- setup 视图 ----

  const setupView = (
    <section id="setupView" className="setup-view">
      <div className="setup-heading">
        <h2>{t("setupTitle")}</h2>
      </div>
      <div className="screening-composer">
        <textarea
          id="jdText"
          rows={7}
          aria-label={t("jobBriefText")}
          placeholder={t("jobBriefPlaceholder")}
          value={jdText}
          onChange={(event) => setJdText(event.target.value)}
        />
        <div className="composer-footer">
          <div
            className={dragging ? "resume-material dragging" : selectedCount ? "resume-material has-files" : "resume-material"}
            id="resumeDropZone"
            onDragEnter={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              event.preventDefault();
              setDragging(false);
            }}
            onDrop={handleDrop}
          >
            <button
              className="resume-material-summary"
              id="openResumeWorkspaceButton"
              type="button"
              disabled={selectedCount === 0}
              onClick={() => setResumeWorkspace({ stored: null })}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM19 8v6M16 11h6" />
              </svg>
              <span className="resume-material-copy">
                <strong>{t("resumeMaterials")}</strong>
                <span id="resumeMaterialMeta">{setupMeta}</span>
              </span>
              <span className="resume-material-action" id="resumeMaterialAction" hidden={selectedCount === 0}>
                {t("manageFiles")}
              </span>
            </button>
            <label className="resume-add-button" htmlFor="resumeFiles" title={t("addResumes")} aria-label={t("addResumes")}>
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </label>
            <input
              id="resumeFiles"
              className="visually-hidden"
              type="file"
              multiple
              accept={RESUME_ACCEPT}
              onChange={handleResumeInputChange}
            />
          </div>
          <Button variant="send" id="startButton" disabled={!setupReady} busy={starting} onClick={() => void startScreening()}>
            <span>{starting ? t("uploading") : t("startScreening")}</span>
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M5 12h14M14 7l5 5-5 5" />
            </svg>
          </Button>
        </div>
        <p className="visually-hidden" id="runHint" aria-live="polite">
          {setupReady ? t("readyToScreen", { count: selectedCount }) : t("waitingMaterials")}
        </p>
      </div>
    </section>
  );

  // ---- progress 视图 ----

  const progressView = (
    <section
      className={queuedRunning ? "progress-view" : "progress-view is-idle"}
      id="progressView"
      aria-live="polite"
    >
      <div className="progress-focus">
        <span className="working-indicator" aria-hidden="true" />
        <h2 id="progressStage">{stageText}</h2>
        <strong id="progressPercent" className="bump" key={percent}>
          {percent}%
        </strong>
      </div>
      <Progress value={percent} />
      <div className="progress-meta">
        <span id="progressCount">{t("resumeProgress", { done: progressDone, total: progressTotal })}</span>
        <span id="progressPerformance">{progressPerformance}</span>
      </div>
      <div className="progress-actions">
        <Button variant="secondary" id="cancelJobButton" hidden={!queuedRunning} disabled={cancelling} onClick={() => void cancelCurrentJob()}>
          {cancelling ? stageLabel("正在停止任务") : t("cancelTask")}
        </Button>
        <Button
          variant="primary"
          id="retryJobButton"
          hidden={archived || !["failed", "cancelled"].includes(jobStatus)}
          onClick={() => void retryCurrentJob()}
        >
          {t("retryTask")}
        </Button>
      </div>
      <div className="live-section">
        <div className="subsection-heading">
          <h3>{t("liveResults")}</h3>
        </div>
        <div className="live-results" id="liveResults" data-empty-label={t("emptyLive")}>
          {liveRows.map((item, index) => (
            <div className="live-row" key={`${item.candidate_name}|${item.source_file}|${index}`} style={{ animationDelay: `${Math.min(index * 45, 315)}ms` }}>
              <strong>{item.candidate_name || ""}</strong>
              <Tag grade={conclusionClass(item.conclusion || "")}>{conclusionLabel(item.conclusion || "")}</Tag>
              <span>{item.one_line || ""}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="error-list" id="progressErrors" hidden={!progressErrors.length}>
        {progressErrors.join("\n")}
      </div>
    </section>
  );

  // ---- criteriaReview 视图 ----

  const criteriaReviewView = (
    <section id="criteriaReviewView" className="review-view">
      <div className="review-heading">
        <h2>{t("reviewTitle")}</h2>
        <p className="review-lead">{t("reviewLead")}</p>
      </div>
      <div className="review-editor" id="criteriaEditor" aria-live="polite">
        {criteriaEditor ? (
          <>
            <section className="review-section">
              <h3>岗位本质</h3>
              <div className="review-body">
                <textarea
                  id="criteriaEssenceInput"
                  className="review-textarea"
                  value={criteriaEditor.essence}
                  onChange={(event) =>
                    setCriteriaEditor({ ...criteriaEditor, essence: event.target.value })
                  }
                />
              </div>
            </section>
            {REVIEW_LIST_FIELDS.map(([name, title]) => (
              <section className="review-section" key={name}>
                <h3>{title}</h3>
                <div className="review-body">
                  <div className="review-list">
                    {(criteriaEditor.lists[name] || []).map((value, index) => (
                      <div className="review-row" key={index}>
                        <input
                          type="text"
                          value={value}
                          onChange={(event) => {
                            const next = [...(criteriaEditor.lists[name] || [])];
                            next[index] = event.target.value;
                            setCriteriaEditor({
                              ...criteriaEditor,
                              lists: { ...criteriaEditor.lists, [name]: next },
                            });
                          }}
                        />
                        <button
                          type="button"
                          className="review-icon-button"
                          title={t("removingRule")}
                          onClick={() => {
                            const next = (criteriaEditor.lists[name] || []).filter((_, i) => i !== index);
                            setCriteriaEditor({ ...criteriaEditor, lists: { ...criteriaEditor.lists, [name]: next } });
                          }}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="review-add-button"
                      onClick={() => {
                        const next = [...(criteriaEditor.lists[name] || []), ""];
                        setCriteriaEditor({ ...criteriaEditor, lists: { ...criteriaEditor.lists, [name]: next } });
                      }}
                    >
                      {`+ ${t("addingRule")}`}
                    </button>
                  </div>
                </div>
              </section>
            ))}
            {REVIEW_RULE_FIELDS.map(([name, title]) => (
              <section className="review-section" key={name}>
                <h3>{title}</h3>
                <div className="review-body">
                  <div className="review-list">
                    {(criteriaEditor.rules[name] || []).map((item, index) => (
                      <div className="review-row" key={item.id || index}>
                        <input
                          type="text"
                          className="rule-input"
                          value={item.rule}
                          onChange={(event) => {
                            const next = [...(criteriaEditor.rules[name] || [])];
                            next[index] = { ...next[index], rule: event.target.value };
                            setCriteriaEditor({ ...criteriaEditor, rules: { ...criteriaEditor.rules, [name]: next } });
                          }}
                        />
                        <input
                          type="text"
                          className="verify-input"
                          placeholder="核验方式"
                          value={item.verification}
                          onChange={(event) => {
                            const next = [...(criteriaEditor.rules[name] || [])];
                            next[index] = { ...next[index], verification: event.target.value };
                            setCriteriaEditor({ ...criteriaEditor, rules: { ...criteriaEditor.rules, [name]: next } });
                          }}
                        />
                        <button
                          type="button"
                          className="review-icon-button"
                          title={t("removingRule")}
                          onClick={() => {
                            const next = (criteriaEditor.rules[name] || []).filter((_, i) => i !== index);
                            setCriteriaEditor({ ...criteriaEditor, rules: { ...criteriaEditor.rules, [name]: next } });
                          }}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="review-add-button"
                      onClick={() => {
                        const next = [...(criteriaEditor.rules[name] || []), { rule: "", verification: "" }];
                        setCriteriaEditor({ ...criteriaEditor, rules: { ...criteriaEditor.rules, [name]: next } });
                      }}
                    >
                      {`+ ${t("addingRule")}`}
                    </button>
                  </div>
                </div>
              </section>
            ))}
          </>
        ) : (
          <p className="preview-status">{t("previewLoading")}</p>
        )}
      </div>
      <div className="review-actions">
        <Button
          variant="secondary"
          className="review-back-button"
          id="cancelCriteriaButton"
          onClick={() => onNavigate(jobView(state.currentJob))}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M19 12H5" />
            <path d="m12 19-7-7 7-7" />
          </svg>
          <span>{t("back")}</span>
        </Button>
        <Button
          variant="primary"
          className="review-confirm-button"
          id="confirmCriteriaButton"
          busy={confirming}
          onClick={() => void confirmCriteriaAndStart()}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
            <path d="M17 21v-8H7v8" />
            <path d="M7 3v5h8" />
          </svg>
          <span>{t(reviewMode === "re-edit" ? "confirmAndRestart" : "confirmAndStart")}</span>
        </Button>
      </div>
    </section>
  );

  // ---- results 视图 ----

  const resultsView = (
    <section id="resultsView" className="results-view">
      <div className="result-summary" id="resultSummary">
        {[
          [t("summaryCandidates"), counts.all],
          [t("summaryA"), counts.a],
          [t("summaryB"), counts.b],
          [t("summaryC"), counts.c],
        ].map(([label, value]) => (
          <div className="summary-stat" key={String(label)}>
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <div className="table-toolbar">
        <div className="segmented-control" id="resultFilter" role="group" aria-label={t("resultFilter")}>
          {[
            ["all", t("filterAll")],
            ["A优先约面", t("filterA")],
            ["B电话确认", t("filterB")],
            ["C不推进", t("filterC")],
          ].map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={filter === value ? "active" : ""}
              data-filter={value}
              onClick={() => handleFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <span id="resultCount">{resultMeta}</span>
        <Button
          variant="primary"
          id="retrySavedJobButton"
          hidden={completed || archived}
          onClick={() => void retryCurrentJob()}
        >
          {t("retryTask")}
        </Button>
        <Button
          variant="secondary"
          id="retryJobNotificationButton"
          hidden={!completed || archived}
          busy={notifying}
          onClick={() => void retryJobNotification()}
        >
          {t("retryFeishuNotification")}
        </Button>
        <Button variant="secondary" id="editCriteriaButton" hidden={!completed || archived} onClick={handleEditCriteria}>
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
          <span>{t("editCriteria")}</span>
        </Button>
        <Button
          variant="secondary"
          id="compareButton"
          hidden={!completed}
          disabled={!compareEnabled}
          title={compareEnabled ? undefined : t("compareButtonTitle")}
          onClick={() => setCompareOpen(true)}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M8 3v3M16 3v3M4 6h16v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
            <path d="M8 11h8M8 15h5" />
          </svg>
          <span>{t("compareButton")}</span>
        </Button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("compareSelect")}</th>
              <th>{t("order")}</th>
              <th>{t("candidate")}</th>
              <th className="resume-preview-header">{t("resumePreviewColumn")}</th>
              <th>{t("conclusion")}</th>
              <th>{t("decision")}</th>
              <th>{t("keyRisks")}</th>
              <th>{t("nextStep")}</th>
            </tr>
          </thead>
          <tbody id="resultsBody">
            {filtered.length === 0 ? (
              <EmptyState variant="table" colSpan={8}>
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3" />
                </svg>
                <span>{t("noFilteredResults")}</span>
              </EmptyState>
            ) : (
              filtered.map((item, index) => (
                <tr key={item.source_file || `${item.candidate_name}|${index}`} style={{ animationDelay: `${Math.min(index * 40, 560)}ms` }}>
                  <td className="compare-cell">
                    <input
                      type="checkbox"
                      disabled={!completed || item.conclusion === "C不推进"}
                      title={item.conclusion === "C不推进" ? t("compareExcludeC") : undefined}
                      checked={Boolean(item.source_file && state.compareSelection.has(item.source_file))}
                      onChange={() => toggleCompare(item)}
                    />
                  </td>
                  <td>{index + 1}</td>
                  <td>{item.candidate_name || t("missingValue")}</td>
                  <td className="resume-preview-cell">
                    {item.source_file ? (
                      <button
                        type="button"
                        className="candidate-preview-button"
                        title={t("previewNamed", { name: item.source_file })}
                        aria-label={t("previewNamed", { name: item.candidate_name || item.source_file })}
                        onClick={() =>
                          setResumeWorkspace({
                            stored: {
                              jobId: String(job?.id ?? ""),
                              filename: item.source_file as string,
                              candidateName: item.candidate_name || item.source_file,
                            },
                          })
                        }
                      >
                        <svg aria-hidden="true" viewBox="0 0 24 24">
                          <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
                          <path d="M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z" />
                        </svg>
                      </button>
                    ) : (
                      ""
                    )}
                  </td>
                  <td className="badge-cell">
                    <Tag grade={conclusionClass(item.conclusion || "")}>{conclusionLabel(item.conclusion || "")}</Tag>
                  </td>
                  <td>{cellText(item.one_line)}</td>
                  <td>{cellText(item.blockers)}</td>
                  <td>{cellText(item.next_action)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="error-list" id="resultErrors" hidden={!resultErrors.length}>
        {resultErrors.join("\n")}
      </div>
    </section>
  );

  return (
    <>
      {setupView}
      {progressView}
      {criteriaReviewView}
      {resultsView}
      <input id="appendResumeFiles" type="file" multiple accept={RESUME_ACCEPT} hidden />
      <PreviewDialog
        open={previewKind !== null}
        jobId={job ? String(job.id) : ""}
        kind={previewKind ?? "criteria"}
        onClose={() => setPreviewKind(null)}
      />
      <CompareDialog
        open={compareOpen}
        jobId={job ? String(job.id) : ""}
        candidates={compareCandidates}
        onClose={() => setCompareOpen(false)}
      />
      <ResumeWorkspace
        open={resumeWorkspace !== null}
        stored={resumeWorkspace?.stored}
        onClose={() => setResumeWorkspace(null)}
        onFilesChanged={rerender}
      />
    </>
  );
}
