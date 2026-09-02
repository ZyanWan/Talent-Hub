// =====================================================================
// 产物预览弹窗（React）：查看类弹窗。
// - 查看类弹窗：关闭按钮 + ESC + 点遮罩关闭（无未保存输入，误触成本低）
// - 两种预览：criteria（markdown 安全渲染，仅 h1-h3/ul/p，文本节点防注入）
//   / workbook（sheet tabs + 表格，键盘左右/Home/End 切换，空表提示）
// - 数据走 GET /api/jobs/{id}/preview/{kind}（api() 契约不变）
// - 打开时中止上一次未完成请求（AbortController）
// - 预览数据与请求句柄为组件本地状态；受控 props 由调用方传入，
//   不写入全局 state，预览弹窗实例彼此独立
// =====================================================================

import { createElement, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { api } from "../api/client";
import { getLanguage, onChange, t } from "../i18n";
import { Button } from "./Button";
import { useDialogAnimation } from "./useDialogAnimation";

export type PreviewKind = "criteria" | "workbook";

export interface PreviewSheet {
  name: string;
  rows: unknown[][];
}

export type PreviewPayload =
  | { kind: "markdown"; content?: string; truncated?: boolean }
  | { kind: "workbook"; sheets?: PreviewSheet[]; truncated?: boolean };

export interface PreviewDialogProps {
  open: boolean;
  jobId: string;
  kind: PreviewKind;
  onClose: () => void;
}

type PreviewStatus =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "done" };

/** markdown 安全渲染：仅 h1-h3 / ul / p；内容一律以文本节点输出，杜绝 HTML 注入 */
function parseMarkdown(content: string, emptyText: string): ReactNode[] {
  const lines = String(content ?? "")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n");
  const nodes: ReactNode[] = [];
  let list: string[] | null = null;
  let key = 0;
  const flushList = () => {
    if (!list) return;
    nodes.push(
      <ul key={key++}>
        {list.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    );
    list = null;
  };
  for (const sourceLine of lines) {
    const line = sourceLine.trim();
    if (!line) {
      flushList();
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushList();
      nodes.push(createElement(`h${heading[1].length}`, { key: key++ }, heading[2]));
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      list ??= [];
      list.push(bullet[1]);
      continue;
    }
    flushList();
    nodes.push(<p key={key++}>{line}</p>);
  }
  flushList();
  if (!nodes.length) nodes.push(<p key={key++}>{emptyText}</p>);
  return nodes;
}

export function PreviewDialog({ open, jobId, kind, onClose }: PreviewDialogProps) {
  const [status, setStatus] = useState<PreviewStatus>({ phase: "loading" });
  const [payload, setPayload] = useState<PreviewPayload | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const [, forceRender] = useState(0);

  // 语言切换时重渲染标题与按钮文案
  useEffect(() => {
    let active = true;
    onChange(() => {
      if (active) forceRender((n) => n + 1);
    });
    return () => {
      active = false;
    };
  }, []);

  // 打开时加载预览：中止上一次未完成请求，卸载/重开时中止当前请求
  useEffect(() => {
    if (!open) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setStatus({ phase: "loading" });
    setPayload(null);
    setSheetIndex(0);
    (async () => {
      try {
        const data = await api<PreviewPayload>(`/api/jobs/${jobId}/preview/${kind}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setPayload(data);
        setStatus({ phase: "done" });
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setStatus({ phase: "error", message: (error as Error).message });
        }
      }
    })();
    return () => controller.abort();
  }, [open, jobId, kind]);

  // ESC 关闭（查看类弹窗支持，编辑类由调用方决定是否复用）
  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // 开合动画：挂载后置 .is-visible 播放过渡，关闭时播完离场动画再卸载
  const { mounted, visible } = useDialogAnimation(open, 300);

  if (!mounted) return null;

  const criteria = kind === "criteria";
  const title = t(criteria ? "criteriaPreviewTitle" : "workbookPreviewTitle");
  const downloadLabel = t(downloading ? "downloading" : criteria ? "downloadCriteria" : "downloadWorkbook");
  const truncated = Boolean(payload?.truncated);
  const sheets = payload?.kind === "workbook" ? payload.sheets ?? [] : [];
  const activeIndex = sheets.length ? Math.min(sheetIndex, sheets.length - 1) : 0;
  const sheet = sheets[activeIndex];

  const handleDownload = async () => {
    if (!payload) return;
    setDownloading(true);
    try {
      const response = await api<Response>(`/api/jobs/${jobId}/${criteria ? "criteria" : "download"}`);
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") || "";
      let name = t(criteria ? "criteriaFilename" : "resultFilename");
      const utf8 = disposition.match(/filename\*=utf-8''([^;]+)/i);
      if (utf8 && getLanguage() === "zh-CN") name = decodeURIComponent(utf8[1]);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setToast((error as Error).message);
      setTimeout(() => setToast(null), 3500);
    } finally {
      setDownloading(false);
    }
  };

  const onTablistKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabs = Array.from(event.currentTarget.querySelectorAll('[role="tab"]'));
    if (!tabs.length) return;
    event.preventDefault();
    const current = tabs.indexOf(document.activeElement as HTMLElement);
    let next = current;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else if (event.key === "ArrowRight") next = (Math.max(0, current) + 1) % tabs.length;
    else next = (current <= 0 ? tabs.length : current) - 1;
    (tabs[next] as HTMLElement).focus();
    setSheetIndex(next);
  };

  return (
    // 遮罩层：点击自身区域关闭（查看类弹窗约定）
    <div
      className={visible ? "preview-backdrop is-visible" : "preview-backdrop"}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className={visible ? "preview-dialog is-visible" : "preview-dialog"} role="dialog" aria-modal="true" aria-label={title}>
        <section className="preview-shell">
          <header className="preview-header">
            <h2>{title}</h2>
            <Button variant="icon" aria-label={t("closePreview")} title={t("close")} onClick={onClose}>
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </Button>
          </header>
          <div className="preview-body">
            {status.phase !== "done" && (
              <div
                className={status.phase === "error" ? "preview-status error" : "preview-status"}
                role="status"
                aria-live="polite"
              >
                {status.phase === "error" ? status.message : t("previewLoading")}
              </div>
            )}
            {status.phase === "done" && payload?.kind === "markdown" &&
              (payload.content?.trim() ? (
                <article className="markdown-preview">{parseMarkdown(payload.content, t("emptyPreview"))}</article>
              ) : (
                <p className="preview-empty">{t("emptyPreview")}</p>
              ))}
            {status.phase === "done" && payload?.kind === "workbook" && (
              <section className="workbook-preview">
                <div className="sheet-tabs" role="tablist" aria-label={t("worksheetTabs")} onKeyDown={onTablistKeyDown}>
                  {sheets.map((s, index) => (
                    <button
                      key={index}
                      type="button"
                      role="tab"
                      id={`previewSheetTab${index}`}
                      aria-selected={index === activeIndex}
                      aria-controls="previewTablePanel"
                      tabIndex={index === activeIndex ? 0 : -1}
                      onClick={() => setSheetIndex(index)}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
                <div
                  className="preview-table-wrap"
                  id="previewTablePanel"
                  role="tabpanel"
                  aria-labelledby={sheets[activeIndex] ? `previewSheetTab${activeIndex}` : undefined}
                >
                  {sheet?.rows.length ? (
                    <table className="preview-table">
                      <thead>
                        <tr>
                          {sheet.rows[0].map((value, index) => (
                            <th key={index} scope="col">
                              {String(value ?? "")}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sheet.rows.slice(1).map((row, rowIndex) => (
                          <tr key={rowIndex}>
                            {row.map((value, cellIndex) => (
                              <td key={cellIndex}>{String(value ?? "")}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="preview-empty">{t("emptyWorksheet")}</p>
                  )}
                </div>
              </section>
            )}
          </div>
          <footer className="preview-actions">
            <p className="preview-notice" hidden={!truncated}>
              {t("previewTruncated")}
            </p>
            <Button variant="primary" disabled={!payload} busy={downloading} onClick={handleDownload}>
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
              </svg>
              <span>{downloadLabel}</span>
            </Button>
          </footer>
        </section>
      </section>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
