// =====================================================================
// 历史任务抽屉（React）：查看类抽屉。
// - 查看类抽屉：关闭按钮 + ESC + 点遮罩关闭
// - 按当前视图固定展示 job 或 call 单列表（initialKind 由外层按视图传入），
//   抽屉内 recent/archived tab 切换；
//   分页 limit=50 + offset 追加「加载更多」，tab 计数显示 total
// - 数据：GET /api/jobs?scope=&limit=&offset= → {jobs, total}、
//   GET /api/calls?scope=... → {calls, total}；存储占用 GET /api/storage
//   （job_count/jobs_bytes，仅 job 列表展示）
// - 行操作：归档/恢复 POST /api/{jobs|calls}/{id}/archive|restore；
//   永久删除 DELETE /api/{jobs|calls}/{id}（确认框，删除中按钮禁用 +
//   deleting 文案 + toast）；queued/running 任务禁用归档与删除
// - 当前任务切换：点击行 → onOpenJob/onOpenCall props 回调，组件不依赖
//   screening/phone 模块；active 行按
//   全局 state 的 currentJob/currentCall id 判断
// - 记录变更成功：通过 onMutation 上报删除身份或归档/恢复后的服务端摘要，
//   由外层同步当前工作区
// - 语言切换经 i18n onChange 重渲染
// =====================================================================

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client";
import { displayCallTitle } from "../callTitle";
import { getLanguage, onChange, t } from "../i18n";
import { state } from "../state";
import { Button } from "./Button";
import { EmptyState } from "./EmptyState";
import { Toast } from "./Toast";
import { useDialogAnimation } from "./useDialogAnimation";

export type HistoryKind = "job" | "call";
export type HistoryScope = "recent" | "archived";

export interface HistoryItem {
  id: string;
  title: string;
  title_mode?: "auto" | "custom";
  status: string;
  stage?: string;
  job_title?: string;
  updated_at?: string;
  archived_at?: string | null;
}

export type HistoryMutation =
  | { action: "delete"; kind: HistoryKind; itemId: string }
  | { action: "archive" | "restore"; kind: HistoryKind; item: HistoryItem };

export interface HistoryDrawerProps {
  open: boolean;
  /** 打开时的初始列表类型（外层按当前视图决定：电话视图传 "call"，否则 "job"） */
  initialKind?: HistoryKind;
  onClose: () => void;
  /** 点击 job 行：通知外层打开对应筛选任务视图 */
  onOpenJob: (jobId: string) => void;
  /** 点击 call 行：通知外层打开对应电话任务视图 */
  onOpenCall: (callId: string) => void;
  /** 记录变更成功：通知外层同步当前工作区 */
  onMutation: (mutation: HistoryMutation) => void;
}

interface DeleteTarget {
  kind: HistoryKind;
  item: HistoryItem;
}

// ---- 文案/格式化辅助 ----

function formatDate(value: string | undefined): string {
  if (!value) return "";
  const locale = getLanguage() === "en" ? "en-US" : "zh-CN";
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatStorageSize(bytes: number): string {
  const value = Math.max(0, Number(bytes) || 0);
  if (value === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unitIndex = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const amount = value / 1024 ** unitIndex;
  return `${amount.toFixed(unitIndex > 1 && amount < 10 ? 1 : 0)} ${units[unitIndex]}`;
}

function displayJobTitle(title: string): string {
  return !title || ["岗位候选人筛选", "Candidate Screening"].includes(title) ? t("jobTitle") : title;
}

function stageLabel(stage: string | undefined): string {
  if (getLanguage() === "zh-CN") {
    const exactZh: Record<string, string> = {
      "JD 已就绪": "岗位说明已就绪",
      "解析岗位 JD": "解析岗位说明",
      "生成并校验 Excel": "生成并校验表格",
      "上传岗位 JD": "上传岗位说明",
    };
    return exactZh[stage ?? ""] || stage || t("preparingTask");
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
  if (exact[stage ?? ""]) return exact[stage ?? ""];
  const uploaded = String(stage ?? "").match(/^已上传 (\d+) 份简历$/);
  if (uploaded) return `${uploaded[1]} resumes uploaded`;
  const evaluating = String(stage ?? "").match(/^评估候选人 (\d+)\/(\d+)$/);
  if (evaluating) return `Evaluating candidates ${evaluating[1]}/${evaluating[2]}`;
  const processing = String(stage ?? "").match(/^处理中 (\d+)\/(\d+)$/);
  if (processing) return `Processing ${processing[1]}/${processing[2]}`;
  return t("stageFallback");
}

function statusLabel(job: HistoryItem): string {
  const map: Record<string, string> = {
    draft: t("statusDraft"),
    queued: t("statusQueued"),
    waiting: t("statusWaiting"),
    running: stageLabel(job.stage),
    completed: t("statusCompleted"),
    failed: t("statusFailed"),
    cancelled: t("statusCancelled"),
  };
  return map[job.status] || job.status;
}

function callStatusLabel(call: HistoryItem): string {
  const map: Record<string, string> = {
    draft: t("callStatusDraft"),
    queued: t("callStatusQueued"),
    running: t("callStatusRunning"),
    done: t("callStatusDone"),
    failed: t("callStatusFailed"),
    cancelled: t("callStatusCancelled"),
  };
  return map[call.status] || call.status;
}

// ---- SVG 图标 ----

function Svg({ paths }: { paths: string[] }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      {paths.map((d, index) => (
        <path key={index} d={d} />
      ))}
    </svg>
  );
}

const ICON_MORE = ["M5 12h.01M12 12h.01M19 12h.01"];
const ICON_ARCHIVE = ["M21 8v13H3V8", "M1 3h22v5H1z", "M10 12h4"];
const ICON_RESTORE = ["M3 12a9 9 0 1 0 3-6.7L3 8", "M3 3v5h5"];
const ICON_DELETE = ["M3 6h18", "M8 6V4h8v2", "M19 6l-1 15H6L5 6", "M10 11v6M14 11v6"];
const ICON_EMPTY = ["M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"];

export function HistoryDrawer({
  open,
  initialKind = "job",
  onClose,
  onOpenJob,
  onOpenCall,
  onMutation,
}: HistoryDrawerProps) {
  const [kind, setKind] = useState<HistoryKind>(initialKind);
  const [jobScope, setJobScope] = useState<HistoryScope>("recent");
  const [callScope, setCallScope] = useState<HistoryScope>("recent");
  const [jobLists, setJobLists] = useState<{ recent: HistoryItem[]; archived: HistoryItem[] }>({
    recent: [],
    archived: [],
  });
  const [jobTotals, setJobTotals] = useState<{ recent: number; archived: number }>({ recent: 0, archived: 0 });
  const [callLists, setCallLists] = useState<{ recent: HistoryItem[]; archived: HistoryItem[] }>({
    recent: [],
    archived: [],
  });
  const [callTotals, setCallTotals] = useState<{ recent: number; archived: number }>({ recent: 0, archived: 0 });
  const [loading, setLoading] = useState(false);
  const [storage, setStorage] = useState<{ job_count?: number; jobs_bytes?: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [, forceRender] = useState(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scope = kind === "call" ? callScope : jobScope;
  const lists = kind === "call" ? callLists : jobLists;
  const totals = kind === "call" ? callTotals : jobTotals;
  const items = scope === "archived" ? lists.archived : lists.recent;
  const isCall = kind === "call";

  const showToast = (message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  };

  const fetchList = async (target: HistoryKind, targetScope: HistoryScope, offset: number) => {
    if (target === "call") {
      const payload = await api<{ calls: HistoryItem[]; total: number }>(
        `/api/calls?scope=${targetScope}&limit=50&offset=${offset}`
      );
      return { items: payload.calls, total: payload.total };
    }
    const payload = await api<{ jobs: HistoryItem[]; total: number }>(
      `/api/jobs?scope=${targetScope}&limit=50&offset=${offset}`
    );
    return { items: payload.jobs, total: payload.total };
  };

  const applyList = (
    target: HistoryKind,
    targetScope: HistoryScope,
    list: HistoryItem[],
    total: number,
    append: boolean
  ) => {
    if (target === "call") {
      setCallLists((prev) => {
        const merged = append ? [...prev[targetScope], ...list] : list;
        return { ...prev, [targetScope]: merged };
      });
      setCallTotals((prev) => ({ ...prev, [targetScope]: total }));
    } else {
      setJobLists((prev) => {
        const merged = append ? [...prev[targetScope], ...list] : list;
        return { ...prev, [targetScope]: merged };
      });
      setJobTotals((prev) => ({ ...prev, [targetScope]: total }));
    }
  };

  /** 刷新目标 kind 的 recent/archived 两列表（job 附带存储占用） */
  const refresh = async (target: HistoryKind) => {
    setLoading(true);
    try {
      const [recent, archived, storageRes] = await Promise.all([
        fetchList(target, "recent", 0),
        fetchList(target, "archived", 0),
        target === "job" ? api<{ job_count?: number; jobs_bytes?: number }>("/api/storage") : Promise.resolve(null),
      ]);
      applyList(target, "recent", recent.items, recent.total, false);
      applyList(target, "archived", archived.items, archived.total, false);
      if (target === "job") setStorage(storageRes);
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // 打开：重置 kind / 删除确认态并拉取初始 kind 数据
  useEffect(() => {
    if (!open) return;
    setKind(initialKind);
    setPendingDelete(null);
    setDeleting(false);
    setOpenMenuId(null);
    void refresh(initialKind);
  }, [open]);

  // 语言切换时重渲染（文案 / 日期格式随语言变化）
  useEffect(() => {
    let active = true;
    onChange(() => {
      if (active) forceRender((n) => n + 1);
    });
    return () => {
      active = false;
    };
  }, []);

  const handleClose = () => {
    onClose();
  };

  // ESC：先关删除确认框（删除中忽略），否则关抽屉
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (pendingDelete) {
        if (!deleting) setPendingDelete(null);
        return;
      }
      handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pendingDelete, deleting, handleClose]);

  const switchScope = (next: HistoryScope) => {
    if (next === scope) return;
    if (kind === "call") setCallScope(next);
    else setJobScope(next);
    setOpenMenuId(null);
  };

  const loadMore = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const page = await fetchList(kind, scope, items.length);
      applyList(kind, scope, page.items, page.total, true);
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const changeArchiveState = async (item: HistoryItem, action: "archive" | "restore") => {
    if (["queued", "running"].includes(item.status)) return;
    setOpenMenuId(null);
    const base = isCall ? `/api/calls/${item.id}` : `/api/jobs/${item.id}`;
    try {
      const updated = await api<HistoryItem>(`${base}/${action}`, { method: "POST" });
      onMutation({ action, kind, item: updated });
      await refresh(kind);
      const toastKey =
        action === "archive"
          ? isCall
            ? "callArchivedToast"
            : "archivedToast"
          : isCall
            ? "callRestoredToast"
            : "restoredToast";
      showToast(t(toastKey));
    } catch (error) {
      showToast((error as Error).message);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    const base = pendingDelete.kind === "call" ? `/api/calls/${pendingDelete.item.id}` : `/api/jobs/${pendingDelete.item.id}`;
    try {
      await api(base, { method: "DELETE" });
      onMutation({ action: "delete", kind: pendingDelete.kind, itemId: pendingDelete.item.id });
      setPendingDelete(null);
      await refresh(pendingDelete.kind);
      showToast(t(pendingDelete.kind === "call" ? "callDeletedToast" : "deletedToast"));
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  const deleteTarget = pendingDelete;
  const deleteTitleKey = deleteTarget?.kind === "call" ? "callDeleteTitle" : "deleteJobTitle";
  const deleteLeadKey = deleteTarget?.kind === "call" ? "callDeleteLead" : "deleteJobLead";
  const deleteDetailKey = deleteTarget?.kind === "call" ? "callDeleteDetail" : "deleteJobDetail";
  const deleteName = deleteTarget?.item.title
    ? deleteTarget.kind === "call"
      ? displayCallTitle(deleteTarget.item)
      : displayJobTitle(deleteTarget.item.title)
    : t("untitledJob");

  // 开合动画：抽屉 transform .3s（340ms 卸载），删除确认框用公共过渡时长
  const drawerAnim = useDialogAnimation(open, 340);
  const confirmAnim = useDialogAnimation(Boolean(deleteTarget), 300);

  if (!drawerAnim.mounted) return null;

  const archived = scope === "archived";
  const loadMoreVisible = !loading && items.length < totals[scope];

  const renderRow = (item: HistoryItem): ReactNode => {
    const active = isCall ? state.currentCall?.id === item.id : state.currentJob?.id === item.id;
    const title = item.title ? (isCall ? displayCallTitle(item) : displayJobTitle(item.title)) : t("untitledJob");
    const metaParts = [isCall ? callStatusLabel(item) : statusLabel(item)];
    if (isCall && item.job_title) metaParts.push(item.job_title);
    metaParts.push(formatDate(item.updated_at));
    const menuOpen = openMenuId === item.id;
    const lifecycleDisabled = ["queued", "running"].includes(item.status);
    return (
      <div className={`history-row${active ? " active" : ""}`} key={item.id}>
        <button
          type="button"
          className="history-item"
          aria-current={active ? "page" : undefined}
          onClick={() => {
            handleClose();
            if (isCall) onOpenCall(item.id);
            else onOpenJob(item.id);
          }}
        >
          <strong>{title}</strong>
          <span>{metaParts.filter(Boolean).join(" · ")}</span>
        </button>
        <button
          type="button"
          className="history-more"
          title={t("moreActions")}
          aria-label={t("moreActions")}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={`historyMenu-${isCall ? "call" : "job"}-${item.id}`}
          disabled={loading}
          onClick={(event) => {
            event.stopPropagation();
            setOpenMenuId(menuOpen ? null : item.id);
          }}
        >
          <Svg paths={ICON_MORE} />
        </button>
        <div
          className="history-menu"
          id={`historyMenu-${isCall ? "call" : "job"}-${item.id}`}
          role="menu"
          hidden={!menuOpen}
        >
          <button
            type="button"
            role="menuitem"
            disabled={lifecycleDisabled}
            onClick={() => changeArchiveState(item, archived ? "restore" : "archive")}
          >
            <Svg paths={archived ? ICON_RESTORE : ICON_ARCHIVE} />
            {t(archived ? "restoreJob" : "archiveJob")}
          </button>
          <button
            type="button"
            role="menuitem"
            className="danger"
            disabled={lifecycleDisabled}
            onClick={() => {
              setOpenMenuId(null);
              setPendingDelete({ kind, item });
            }}
          >
            <Svg paths={ICON_DELETE} />
            {t("deleteJob")}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div
      className={drawerAnim.visible ? "preview-backdrop is-visible" : "preview-backdrop"}
      onClick={(event) => {
        if (event.target === event.currentTarget) handleClose();
      }}
    >
      <section className={drawerAnim.visible ? "history-dialog is-visible" : "history-dialog"} role="dialog" aria-modal="true" aria-label={t(isCall ? "phoneRecord" : "taskHistory")}>
        <div className="history-panel">
          <header className="history-header">
            <h2>{t(isCall ? "phoneRecord" : "taskHistory")}</h2>
            <div className="history-header-actions">
              <Button variant="icon" aria-label={t("closeHistory")} title={t("close")} onClick={handleClose}>
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </Button>
            </div>
          </header>
          <div className="history-tabs" role="tablist" aria-label={t("historyCategories")}>
            <button
              type="button"
              role="tab"
              aria-selected={scope === "recent"}
              aria-controls="historyPanel"
              onClick={() => switchScope("recent")}
            >
              <span>{t("recentTab")}</span>
              <strong>{totals.recent}</strong>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={scope === "archived"}
              aria-controls="historyPanel"
              onClick={() => switchScope("archived")}
            >
              <span>{t("archivedTab")}</span>
              <strong>{totals.archived}</strong>
            </button>
          </div>
          <nav className="job-history" id="historyPanel" aria-label={t(archived ? "archivedTab" : "recentTasks")}>
            {items.length === 0 ? (
              loading ? (
                <EmptyState>{t(isCall ? "callHistoryLoading" : "historyLoading")}</EmptyState>
              ) : (
                <EmptyState icon={<Svg paths={ICON_EMPTY} />}>
                  {t(
                    isCall
                      ? archived
                        ? "callHistoryEmptyArchived"
                        : "callHistoryEmptyRecent"
                      : archived
                        ? "historyEmptyArchived"
                        : "historyEmptyRecent"
                  )}
                </EmptyState>
              )
            ) : (
              items.map(renderRow)
            )}
          </nav>
          {loadMoreVisible && (
            <button type="button" className="history-load-more" onClick={() => void loadMore()}>
              {t("loadMore")}
            </button>
          )}
          {!isCall && (
            <div className="history-storage" data-testid="history-storage">
              {storage === null
                ? t("storageLoading")
                : storage.job_count
                  ? t("storageUsage", { size: formatStorageSize(storage.jobs_bytes ?? 0) })
                  : t("storageEmpty")}
            </div>
          )}
        </div>
      </section>
      {confirmAnim.mounted && (
        <div
          className={confirmAnim.visible ? "preview-backdrop is-visible" : "preview-backdrop"}
          onClick={(event) => {
            if (event.target === event.currentTarget && !deleting) setPendingDelete(null);
          }}
        >
          <div className={confirmAnim.visible ? "confirm-dialog is-visible" : "confirm-dialog"} role="dialog" aria-modal="true" aria-label={t(deleteTitleKey)}>
            <form>
              <div className="confirm-icon" aria-hidden="true">
                <Svg paths={ICON_DELETE} />
              </div>
              <h2>{t(deleteTitleKey)}</h2>
              <p className="confirm-lead">{t(deleteLeadKey, { name: deleteName })}</p>
              <p className="confirm-detail">{t(deleteDetailKey)}</p>
              <div className="confirm-actions">
                <Button variant="secondary" disabled={deleting} onClick={() => setPendingDelete(null)}>
                  {t("cancel")}
                </Button>
                <Button variant="danger" busy={deleting} onClick={() => void confirmDelete()}>
                  {deleting ? t("deleting") : t("deletePermanently")}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
      {toast && createPortal(<Toast>{toast}</Toast>, document.body)}
    </div>
  );
}
