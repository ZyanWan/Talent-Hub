// =====================================================================
// AI 横向对比弹窗（React）：查看类弹窗。
// - 查看类弹窗：关闭按钮 + ESC + 点遮罩关闭；对比进行中关闭 = 触发取消
// - 候选人选择在结果页完成（仅 A/B 结论可参与，C 类排除，至少 2 人才能发起）；
//   弹窗打开即用传入 candidates 自动发起对比（点击即运行），
//   不再提供弹窗内二次勾选
// - 请求 POST /api/jobs/{job_id}/compare?cancel_key=<uuid>，body {files: [...]}
//   （服务端再排序去重）；cancel_key 由前端生成，完成/失败/取消后置空
// - 取消 POST /api/jobs/{id}/compare/cancel（body {cancel_key}），失败可忽略；
//   后端取消对比请求返回 499，前端捕获后展示 compareFail 文案
// - 缓存命中：后端按结果哈希缓存直接返回 ranking，前端直出结果
// - 结果展示 ranking 列表 [{candidate, rank, reason}]，按结论徽章着色
// - 语言切换经 i18n onChange 重渲染（结论徽章 / meta 文案随语言变化）
// =====================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client";
import { onChange, t } from "../i18n";
import { Button } from "./Button";
import { Tag, type ConclusionGrade } from "./Tag";
import { Toast } from "./Toast";
import { useDialogAnimation } from "./useDialogAnimation";

export interface CompareCandidate {
  source_file: string;
  candidate_name?: string;
  conclusion?: string;
}

export interface CompareRankingItem {
  candidate: string;
  rank: number;
  reason: string;
}

export interface CompareDialogProps {
  open: boolean;
  jobId: string;
  /** 结果列表（结果页的数据行），用于勾选与结论徽章查询 */
  candidates: CompareCandidate[];
  onClose: () => void;
}

/** 结论 → 徽章等级/文案（A→a、B→b、其余→c） */
function conclusionMeta(conclusion: string): { grade: ConclusionGrade; label: string } {
  if (conclusion.startsWith("A")) return { grade: "a", label: t("conclusionA") };
  if (conclusion.startsWith("B")) return { grade: "b", label: t("conclusionB") };
  return { grade: "c", label: t("conclusionC") };
}

/** 解析排名项 candidate 字符串 `名字（文件）` → {name, file}；无括号时 file 为空 */
function parseCandidate(candidate: string): { name: string; file: string } {
  const match = candidate.match(/^(.*)（(.*)）$/);
  return match ? { name: match[1], file: match[2] } : { name: candidate, file: "" };
}

export function CompareDialog({ open, jobId, candidates, onClose }: CompareDialogProps) {
  const [running, setRunning] = useState(false);
  const [ranking, setRanking] = useState<CompareRankingItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // 进行中对比的 cancel_key：完成/失败/取消后置空
  const cancelKeyRef = useRef<string | null>(null);
  const [, forceRender] = useState(0);

  // 语言切换时重渲染
  useEffect(() => {
    let active = true;
    onChange(() => {
      if (active) forceRender((n) => n + 1);
    });
    return () => {
      active = false;
    };
  }, []);

  /** 发起对比：body {files}（直接使用结果页已勾选候选人） */
  const launchCompare = useCallback(
    async (files: string[]) => {
      const key = crypto.randomUUID();
      cancelKeyRef.current = key;
      setRunning(true);
      setRanking(null);
      setError(null);
      try {
        const payload = await api<{ ranking?: CompareRankingItem[] }>(
          `/api/jobs/${jobId}/compare?cancel_key=${encodeURIComponent(key)}`,
          { method: "POST", body: JSON.stringify({ files }) }
        );
        // 已取消（key 被置空）：丢弃晚到的结果
        if (cancelKeyRef.current !== key) return;
        setRanking(payload.ranking || []);
      } catch (caught) {
        // 用户已取消：静默忽略
        if (cancelKeyRef.current === null) return;
        setError((caught as Error).message);
      } finally {
        if (cancelKeyRef.current === key) cancelKeyRef.current = null;
        setRunning(false);
      }
    },
    [jobId]
  );

  // 打开时清空上一次对比的结果/错误；候选人 ≥2 时自动发起
  useEffect(() => {
    if (!open) return;
    setRunning(false);
    setRanking(null);
    setError(null);
    const files = candidates.map((item) => item.source_file);
    if (files.length >= 2) void launchCompare(files);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const cancelCompare = useCallback(async () => {
    const key = cancelKeyRef.current;
    if (!key) return;
    // 先置空再发取消请求：避免后台对比请求晚到后覆盖界面状态
    cancelKeyRef.current = null;
    try {
      await api(`/api/jobs/${jobId}/compare/cancel`, {
        method: "POST",
        body: JSON.stringify({ cancel_key: key }),
      });
    } catch {
      // 对比可能已完成，取消请求失败可忽略
    }
    onClose();
    setToast(t("compareCancelled"));
    setTimeout(() => setToast(null), 3500);
  }, [jobId, onClose]);

  const handleClose = useCallback(() => {
    // 对比进行中关闭对话框 = 触发取消
    if (cancelKeyRef.current) {
      void cancelCompare();
      return;
    }
    onClose();
  }, [cancelCompare, onClose]);

  // ESC 关闭（查看类弹窗；进行中由 handleClose 走取消链路）
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, handleClose]);

  // 开合动画：挂载后置 .is-visible 播放过渡，关闭时播完离场动画再卸载
  const { mounted, visible } = useDialogAnimation(open, 300);

  if (!mounted) return null;

  const meta = ranking !== null ? t("compareMetaCount", { count: ranking.length }) : "";

  return (
    // 遮罩层：点击自身区域关闭（查看类弹窗约定）
    <div
      className={visible ? "preview-backdrop is-visible" : "preview-backdrop"}
      onClick={(event) => {
        if (event.target === event.currentTarget) handleClose();
      }}
    >
      <section className={visible ? "compare-dialog is-visible" : "compare-dialog"} role="dialog" aria-modal="true" aria-label={t("compareTitle")}>
        <section className="compare-shell">
          <header className="compare-header">
            <div>
              <h2>{t("compareTitle")}</h2>
              <p className="compare-meta">{meta}</p>
            </div>
            <Button variant="icon" aria-label={t("closePreview")} title={t("close")} onClick={handleClose}>
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </Button>
          </header>
          <div className="compare-body">
            {running ? (
              <div className="preview-status" role="status" aria-live="polite">
                <span className="compare-spinner" aria-hidden="true" />
                <span className="compare-status-text">{t("compareLoading")}</span>
                <Button variant="secondary" onClick={cancelCompare}>
                  {t("compareCancel")}
                </Button>
              </div>
            ) : error ? (
              <p className="preview-empty">{t("compareFail", { message: error })}</p>
            ) : ranking !== null ? (
              ranking.length ? (
                <ol className="compare-list">
                  {ranking.map((item) => {
                    const { name, file } = parseCandidate(item.candidate);
                    const conclusion = candidates.find((c) => c.source_file === file)?.conclusion ?? "";
                    const badge = conclusion ? conclusionMeta(conclusion) : null;
                    return (
                      <li className="compare-row" key={item.rank}>
                        <span className="compare-rank" title={item.rank === 1 ? t("compareFirst") : undefined}>
                          {String(item.rank).padStart(2, "0")}
                        </span>
                        <div className="compare-detail">
                          <div className="compare-head">
                            <strong className="compare-name">{name}</strong>
                            {badge && <Tag grade={badge.grade}>{badge.label}</Tag>}
                          </div>
                          <p className="compare-reason">{item.reason}</p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="preview-empty">{t("noFilteredResults")}</p>
              )
            ) : (
              // 候选人不足 2 人时的兜底（正常流程不可达：结果页按钮已按勾选数禁用）
              <p className="preview-empty">{t("noFilteredResults")}</p>
            )}
          </div>
        </section>
      </section>
      {toast && createPortal(<Toast>{toast}</Toast>, document.body)}
    </div>
  );
}
