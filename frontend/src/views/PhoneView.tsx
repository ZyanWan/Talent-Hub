// =====================================================================
// 电话确认任务流视图（React）。
// - 新建表单：标题 / 岗位名 / 关联岗位下拉（GET /api/jobs?scope=recent&limit=100，
//   createCustomSelect 复用）+ 岗位联动导入（criteria-json 的 bonus_signals 关键词
//   匹配预设维度，零额外模型调用）+ 软性维度勾选 + 录音选择（拖拽/点击，音频类型）
// - 任务创建：POST /api/calls {title, job_title, job_id, soft_skill_focus,
//   soft_skill_dimensions}
// - 历史任务加载：递增请求序号保证仅最后一次选择可写入 currentCall；最新请求
//   失败时清空恢复键并重置工作区，视图退出与外层 reset 同时使在途请求失效
// - 录音上传：PUT /api/calls/{id}/audio?filename=（File 直传），upload.accepted=false +
//   duplicate_of 判重；重复计数经 duplicateAudioSkipped toast；全部重复 →
//   noNewAudio 提示，不触发整理
// - 追加录音：仅 call done 且未归档时显示（shell 渲染的 FAB），追加后自动 process
// - 处理流程：POST /api/calls/{id}/process（failed/cancelled 重试同端点）
// - 轮询：2500ms GET /api/calls/{id}，回调校验当前视图（currentView() === "phone"）
//   与 call id 未变（防跨任务串扰），网络错误不停止轮询；定时器存
//   state.callPollTimer，"phone" 视图 exit 清轮询（src/router 保证互斥）
// - 条目卡片列表：音频名 / 候选人名 / 状态徽章 / 进度 / 错误；done 卡片头部为
//   可点击按钮（详情浮层与音频播放由详情实现承载，此处仅渲染卡片结构）
// - 取消：POST /api/calls/{id}/cancel（done 条目保留、中间态回滚由服务端收敛）
// - 状态机：draft（新建表单）/ queued / running / done / failed / cancelled
// =====================================================================

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { api } from "../api/client";
import { onChange, t } from "../i18n";
import { currentView, registerView } from "../router";
import { state } from "../state";
import { Button } from "../ui/Button";
import { Progress } from "../ui/Progress";
import { createCustomSelect, type CustomSelectHandle } from "../ui/customSelect";
import { CallItemDetail, callItemStatusLabel, releaseAudioBlobs, stageLabel, type CallTask } from "./CallItemDetail";

// ---------------------------------------------------------------------
// 类型与常量
// ---------------------------------------------------------------------

export interface PhoneViewProps {
  /** 当前 section 名（"phone" 时视图激活） */
  view: string | null;
  /** 历史抽屉打开电话任务的请求（seq 递增保证重复打开同一条目也触发加载） */
  callOpenRequest?: { id: string; seq: number } | null;
  onToast: (message: string) => void;
  /** ASR 未配置时打开设置弹窗 */
  onRequireSettings: () => void;
  /** 电话任务状态变化后通知外层（历史列表每次打开时重新拉取） */
  onHistoryChanged: () => void;
  /** 外层切换工具到电话视图时递增，触发工作区重置 */
  resetSignal?: number;
}

/** 录音上传响应：任务字段 + upload 判重信息（与后端 PUT /api/calls/{id}/audio 契约一致） */
type UploadResponse = Record<string, unknown> & {
  upload?: { accepted: boolean; duplicate_of?: string };
};

const CALL_AUDIO_SUFFIXES = new Set([".m4a", ".wav", ".mp3", ".ogg", ".opus"]);
const CALL_AUDIO_MAX_BYTES = 100 * 1024 * 1024;
const CALL_AUDIO_ACCEPT = ".m4a,.wav,.mp3,.ogg,.opus";

// 预设软性素质维度：key 与后端 SOFT_SKILL_DIMENSIONS 对齐，label 走 i18n。
const SOFT_SKILL_DIMENSIONS: Array<{ key: string; labelKey: string }> = [
  { key: "passion", labelKey: "softDimPassion" },
  { key: "self_drive", labelKey: "softDimSelfDrive" },
  { key: "resilience", labelKey: "softDimResilience" },
  { key: "logic", labelKey: "softDimLogic" },
  { key: "learning", labelKey: "softDimLearning" },
  { key: "openness", labelKey: "softDimOpenness" },
  { key: "pragmatism", labelKey: "softDimPragmatism" },
  { key: "collaboration", labelKey: "softDimCollaboration" },
];

// 岗位加分信号 → 预设维度关键词映射（联动导入用，零额外模型调用）。
const SOFT_SKILL_KEYWORD_MAP: Array<{ key: string; keywords: string[] }> = [
  { key: "self_drive", keywords: ["自驱", "主动", "自我驱动", "内驱"] },
  { key: "resilience", keywords: ["韧性", "抗压", "抗挫", "情绪稳定", "坚持", "不放弃"] },
  { key: "logic", keywords: ["逻辑", "条理", "结构化", "思考清晰"] },
  { key: "learning", keywords: ["学习", "成长", "上手快", "新知识"] },
  { key: "openness", keywords: ["开放", "拥抱变化", "接受意见", "试错", "迭代"] },
  { key: "pragmatism", keywords: ["务实", "落地", "执行", "结果导向"] },
  { key: "collaboration", keywords: ["协作", "沟通", "跨部门", "团队", "配合"] },
  { key: "passion", keywords: ["热爱", "兴趣", "激情", "喜欢"] },
];

// ---------------------------------------------------------------------
// 格式化辅助
// ---------------------------------------------------------------------

function formatDate(value: string | undefined): string {
  if (!value) return "";
  const locale = state.language === "en" ? "en-US" : "zh-CN";
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function defaultCallTitle(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return t("callDefaultTitle", { date });
}

function callStatusBadgeClass(status: string): string {
  const map: Record<string, string> = {
    draft: "is-waiting",
    queued: "is-waiting",
    running: "is-running",
    transcribing: "is-running",
    summarizing: "is-running",
    done: "is-done",
    failed: "is-failed",
    cancelled: "is-muted",
  };
  return map[status] || "";
}

function fileSuffix(name: string): string {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index).toLowerCase() : "";
}

/** 停止电话轮询（视图 exit 与切换当前任务时使用） */
function stopCallPolling(): void {
  clearTimeout(state.callPollTimer ?? undefined);
  state.callPollTimer = null;
}

// ---------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------

export function PhoneView({
  view,
  callOpenRequest = null,
  onToast,
  onRequireSettings,
  onHistoryChanged,
  resetSignal = 0,
}: PhoneViewProps) {
  const [, forceRender] = useState(0);
  const rerender = useCallback(() => forceRender((n) => n + 1), []);

  // 新建表单
  const [title, setTitle] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [softSkillFocus, setSoftSkillFocus] = useState("");
  const [jobId, setJobId] = useState("");
  const [selectedDims, setSelectedDims] = useState<Set<string>>(new Set());
  const [jobOptions, setJobOptions] = useState<Array<{ id: string; title: string }>>([]);
  const [dragging, setDragging] = useState(false);
  const [starting, setStarting] = useState(false);
  const [appending, setAppending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [retrying, setRetrying] = useState(false);
  // 详情浮层当前打开的条目 id（null 表示关闭；条目随任务切换/轮询更新）
  const [detailItemId, setDetailItemId] = useState<string | null>(null);

  const customSelectRef = useRef<CustomSelectHandle | null>(null);
  const callSelectSeqRef = useRef(0);
  // 岗位联动导入的请求序号：快速切换岗位时只允许最后一次请求落地，防止乱序覆盖。
  const importFocusSeqRef = useRef(0);

  const resetWorkspace = useCallback(() => {
    callSelectSeqRef.current += 1;
    stopCallPolling();
    releaseAudioBlobs();
    setDetailItemId(null);
    state.currentCall = null;
    state.pendingCallFiles = [];
    setTitle("");
    setJobTitle("");
    setSoftSkillFocus("");
    setJobId("");
    setSelectedDims(new Set());
    rerender();
  }, [rerender]);

  const call = state.currentCall as CallTask | null;
  const callStatus = String(call?.status ?? "");
  const showCreate = !call || callStatus === "draft";

  // 轮询：定时器存全局 state.callPollTimer；"phone" 视图 exit 负责清理（经 src/router 保证互斥）
  const schedulePollRef = useRef<() => void>(() => { });
  const schedulePoll = useCallback(() => {
    clearTimeout(state.callPollTimer ?? undefined);
    const id = call?.id ? String(call.id) : null;
    if (!id) return;
    state.callPollTimer = setTimeout(async () => {
      // 排期后任务已切换则丢弃本轮（防跨任务串扰）
      if (!state.currentCall || String(state.currentCall.id) !== id) return;
      try {
        const fetched = await api<CallTask>(`/api/calls/${id}`);
        // 已切到其他视图时丢弃本轮结果，避免电话确认轮询在后台继续运行
        if (currentView() !== "phone") return;
        if (!state.currentCall || String(state.currentCall.id) !== id) return;
        state.currentCall = fetched;
        onHistoryChanged();
        rerender();
        if (["queued", "running"].includes(String(fetched.status ?? ""))) schedulePollRef.current();
      } catch (error) {
        // 网络错误不停止轮询；已切走时丢弃本轮错误与重试
        if (!state.currentCall || String(state.currentCall.id) !== id) return;
        onToast((error as Error).message);
        if (currentView() !== "phone") return;
        schedulePollRef.current();
      }
    }, 2500);
  }, [call, onToast, onHistoryChanged, rerender]);

  useEffect(() => {
    schedulePollRef.current = schedulePoll;
  }, [schedulePoll]);

  // 打开 queued/running 任务后自动开始轮询（覆盖历史恢复 / bootstrap / process / 追加 / 重试路径）
  useEffect(() => {
    if (state.currentCall && ["queued", "running"].includes(String(state.currentCall.status ?? ""))) {
      schedulePollRef.current();
    }
  }, [state.currentCall]);

  // 挂载：注册 "phone" 视图生命周期（exit 清轮询）；卸载时兜底清理
  useEffect(() => {
    registerView("phone", {
      exit: () => {
        callSelectSeqRef.current += 1;
        clearTimeout(state.callPollTimer ?? undefined);
        state.callPollTimer = null;
      },
    });
    return () => {
      callSelectSeqRef.current += 1;
      clearTimeout(state.callPollTimer ?? undefined);
      state.callPollTimer = null;
    };
  }, []);

  // 语言切换重渲染
  useEffect(() => {
    let active = true;
    onChange(() => {
      if (active) rerender();
    });
    return () => {
      active = false;
    };
  }, [rerender]);

  // 进入电话视图：按历史请求恢复任务（lastCall / callOpenRequest），无 lastCall 时保持新建表单
  useEffect(() => {
    if (view !== "phone") return;
    const callId = callOpenRequest ? callOpenRequest.id : localStorage.getItem("talentHub.lastCall");
    if (callId) void selectCall(callId);
  }, [view, callOpenRequest]);

  // 工具切换到电话视图：重置工作区。
  // 关联岗位选项保留：岗位仅能在筛选视图创建，离开电话视图再返回时由下方加载效果重新拉取。
  useEffect(() => {
    if (!resetSignal) return;
    resetWorkspace();
  }, [resetSignal, resetWorkspace]);

  // 详情浮层条目随轮询/任务切换消失时关闭浮层
  useEffect(() => {
    const currentItems = call?.items || [];
    if (detailItemId && !currentItems.some((entry) => String(entry.id) === String(detailItemId))) {
      setDetailItemId(null);
    }
  }, [call, detailItemId]);

  /** 详情保存完成：回读后的 call 数据同步到界面并通知外层刷新历史列表 */
  const handleItemSaved = useCallback(() => {
    rerender();
    onHistoryChanged();
  }, [rerender, onHistoryChanged]);

  // 新建表单展示时加载关联岗位列表
  useEffect(() => {
    if (view !== "phone" || !showCreate) return;
    const draftJobId = state.currentCall?.status === "draft" ? String(state.currentCall.job_id ?? "") : "";
    void loadJobOptions(draftJobId || undefined);
  }, [view, showCreate]);

  // 草稿任务回填新建表单（软性维度与关联岗位；title/jobTitle 在创建后已清空，不回填）
  useEffect(() => {
    if (view !== "phone" || !call || callStatus !== "draft") return;
    setSoftSkillFocus(String(call.soft_skill_focus ?? ""));
    setSelectedDims(new Set(call.soft_skill_dimensions || []));
    setJobId(String(call.job_id ?? ""));
  }, [view, call, callStatus]);

  // 关联岗位下拉：挂载一次 createCustomSelect（菜单渲染自 select.options）
  useEffect(() => {
    const wrap = document.getElementById("callJobLinkSelectWrap");
    const select = document.getElementById("callJobLinkSelect") as HTMLSelectElement | null;
    if (!wrap || !select) return;
    const handle = createCustomSelect({ wrap, select });
    customSelectRef.current = handle;
    handle.sync();
    return () => {
      handle.close();
    };
  }, []);

  // 选项或值变化后重建下拉菜单（动态选项加载完成、草稿回填后调用）
  useEffect(() => {
    customSelectRef.current?.sync();
  }, [jobOptions, jobId]);

  // 追加录音 FAB（shell 渲染）显隐：仅 call done 且未归档时显示。
  // FAB 为 shell 渲染的非受控元素，每次渲染后同步 DOM hidden，不参与 React reconcile。
  useEffect(() => {
    const fab = document.getElementById("appendCallAudioButton");
    if (fab) fab.hidden = !(view === "phone" && callStatus === "done" && !call?.archived_at);
  });

  // 追加录音：FAB 点击触发隐藏文件输入，change 后执行追加流程
  useEffect(() => {
    const fab = document.getElementById("appendCallAudioButton");
    const input = document.getElementById("appendCallAudioFiles") as HTMLInputElement | null;
    const onFabClick = () => input?.click();
    const onInputChange = (event: Event) => {
      const target = event.target as HTMLInputElement;
      if (!target.files) return;
      appendCallAudioRef.current(target.files);
      target.value = "";
    };
    fab?.addEventListener("click", onFabClick);
    input?.addEventListener("change", onInputChange);
    return () => {
      fab?.removeEventListener("click", onFabClick);
      input?.removeEventListener("change", onInputChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- 关联岗位：加载选项与联动导入 ----

  const loadJobOptions = useCallback(async (keepJobId?: string) => {
    try {
      const data = await api<{ jobs?: Array<{ id: string; title?: string }> }>("/api/jobs?scope=recent&limit=100");
      const options = (data.jobs || []).map((job) => ({ id: String(job.id), title: job.title || String(job.id) }));
      setJobOptions(options);
      // 编辑 draft 时已关联的岗位可能不在最近 100 条内：补拉该岗位，保证下拉显示与任务数据一致
      if (keepJobId && !options.some((option) => option.id === keepJobId)) {
        try {
          const job = await api<{ id: string; title?: string }>(`/api/jobs/${keepJobId}`);
          setJobOptions((prev) => [...prev, { id: String(job.id), title: job.title || String(job.id) }]);
        } catch {
          // 岗位不存在或已删除，保持空选中
        }
      }
    } catch {
      // 岗位列表加载失败不阻塞创建流程
    }
  }, []);

  const importJobFocus = async (nextJobId: string) => {
    const seq = ++importFocusSeqRef.current;
    const matched = new Set<string>();
    let focusText = "";
    if (nextJobId) {
      try {
        const response = await api<{ criteria?: { bonus_signals?: string[] } }>(`/api/jobs/${nextJobId}/criteria-json`);
        const bonusSignals = Array.isArray(response.criteria?.bonus_signals) ? (response.criteria?.bonus_signals ?? []) : [];
        focusText = bonusSignals.length ? `来自岗位加分信号：${bonusSignals.join("；")}` : "";
        const joined = bonusSignals.join("，");
        for (const dim of SOFT_SKILL_KEYWORD_MAP) {
          if (dim.keywords.some((keyword) => joined.includes(keyword))) matched.add(dim.key);
        }
      } catch (error) {
        if (seq !== importFocusSeqRef.current) return; // 已切换到其他岗位，丢弃过期请求的提示
        onToast(
          typeof (error as Error)?.message === "string" && (error as Error).message.includes("筛选标准尚未生成")
            ? t("callJobCriteriaMissing")
            : t("callJobImportFail")
        );
        return;
      }
    }
    if (seq !== importFocusSeqRef.current) return;
    // 完全替换语义：勾选与文本只反映当前岗位；切回"不关联岗位"同样清空。
    setSelectedDims(matched);
    setSoftSkillFocus(focusText);
  };

  const handleJobSelectChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value;
    setJobId(next);
    void importJobFocus(next);
  };

  // ---- 录音选择（拖拽/点击，去重键 name:size:lastModified） ----

  const collectCallAudioFiles = (fileList: FileList | File[]) => {
    const files: File[] = [];
    let skipped = 0;
    for (const file of Array.from(fileList)) {
      if (!CALL_AUDIO_SUFFIXES.has(fileSuffix(file.name)) || file.size > CALL_AUDIO_MAX_BYTES) {
        skipped += 1;
        continue;
      }
      files.push(file);
    }
    if (skipped) onToast(t("callInvalidAudio", { count: skipped }));
    return files;
  };

  const addPendingCallAudio = (fileList: FileList | File[]) => {
    const files = collectCallAudioFiles(fileList);
    if (!files.length) return;
    const known = new Set(state.pendingCallFiles.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
    const additions: File[] = [];
    for (const file of files) {
      const key = `${file.name}:${file.size}:${file.lastModified}`;
      if (!known.has(key)) {
        additions.push(file);
        known.add(key);
      }
    }
    if (additions.length) {
      state.pendingCallFiles = [...state.pendingCallFiles, ...additions];
      rerender();
    }
  };

  const handleAudioInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) addPendingCallAudio(event.target.files);
    event.target.value = "";
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files) addPendingCallAudio(event.dataTransfer.files);
  };

  const removePendingAudio = (index: number) => {
    state.pendingCallFiles = state.pendingCallFiles.filter((_, i) => i !== index);
    rerender();
  };

  // ---- 任务流动作 ----

  const selectCall = async (callId: string) => {
    const requestSeq = ++callSelectSeqRef.current;
    stopCallPolling();
    releaseAudioBlobs();
    setDetailItemId(null);
    try {
      const fetched = await api<CallTask>(`/api/calls/${callId}`);
      if (requestSeq !== callSelectSeqRef.current || currentView() !== "phone") return;
      state.currentCall = fetched;
      state.pendingCallFiles = [];
      localStorage.setItem("talentHub.activeTool", "phone");
      localStorage.setItem("talentHub.lastCall", callId);
      rerender();
    } catch (error) {
      if (requestSeq !== callSelectSeqRef.current || currentView() !== "phone") return;
      localStorage.removeItem("talentHub.lastCall");
      resetWorkspace();
      onToast((error as Error).message);
    }
  };

  const uploadPendingAudio = async (callId: string): Promise<number> => {
    let duplicateCount = 0;
    while (state.pendingCallFiles.length) {
      const file = state.pendingCallFiles[0];
      const result = await api<UploadResponse>(
        `/api/calls/${callId}/audio?filename=${encodeURIComponent(file.name)}`,
        { method: "PUT", body: file }
      );
      if (result.upload?.accepted === false) duplicateCount += 1;
      state.pendingCallFiles.shift();
      rerender();
    }
    state.currentCall = await api<CallTask>(`/api/calls/${callId}`);
    onHistoryChanged();
    if (duplicateCount) onToast(t("duplicateAudioSkipped", { count: duplicateCount }));
    return duplicateCount;
  };

  const startCallProcess = async () => {
    let current = state.currentCall as CallTask | null;
    if (current && current.status !== "draft") return;
    const hasAudio = state.pendingCallFiles.length > 0 || (current?.items?.length ?? 0) > 0;
    if (!hasAudio) {
      onToast(t("callNoAudio"));
      return;
    }
    if (!state.settings?.asr_configured) {
      onRequireSettings();
      return;
    }
    setStarting(true);
    try {
      if (!current) {
        const created = await api<CallTask>("/api/calls", {
          method: "POST",
          body: JSON.stringify({
            title: title.trim() || defaultCallTitle(),
            job_title: jobTitle.trim(),
            job_id: jobId,
            soft_skill_focus: softSkillFocus.trim(),
            soft_skill_dimensions: [...selectedDims],
          }),
        });
        state.currentCall = created;
        localStorage.setItem("talentHub.activeTool", "phone");
        localStorage.setItem("talentHub.lastCall", String(created.id));
        onHistoryChanged();
        setTitle("");
        setJobTitle("");
        setSoftSkillFocus("");
        setJobId("");
        setSelectedDims(new Set());
        current = created;
      }
      if (state.pendingCallFiles.length) {
        const beforeCount = (current.items || []).length;
        await uploadPendingAudio(String(current.id));
        const afterCount = ((state.currentCall as CallTask | null)?.items || []).length;
        if (afterCount === beforeCount) {
          onToast(t("noNewAudio")); // 所选录音全部重复，无新增条目，不触发整理
          return;
        }
      }
      const started = await api<CallTask>(`/api/calls/${String(current.id)}/process`, { method: "POST" });
      state.currentCall = started;
      onHistoryChanged();
      rerender();
    } catch (error) {
      onToast((error as Error).message);
    } finally {
      setStarting(false);
      rerender();
    }
  };

  // 已完成任务追加录音：上传 → 有新增则自动重新整理（复用筛选"追加简历"的交互模式）
  const appendCallAudio = async (fileList: FileList) => {
    const current = state.currentCall as CallTask | null;
    if (!current || current.status !== "done" || current.archived_at) return;
    if (appending) return; // 追加进行中忽略重复触发
    const files = collectCallAudioFiles(fileList);
    if (!files.length) return;
    if (!state.settings?.asr_configured) {
      onRequireSettings();
      return;
    }
    setAppending(true);
    try {
      let acceptedCount = 0;
      let duplicateCount = 0;
      for (const file of files) {
        const result = await api<UploadResponse>(
          `/api/calls/${String(current.id)}/audio?filename=${encodeURIComponent(file.name)}`,
          { method: "PUT", body: file }
        );
        if (result.upload?.accepted === false) duplicateCount += 1;
        else acceptedCount += 1;
      }
      if (!acceptedCount) {
        onToast(t("noNewAudio"));
        state.currentCall = await api<CallTask>(`/api/calls/${String(current.id)}`);
        rerender();
        return;
      }
      if (duplicateCount) onToast(t("duplicateAudioSkipped", { count: duplicateCount }));
      const started = await api<CallTask>(`/api/calls/${String(current.id)}/process`, { method: "POST" });
      state.currentCall = started;
      onHistoryChanged();
      rerender();
    } catch (error) {
      onToast((error as Error).message);
      try {
        state.currentCall = await api<CallTask>(`/api/calls/${String(current.id)}`);
        rerender();
      } catch {
        // 保留当前错误提示；重新打开历史任务时会恢复服务端状态
      }
    } finally {
      setAppending(false);
    }
  };
  const appendCallAudioRef = useRef<(fileList: FileList) => void>(() => { });
  useEffect(() => {
    appendCallAudioRef.current = appendCallAudio;
  });

  const cancelCall = async () => {
    const current = state.currentCall as CallTask | null;
    if (!current || cancelling) return;
    setCancelling(true);
    try {
      state.currentCall = await api<CallTask>(`/api/calls/${String(current.id)}/cancel`, { method: "POST" });
      onHistoryChanged();
      onToast(t("callCancelledToast"));
      rerender();
    } catch (error) {
      onToast((error as Error).message);
    } finally {
      setCancelling(false);
    }
  };

  const retryCall = async () => {
    const current = state.currentCall as CallTask | null;
    if (!current || retrying) return;
    setRetrying(true);
    try {
      state.currentCall = await api<CallTask>(`/api/calls/${String(current.id)}/process`, { method: "POST" });
      onHistoryChanged();
      rerender();
    } catch (error) {
      onToast((error as Error).message);
    } finally {
      setRetrying(false);
    }
  };

  // ---- 派生渲染数据 ----

  const running = ["queued", "running"].includes(callStatus);
  const archived = Boolean(call?.archived_at);
  const retryVisible = !running && !archived && ["failed", "cancelled"].includes(callStatus);
  const cancelVisible = running;
  const items = call?.items || [];
  const hasAudio = state.pendingCallFiles.length > 0 || items.length > 0;

  const detailTitle = String(call?.title || t("untitledJob"));
  const detailMeta = [
    ...(call?.job_title ? [String(call.job_title)] : []),
    t("callCandidateCount", { count: items.length }),
    ...(call?.stage ? [stageLabel(String(call.stage))] : []),
    formatDate(call?.updated_at),
  ].join(" · ");
  const errors = (call?.errors as string[] | undefined) || [];

  // ---- 新建表单 ----

  const audioListRows = (
    <div className="call-audio-list" id="callAudioList">
      {items.map((item) => {
        const itemId = String(item.id ?? "");
        return (
          <div className="call-audio-row" key={`uploaded:${itemId}`}>
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M19 11a7 7 0 0 1-7 7h-2a7 7 0 0 1-7-7M12 2v10" />
              <path d="m9 13 3-3 3 3" />
            </svg>
            <span>
              <strong>{String(item.audio_file || itemId)}</strong>
              <em>{String(item.candidate_name || itemId)}</em>
            </span>
          </div>
        );
      })}
      {state.pendingCallFiles.map((file, index) => (
        <div className="call-audio-row is-pending" key={`pending:${file.name}:${file.size}:${file.lastModified}`}>
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M19 11a7 7 0 0 1-7 7h-2a7 7 0 0 1-7-7M12 2v10" />
            <path d="m9 13 3-3 3 3" />
          </svg>
          <span>
            <strong>{file.name}</strong>
            <em>{formatSize(file.size)}</em>
          </span>
          <button
            type="button"
            className="call-audio-remove"
            title={t("callRemoveAudio", { name: file.name })}
            aria-label={t("callRemoveAudio", { name: file.name })}
            onClick={() => removePendingAudio(index)}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );

  const createView = (
    <div id="callCreateView" hidden={!showCreate}>
      <h3>{t("newCallTitle")}</h3>
      <p className="call-sub">{t("newCallLead")}</p>
      <div className="call-form-grid">
        <input
          id="callTitleInput"
          placeholder={t("callTitlePlaceholder")}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <input
          id="callJobInput"
          placeholder={t("callJobPlaceholder")}
          value={jobTitle}
          onChange={(event) => setJobTitle(event.target.value)}
        />
      </div>
      <div className="call-focus-field">
        <span>{t("callJobLinkLabel")}</span>
        <div className="custom-select" id="callJobLinkSelectWrap">
          <button
            type="button"
            className="custom-select-trigger"
            id="callJobLinkTrigger"
            aria-haspopup="listbox"
            aria-expanded="false"
          >
            <span className="custom-select-value" />
            <svg className="custom-select-arrow" aria-hidden="true" viewBox="0 0 24 24">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          <div className="custom-select-menu" id="callJobLinkMenu" role="listbox" hidden />
        </div>
        <select
          id="callJobLinkSelect"
          hidden
          value={jobId}
          onChange={handleJobSelectChange}
        >
          <option value="">{t("callJobLinkPlaceholder")}</option>
          {jobOptions.map((job) => (
            <option key={job.id} value={job.id}>
              {job.title}
            </option>
          ))}
        </select>
        <small className="call-field-hint">{t("callJobLinkHint")}</small>
      </div>
      <label className="call-focus-field" htmlFor="callSoftSkillInput">
        <span>{t("callSoftSkillLabel")}</span>
        <div id="callSoftSkillDims" className="call-soft-skill-dims" role="group">
          {SOFT_SKILL_DIMENSIONS.map((dim) => (
            <label key={dim.key}>
              <input
                type="checkbox"
                value={dim.key}
                checked={selectedDims.has(dim.key)}
                onChange={(event) => {
                  const next = new Set(selectedDims);
                  if (event.target.checked) next.add(dim.key);
                  else next.delete(dim.key);
                  setSelectedDims(next);
                }}
              />
              <span>{t(dim.labelKey)}</span>
            </label>
          ))}
        </div>
        <textarea
          id="callSoftSkillInput"
          rows={2}
          placeholder={t("callSoftSkillPlaceholder")}
          value={softSkillFocus}
          onChange={(event) => setSoftSkillFocus(event.target.value)}
        />
      </label>
      <label
        className={dragging ? "call-audio-drop dragging" : "call-audio-drop"}
        id="callAudioDrop"
        htmlFor="callAudioFiles"
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
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M19 11a7 7 0 0 1-7 7h-2a7 7 0 0 1-7-7M12 2v10" />
          <path d="m9 13 3-3 3 3" />
        </svg>
        <strong>{t("callDropTitle")}</strong>
        <span>{t("callDropMeta")}</span>
      </label>
      <input
        id="callAudioFiles"
        className="visually-hidden"
        type="file"
        multiple
        accept={CALL_AUDIO_ACCEPT}
        onChange={handleAudioInputChange}
      />
      {audioListRows}
      <Button
        variant="primary"
        id="startCallProcessButton"
        disabled={!hasAudio}
        busy={starting}
        onClick={() => void startCallProcess()}
      >
        <span>{t("startOrganize")}</span>
      </Button>
      <p className="call-privacy-note">{t("callPrivacyNote")}</p>
    </div>
  );

  // ---- 详情视图（条目卡片列表） ----

  const itemCards = (
    <div className="call-items" id="callItems">
      {items.map((item) => {
        const itemId = String(item.id ?? "");
        const itemStatus = String(item.status ?? "");
        const done = itemStatus === "done";
        const active = itemStatus === "transcribing" || itemStatus === "summarizing";
        return (
          <article className={done ? "call-item-card done" : "call-item-card"} key={itemId} data-item-id={itemId}>
            <button
              type="button"
              className="call-item-head"
              onClick={done ? () => setDetailItemId(itemId) : undefined}
            >
              <strong>{String(item.candidate_name || item.audio_file || itemId)}</strong>
              <span className={`call-badge ${callStatusBadgeClass(itemStatus)}`}>
                {callItemStatusLabel(itemStatus)}
              </span>
            </button>
            {!done && (
              <>
                <div className={active ? "call-item-progress is-active" : "call-item-progress"}>
                  <Progress trackClassName="call-progress-track" value={Number(item.progress) || 0} />
                  <span>{Number(item.progress) || 0}%</span>
                </div>
                {item.error ? <div className="call-item-error">{String(item.error)}</div> : null}
              </>
            )}
          </article>
        );
      })}
    </div>
  );

  const detailView = (
    <div id="callDetailView" hidden={showCreate}>
      <header className="call-detail-header">
        <div>
          <h3 id="callDetailTitle">{detailTitle}</h3>
          <p className="call-sub" id="callDetailMeta">{detailMeta}</p>
        </div>
        <div className="call-detail-actions">
          <Button
            variant="secondary"
            id="callRetryButton"
            hidden={!retryVisible}
            busy={retrying}
            onClick={() => void retryCall()}
          >
            {t("retryCall")}
          </Button>
          <Button
            variant="secondary"
            id="callCancelButton"
            hidden={!cancelVisible}
            busy={cancelling}
            onClick={() => void cancelCall()}
          >
            {t("cancelTask")}
          </Button>
        </div>
      </header>
      {itemCards}
      <div className="call-errors" id="callErrors" hidden={!errors.length}>
        {errors.join("\n")}
      </div>
    </div>
  );

  return (
    <section id="phoneView" className="phone-view">
      <div className="call-layout">
        <section className="call-workbench" id="callWorkbench">
          {createView}
          {detailView}
        </section>
      </div>
      <input id="appendCallAudioFiles" type="file" multiple accept={CALL_AUDIO_ACCEPT} hidden />
      {detailItemId && call && (
        <CallItemDetail
          call={call}
          itemId={detailItemId}
          onSelectItem={setDetailItemId}
          onClose={() => setDetailItemId(null)}
          onToast={onToast}
          onSaved={handleItemSaved}
        />
      )}
    </section>
  );
}
