// =====================================================================
// 电话条目详情浮层（React）：详情展示与音频生命周期管理。
// - 编辑类弹窗：仅关闭按钮 + ESC 退出，点遮罩不关闭（防误触打断录音/丢未保存输入）
// - 详情内容：候选人（可编辑）/ 音频播放器 / narrative textarea / 可折叠面板
//   （fields / facts / doubts / transcript / guard_warnings）
// - 音频：GET /api/calls/{call_id}/items/{item_id}/audio（Blob → createObjectURL），
//   模块级 Map 缓存（audioBlobUrls）复用 + 并发下载合并（audioBlobPending）；
//   仅切换任务/重置时整体 revoke（releaseAudioBlobs，浮层关闭保留缓存）；
//   加载失败隐藏播放器并 toast callAudioLoadFail；0 秒首包解码失败时从 0.064s 重试一次
// - 播放恢复：React 对同一条目复用 <audio> DOM 节点，轮询重绘不销毁元素，播放
//   天然持续（captureCallPlayback/restoreCallPlayback：元素被
//   重建时经 ref 回调捕获快照并暂停，加载完成后按快照补偿已播时长恢复，恢复前
//   一次性监听 play/pause/seeked 防覆盖用户操作）；条目切换不跨条目恢复
// - 编辑保存：PUT /api/calls/{id}/items/{item_id}，body {narrative, candidate_name,
//   fields:[{key,label,value,status,fact_ids,note}]}（完整覆盖语义可清空），
//   保存后回读 GET /api/calls/{id}
// - facts 跳转：点击事实行 → currentTime = start_time 并播放
// - Markdown 下载：GET .../items/{item_id}/download，文件名解析 filename* → filename
//   → 回退 {itemId}.md
// - 上一个/下一个：按已完成条目顺序切换（端点禁用态）
// - 非 done 条目（转写中/整理中/failed）在详情内展示进度与错误
// - 遮罩通过 Portal 挂到 body，避免受电话视图动画的层叠上下文限制
// - 语言切换重渲染（i18n onChange）
// =====================================================================

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client";
import { onChange, t } from "../i18n";
import { state } from "../state";
import { Button } from "../ui/Button";
import { Progress } from "../ui/Progress";

// ---------------------------------------------------------------------
// 类型（字段与 GET /api/calls/{id} 响应契约一致，见 docs/source-map/06-api-runtime.md §11.3）
// ---------------------------------------------------------------------

/** 电话任务 */
export type CallTask = Record<string, unknown> & {
  id?: unknown;
  title?: string;
  job_title?: string;
  job_id?: string;
  soft_skill_focus?: string;
  soft_skill_dimensions?: string[];
  status?: string;
  stage?: string;
  updated_at?: string;
  archived_at?: string;
  errors?: string[];
  items?: CallItem[];
};

/** 电话条目 */
export type CallItem = Record<string, unknown> & {
  id?: unknown;
  audio_file?: string;
  candidate_name?: string;
  status?: string;
  progress?: unknown;
  error?: unknown;
  stage?: string;
  summary?: CallItemSummary;
};

/** 条目整理结果（item.summary） */
export interface CallItemSummary {
  narrative?: string;
  fields?: Array<{
    key?: string;
    label?: string;
    value?: string;
    status?: string;
    fact_ids?: unknown[];
    note?: string;
  }>;
  facts?: Array<{ content?: string; speaker?: string; ref?: string; start_time?: unknown }>;
  doubts?: string[];
  guard_warnings?: string[];
  transcript?: string;
}

export interface CallItemDetailProps {
  /** 当前电话任务（轮询更新后重渲染；音频元素按条目复用保持播放） */
  call: CallTask;
  /** 当前打开的条目 id */
  itemId: string;
  /** 上一个/下一个切换目标条目（按已完成顺序） */
  onSelectItem: (itemId: string) => void;
  onClose: () => void;
  onToast: (message: string) => void;
  /** 保存成功并回读后通知外层（历史列表刷新/界面同步） */
  onSaved: () => void;
}

// ---------------------------------------------------------------------
// 音频 Blob 缓存（模块级，audioBlobUrls / audioBlobPending）
// ---------------------------------------------------------------------

// 已加载的条目音频 Blob URL 缓存（key: callId:itemId），轮询重绘/重开详情时复用，
// 避免泄漏与重复下载。浮层关闭不清缓存，仅切换任务/重置时整体释放。
const audioBlobUrls = new Map<string, string>();
// 正在下载的条目音频 Promise（key 同上）：并发触发时复用同一请求，避免同一录音被重复下载。
const audioBlobPending = new Map<string, Promise<string>>();

/** 释放全部音频 Blob URL 并清空缓存与进行中标记 */
export function releaseAudioBlobs(): void {
  for (const url of audioBlobUrls.values()) {
    URL.revokeObjectURL(url);
  }
  audioBlobUrls.clear();
  audioBlobPending.clear();
}

async function loadCallAudio(callId: string, itemId: string): Promise<string | null> {
  const key = `${callId}:${itemId}`;
  let url = audioBlobUrls.get(key);
  if (!url) {
    let pending = audioBlobPending.get(key);
    if (!pending) {
      pending = api<Response>(`/api/calls/${callId}/items/${itemId}/audio`)
        .then((response) => response.blob())
        .then((blob) => {
          const created = URL.createObjectURL(blob);
          audioBlobUrls.set(key, created);
          return created;
        });
      // 无论成败都清理进行中标记；失败不写缓存，允许下次重试。catch 吞掉 rejection，
      // 错误提示统一在 await 处处理，避免产生未处理的 Promise 拒绝。
      pending.finally(() => audioBlobPending.delete(key)).catch(() => { });
      audioBlobPending.set(key, pending);
    }
    try {
      url = await pending;
    } catch {
      return null;
    }
  }
  return url;
}

// ---------------------------------------------------------------------
// 播放状态快照（captureCallPlayback/restoreCallPlayback）
// ---------------------------------------------------------------------

interface PlaybackSnapshot {
  currentTime: number;
  playing: boolean;
  capturedAt: number;
}

/** 播放：jsdom 环境 play() 可能不同步返回 Promise，统一安全调用 */
function safePlay(audio: HTMLAudioElement): void {
  try {
    const result = audio.play() as unknown;
    if (result && typeof (result as Promise<void>).catch === "function") {
      (result as Promise<void>).catch(() => { });
    }
  } catch {
    // 播放失败（格式不支持/交互限制）忽略
  }
}

/** 恢复播放：按快照补偿「捕获→恢复」已播时长后 seek+play；恢复前监听
 *  play/pause/seeked，用户已操作播放器则不覆盖（M2） */
function restoreCallPlayback(audio: HTMLAudioElement, saved: PlaybackSnapshot | undefined): void {
  if (!saved || (!saved.playing && saved.currentTime <= 0)) return;
  let userTouched = false;
  for (const eventName of ["play", "pause", "seeked"] as const) {
    audio.addEventListener(eventName, () => { userTouched = true; }, { once: true });
  }
  const resume = () => {
    if (userTouched) return;
    const target = saved.playing ? saved.currentTime + (Date.now() - saved.capturedAt) / 1000 : saved.currentTime;
    if (target > 0) {
      try { audio.currentTime = target; } catch { /* 元数据未就绪时忽略 */ }
    }
    if (saved.playing) safePlay(audio);
  };
  if (audio.readyState >= 1) resume();
  else audio.addEventListener("loadedmetadata", resume, { once: true });
}

/** 事实时间格式化（m:ss） */
function formatFactTime(seconds: number): string {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

/** 条目状态文案（与 PhoneView 卡片徽章共用） */
export function callItemStatusLabel(status: string): string {
  const map: Record<string, string> = {
    queued: t("callStatusQueued"),
    transcribing: t("callStatusTranscribing"),
    summarizing: t("callStatusSummarizing"),
    done: t("callStatusDone"),
    failed: t("callStatusFailed"),
    cancelled: t("callStatusCancelled"),
  };
  return map[status] || status;
}

/** 处理环节文案 */
export function stageLabel(stage: string): string {
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

// ---------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------

/** 可折叠面板（<details> 结构） */
function CallPanel({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="call-panel" open={defaultOpen}>
      <summary>{title}</summary>
      <div className="call-panel-body">{children}</div>
    </details>
  );
}

export function CallItemDetail({ call, itemId, onSelectItem, onClose, onToast, onSaved }: CallItemDetailProps) {
  const [, forceRender] = useState(0);
  const rerender = useCallback(() => forceRender((n) => n + 1), []);

  const callId = String(call.id ?? "");
  const items = call.items || [];
  const item = items.find((entry) => String(entry.id) === String(itemId)) || null;
  const itemKey = `${callId}:${itemId}`;
  const summary = (item?.summary || {}) as CallItemSummary;
  const done = String(item?.status ?? "") === "done";
  const processing = ["queued", "transcribing", "summarizing"].includes(String(item?.status ?? ""));
  // 上/下一个可用性：按已完成条目顺序
  const doneIds = items.filter((entry) => String(entry.status) === "done").map((entry) => String(entry.id));
  const index = doneIds.indexOf(String(itemId));
  const canPrev = index > 0;
  const canNext = index !== -1 && index < doneIds.length - 1;

  // 编辑表单值：随条目切换重置（body 以 itemKey 为 key 重建，此处用效果回填初值）
  const [narrative, setNarrative] = useState("");
  const [candidateName, setCandidateName] = useState("");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    setNarrative(summary.narrative || "");
    setCandidateName(String(item?.candidate_name ?? ""));
    const values: Record<string, string> = {};
    for (const field of summary.fields || []) {
      values[String(field.key ?? "")] = String(field.value ?? "");
    }
    setFieldValues(values);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemKey]);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  // 播放快照（state 驱动恢复用）：key 为 itemKey，元素被重建时经 ref 回调捕获
  const playbackRef = useRef<Map<string, PlaybackSnapshot>>(new Map());

  // 音频元素挂载/卸载：卸载时捕获播放快照并暂停（防止声音持续到 GC 造成双音/混响）。
  // 回调按 itemKey 重建，保证元素卸载时快照落在正确的条目 key 上。
  const attachAudio = useCallback(
    (node: HTMLAudioElement | null) => {
      if (node) {
        audioRef.current = node;
        return;
      }
      const audio = audioRef.current;
      if (audio) {
        const currentTime = audio.currentTime;
        playbackRef.current.set(itemKey, {
          currentTime: Number.isFinite(currentTime) && currentTime > 0 ? currentTime : 0,
          playing: Boolean(!audio.paused && !audio.ended),
          capturedAt: Date.now(),
        });
        audio.pause();
      }
      audioRef.current = null;
    },
    [itemKey]
  );

  // 音频懒加载：浮层打开（条目为 done）时经 api() 下载为 Blob 挂载到播放器；
  // 命中模块级缓存不重复请求；同一条目轮询重绘复用同一 <audio> 元素，播放持续。
  useEffect(() => {
    if (!done || !item) return;
    const audio = audioRef.current;
    if (!audio || audio.src) return;
    let cancelled = false;
    let retriedInitialDecode = false;
    const recoverInitialDecode = () => {
      if (retriedInitialDecode || audio.error?.code !== 3 || audio.currentTime > 0 || !audio.src) return;
      retriedInitialDecode = true;
      audio.src = `${audio.src}#t=0.064`;
      audio.load();
    };
    audio.addEventListener("error", recoverInitialDecode);
    void loadCallAudio(callId, String(item.id)).then((url) => {
      if (cancelled) return;
      if (url === null) {
        // 加载失败：隐藏播放器并提示一次（元素已隐藏则不再重复提示）
        if (!audio.hidden) {
          onToast(t("callAudioLoadFail"));
          audio.hidden = true;
        }
        return;
      }
      if (audio.src) return; // 加载期间条目已切换（元素被复用/重建），跳过
      audio.src = url;
      // 元素被重建（状态往返重挂载）时按快照恢复播放；正常轮询路径元素稳定，
      // 快照为初始态，此处为 no-op
      restoreCallPlayback(audio, playbackRef.current.get(itemKey));
    });
    return () => {
      cancelled = true;
      audio.removeEventListener("error", recoverInitialDecode);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemKey, done, onToast]);

  // 开合动画：挂载后下一帧置 .is-visible 播放入场；关闭先移除 .is-visible
  // 播放离场动画（transform .3s）再回调 onClose 卸载
  const [entered, setEntered] = useState(false);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setEntered(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, []);
  const handleClose = useCallback(() => {
    setLeaving(true);
    window.setTimeout(onClose, 320);
  }, [onClose]);

  // ESC 关闭（编辑类弹窗：仅关闭按钮 + ESC，点遮罩不关闭）
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleClose]);

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

  if (!item) return null;

  const itemIdStr = String(item.id ?? "");
  const meta = (() => {
    const stage = item.stage ? stageLabel(String(item.stage)) : "";
    const statusLabel = callItemStatusLabel(String(item.status ?? ""));
    return stage && stage !== statusLabel ? `${stage} · ${statusLabel}` : statusLabel;
  })();

  const jumpToTime = (startTime: unknown) => {
    const audio = audioRef.current;
    if (!audio) return;
    const seekAndPlay = () => {
      try {
        audio.currentTime = Number(startTime) || 0;
      } catch { /* 元数据未就绪时忽略 */ }
      safePlay(audio);
    };
    if (audio.src && audio.readyState >= 1) {
      seekAndPlay();
      return;
    }
    void loadCallAudio(callId, itemIdStr).then((url) => {
      if (url === null) return; // 加载失败已隐藏播放器
      if (!audio.src) audio.src = url;
      if (audio.readyState >= 1) seekAndPlay();
      else audio.addEventListener("loadedmetadata", seekAndPlay, { once: true });
    });
  };

  const handleSave = async () => {
    if (!item || !done) return;
    setSaving(true);
    try {
      // 完整覆盖语义：fields 以当前条目 summary 为基座，编辑值可清空
      const fieldByKey = new Map((item.summary?.fields || []).map((field) => [String(field.key ?? ""), field]));
      const fields = Object.entries(fieldValues).map(([key, value]) => {
        const base = fieldByKey.get(key) || {};
        return {
          key,
          label: String(base.label || key),
          value,
          status: String(base.status || "已确认"),
          fact_ids: base.fact_ids || [],
          note: String(base.note || ""),
        };
      });
      await api(`/api/calls/${callId}/items/${itemIdStr}`, {
        method: "PUT",
        body: JSON.stringify({ narrative: narrative.trim(), candidate_name: candidateName.trim(), fields }),
      });
      state.currentCall = await api<CallTask>(`/api/calls/${callId}`);
      onSaved();
      onToast(t("callSaved"));
    } catch (error) {
      onToast((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDownload = async () => {
    if (!item) return;
    setDownloading(true);
    try {
      const response = await api<Response>(`/api/calls/${callId}/items/${itemIdStr}/download`);
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") || "";
      // 文件名解析：filename*（RFC 5987）→ filename → 回退 {itemId}.md
      let name = `${itemIdStr}.md`;
      const utf8 = disposition.match(/filename\*=utf-8''([^;]+)/i);
      if (utf8) name = decodeURIComponent(utf8[1]);
      else {
        const plain = disposition.match(/filename="?([^";]+)"?/i);
        if (plain) name = plain[1];
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      onToast((error as Error).message);
    } finally {
      setDownloading(false);
    }
  };

  // 非 done 条目：详情内展示进度/错误（保留浮层展示状态）
  if (!done) {
    return createPortal(
      <div className={entered && !leaving ? "preview-backdrop is-visible" : "preview-backdrop"}>
        <section className={entered && !leaving ? "call-item-detail preview-dialog is-visible" : "call-item-detail preview-dialog"} role="dialog" aria-modal="true" aria-label={String(item.candidate_name || item.audio_file || itemIdStr)}>
          <div className="call-item-detail-head">
            <Button variant="icon" aria-label={t("callItemBack")} title={t("callItemBack")} onClick={handleClose}>
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M19 12H5m7 7-7-7 7-7" />
              </svg>
            </Button>
            <div className="call-item-detail-titles">
              <strong>{String(item.candidate_name || item.audio_file || itemIdStr)}</strong>
              <em>{meta}</em>
            </div>
            <div className="call-item-detail-nav">
              <Button variant="secondary" disabled={!canPrev} onClick={() => onSelectItem(doneIds[index - 1])}>
                {t("callItemPrev")}
              </Button>
              <Button variant="secondary" disabled={!canNext} onClick={() => onSelectItem(doneIds[index + 1])}>
                {t("callItemNext")}
              </Button>
            </div>
          </div>
          <div className="call-item-detail-scroll">
            <div className="call-item-body">
              <div className={processing ? "call-item-progress is-active" : "call-item-progress"}>
                <Progress trackClassName="call-progress-track" value={Number(item.progress) || 0} />
                <span>{Number(item.progress) || 0}%</span>
              </div>
              {item.error ? <div className="call-item-error">{String(item.error)}</div> : null}
            </div>
          </div>
        </section>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div className={entered && !leaving ? "preview-backdrop is-visible" : "preview-backdrop"}>
      <section className={entered && !leaving ? "call-item-detail preview-dialog is-visible" : "call-item-detail preview-dialog"} role="dialog" aria-modal="true" aria-label={String(item.candidate_name || item.audio_file || itemIdStr)}>
        <div className="call-item-detail-head">
          <Button variant="icon" aria-label={t("callItemBack")} title={t("callItemBack")} onClick={handleClose}>
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M19 12H5m7 7-7-7 7-7" />
            </svg>
          </Button>
          <div className="call-item-detail-titles">
            <strong>{String(item.candidate_name || item.audio_file || itemIdStr)}</strong>
            <em>{meta}</em>
          </div>
          <div className="call-item-detail-nav">
            <Button variant="secondary" disabled={!canPrev} onClick={() => onSelectItem(doneIds[index - 1])}>
              {t("callItemPrev")}
            </Button>
            <Button variant="secondary" disabled={!canNext} onClick={() => onSelectItem(doneIds[index + 1])}>
              {t("callItemNext")}
            </Button>
          </div>
        </div>
        <div className="call-item-detail-scroll">
          {/* body 以 itemKey 为 key：切换条目时整体重建（表单初值与音频元素复位） */}
          <div className="call-item-body call-item-detail-layout" key={itemKey}>
            <div className="call-item-detail-main">
              <div className="call-candidate-row">
                <span>{t("callCandidate")}</span>
                <input
                  className="call-candidate-input"
                  value={candidateName}
                  onChange={(event) => setCandidateName(event.target.value)}
                />
              </div>
              <audio ref={attachAudio} className="call-audio" controls preload="none" />
              <span className="call-section-label">{t("callNarrative")}</span>
              <textarea
                className="call-narrative"
                value={narrative}
                onChange={(event) => setNarrative(event.target.value)}
              />
            </div>
            <div className="call-item-detail-side">
              <div className="call-panels">
                {(summary.fields || []).length > 0 && (
                  <CallPanel title={t("callFieldsPanel")} defaultOpen>
                    {(summary.fields || []).map((field, fieldIndex) => {
                      const key = String(field.key ?? "");
                      return (
                        <label className="call-field-row" key={key || fieldIndex}>
                          <span>{String(field.label || key)}</span>
                          <textarea
                            className="call-field-input"
                            value={fieldValues[key] ?? ""}
                            onChange={(event) =>
                              setFieldValues((prev) => ({ ...prev, [key]: event.target.value }))
                            }
                          />
                        </label>
                      );
                    })}
                  </CallPanel>
                )}
                {(summary.doubts || []).length > 0 && (
                  <CallPanel title={t("callDoubtsPanel")}>
                    <ul className="call-doubt-list">
                      {(summary.doubts || []).map((doubt, doubtIndex) => (
                        <li key={doubtIndex}>{doubt}</li>
                      ))}
                    </ul>
                  </CallPanel>
                )}
                {(summary.facts || []).length > 0 && (
                  <CallPanel title={t("callFactsPanel")}>
                    {(summary.facts || []).map((fact, factIndex) => {
                      const hasTime = fact.start_time != null && Number.isFinite(Number(fact.start_time));
                      return (
                        <button
                          type="button"
                          className="call-fact-row"
                          key={factIndex}
                          disabled={!hasTime}
                          title={hasTime ? t("callFactJump") : t("callFactNoTime")}
                          onClick={() => hasTime && jumpToTime(fact.start_time)}
                        >
                          <span className="call-fact-content">{String(fact.content ?? "")}</span>
                          <em>
                            {[
                              String(fact.speaker ?? ""),
                              hasTime ? formatFactTime(Number(fact.start_time)) : t("callFactNoTime"),
                              String(fact.ref ?? ""),
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </em>
                        </button>
                      );
                    })}
                  </CallPanel>
                )}
                {summary.transcript ? (
                  <CallPanel title={t("callTranscriptPanel")}>
                    <pre className="call-transcript">{summary.transcript}</pre>
                  </CallPanel>
                ) : null}
                {(summary.guard_warnings || []).length > 0 && (
                  <CallPanel title={t("callGuardPanel", { count: summary.guard_warnings?.length ?? 0 })}>
                    <ul className="call-doubt-list">
                      {(summary.guard_warnings || []).map((warning, warningIndex) => (
                        <li key={warningIndex}>{warning}</li>
                      ))}
                    </ul>
                  </CallPanel>
                )}
              </div>
              <div className="call-item-actions">
                <Button variant="secondary" busy={saving} onClick={() => void handleSave()}>
                  {t("callSave")}
                </Button>
                <Button variant="secondary" busy={downloading} onClick={() => void handleDownload()}>
                  {t("callDownload")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
