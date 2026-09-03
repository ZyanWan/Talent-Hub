// =====================================================================
// 简历工作台弹窗（React）：编辑类弹窗。
// - 编辑类弹窗：仅「关闭按钮 + ESC」退出，点遮罩不关闭
// - 本地模式：文件列表读全局 state.selectedResumes（新增按 name:size:lastModified
//   去重，支持移除与索引调整），添加按钮经隐藏文件输入追加
// - stored 模式：由 props.stored（{jobId, filename, candidateName}）进入，
//   单文件预览，隐藏导航与添加按钮
// - 本地 PDF 预览：POST /api/resumes/preview?scale=（multipart 字段 file），
//   页面按 name:size:lastModified 缓存到 state.resumeRenderCache，命中不重复
//   请求；已存 PDF 预览：GET /api/jobs/{id}/resumes/{filename}/preview?scale=，
//   不缓存
// - 图片预览：本地 URL.createObjectURL(file)；已存 GET /api/jobs/{id}/resumes/
//   {filename}（Blob → createObjectURL），切换/关闭时 revokeObjectURL
// - 渲染与预取各持 AbortController：切换/关闭中止请求，预取跳过当前文件
//   与已缓存项；错误（415/413/422/503 等）经 api() detail 透传到不可预览区
// - 订阅 src/i18n 的 onChange，语言切换重渲染
// =====================================================================

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { api } from "../api/client";
import { onChange, t } from "../i18n";
import { state } from "../state";
import { Button } from "../ui/Button";
import { useDialogAnimation } from "../ui/useDialogAnimation";

export interface StoredResumePreview {
  jobId: string;
  filename: string;
  candidateName?: string;
}

export interface ResumePreviewPage {
  index: number;
  data: string;
}

export interface ResumeWorkspaceProps {
  open: boolean;
  /** 历史任务已存简历（results 视图入口）：非空时进入 stored 模式，预览不缓存 */
  stored?: StoredResumePreview | null;
  onClose: () => void;
  /** 本地模式新增/移除文件后通知外层同步（列表、元信息等） */
  onFilesChanged?: () => void;
}

const PREVIEWABLE_IMAGE_SUFFIXES = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp"]);
const RESUME_ACCEPT = ".pdf,.docx,.txt,.md,.markdown,.png,.jpg,.jpeg,.webp,.tif,.tiff,.bmp";

// ---- 辅助 ----

function fileSuffix(name: string): string {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index).toLowerCase() : "";
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function previewScale(): number {
  return Math.min(4, 3 * (window.devicePixelRatio || 1));
}

type PreviewState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "done"; pages: ResumePreviewPage[] }
  | { phase: "image" }
  | { phase: "unavailable" }
  | { phase: "error"; message: string };

export function ResumeWorkspace({ open, stored, onClose, onFilesChanged }: ResumeWorkspaceProps) {
  const [index, setIndex] = useState(0);
  const [preview, setPreview] = useState<PreviewState>({ phase: "idle" });
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [, forceRender] = useState(0);
  const renderControllerRef = useRef<AbortController | null>(null);
  const prefetchControllerRef = useRef<AbortController | null>(null);
  const imageUrlRef = useRef<string | null>(null);

  const files = state.selectedResumes;
  const storedMode = stored != null;
  const storedKey = storedMode ? `${stored.jobId}|${stored.filename}` : null;
  const total = files.length;
  const safeIndex = total ? Math.min(index, total - 1) : 0;
  const currentFile = files[safeIndex];
  const currentName = storedMode ? stored.filename : currentFile?.name ?? "";

  // 语言切换重渲染
  useEffect(() => {
    let active = true;
    onChange(() => {
      if (active) forceRender((n) => n + 1);
    });
    return () => {
      active = false;
    };
  }, []);

  // ESC 关闭（编辑类弹窗：仅关闭按钮 + ESC）
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // 渲染当前预览 + 预取其余未缓存 PDF：中止上一次未完成请求，卸载/关闭时清理
  useEffect(() => {
    if (!open) return;
    renderControllerRef.current?.abort();
    prefetchControllerRef.current?.abort();
    if (imageUrlRef.current) {
      URL.revokeObjectURL(imageUrlRef.current);
      imageUrlRef.current = null;
    }
    setImageUrl(null);
    setPreview({ phase: "idle" });

    let cancelled = false;
    const controller = new AbortController();
    renderControllerRef.current = controller;
    const storedPreview = stored;

    const renderTarget = async (): Promise<"done" | "unavailable"> => {
      if (storedPreview) {
        const suffix = fileSuffix(storedPreview.filename);
        const encoded = encodeURIComponent(storedPreview.filename);
        if (suffix === ".pdf") {
          setPreview({ phase: "loading" });
          const payload = await api<{ page_count: number; pages: ResumePreviewPage[] }>(
            `/api/jobs/${storedPreview.jobId}/resumes/${encoded}/preview?scale=${previewScale()}`,
            { signal: controller.signal },
          );
          if (cancelled) return "done";
          setPreview({ phase: "done", pages: payload.pages });
          return "done";
        }
        if (PREVIEWABLE_IMAGE_SUFFIXES.has(suffix)) {
          const response = await api<Response>(`/api/jobs/${storedPreview.jobId}/resumes/${encoded}`, {
            signal: controller.signal,
          });
          const blob = await response.blob();
          if (cancelled) return "done";
          const url = URL.createObjectURL(blob);
          imageUrlRef.current = url;
          setImageUrl(url);
          setPreview({ phase: "image" });
          return "done";
        }
        return "unavailable";
      }
      const file = state.selectedResumes[safeIndex];
      if (!file) return "unavailable";
      const suffix = fileSuffix(file.name);
      if (suffix === ".pdf") {
        setPreview({ phase: "loading" });
        const key = fileKey(file);
        let pages = state.resumeRenderCache.get(key) as ResumePreviewPage[] | undefined;
        if (!pages) {
          const form = new FormData();
          form.append("file", file);
          const payload = await api<{ page_count: number; pages: ResumePreviewPage[] }>(
            `/api/resumes/preview?scale=${previewScale()}`,
            { method: "POST", body: form, signal: controller.signal },
          );
          pages = payload.pages;
          state.resumeRenderCache.set(key, pages);
        }
        if (cancelled) return "done";
        setPreview({ phase: "done", pages });
        return "done";
      }
      if (PREVIEWABLE_IMAGE_SUFFIXES.has(suffix)) {
        const url = URL.createObjectURL(file);
        imageUrlRef.current = url;
        setImageUrl(url);
        setPreview({ phase: "image" });
        return "done";
      }
      return "unavailable";
    };

    const prefetchFiles = async () => {
      prefetchControllerRef.current?.abort();
      const prefetchController = new AbortController();
      prefetchControllerRef.current = prefetchController;
      const current = state.selectedResumes[safeIndex];
      for (const file of state.selectedResumes) {
        if (prefetchController.signal.aborted) return;
        if (file === current || fileSuffix(file.name) !== ".pdf") continue;
        const key = fileKey(file);
        if (state.resumeRenderCache.has(key)) continue;
        try {
          const form = new FormData();
          form.append("file", file);
          const payload = await api<{ page_count: number; pages: ResumePreviewPage[] }>(
            `/api/resumes/preview?scale=${previewScale()}`,
            { method: "POST", body: form, signal: prefetchController.signal },
          );
          state.resumeRenderCache.set(key, payload.pages);
        } catch (error) {
          if ((error as Error).name === "AbortError") return;
        }
      }
    };

    (async () => {
      try {
        const result = await renderTarget();
        if (result === "unavailable" && !cancelled) setPreview({ phase: "unavailable" });
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setPreview({ phase: "error", message: (error as Error).message });
        }
      }
    })();
    if (!storedPreview) void prefetchFiles();

    return () => {
      cancelled = true;
      controller.abort();
      prefetchControllerRef.current?.abort();
      if (imageUrlRef.current) {
        URL.revokeObjectURL(imageUrlRef.current);
        imageUrlRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, storedKey, safeIndex, files]);

  const selectPreview = (next: number) => {
    if (next < 0 || next >= total) return;
    setIndex(next);
  };

  const removeAt = (removeIndex: number) => {
    if (removeIndex < 0 || removeIndex >= total) return;
    const next = state.selectedResumes.filter((_, i) => i !== removeIndex);
    state.selectedResumes = next;
    if (removeIndex < index) setIndex(index - 1);
    else if (index >= next.length) setIndex(Math.max(0, next.length - 1));
    onFilesChanged?.();
    if (!next.length) onClose();
    else forceRender((n) => n + 1);
  };

  const handleAddChange = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    if (input.files) {
      const known = new Set(state.selectedResumes.map(fileKey));
      const additions: File[] = [];
      for (const file of Array.from(input.files)) {
        const key = fileKey(file);
        if (!known.has(key)) {
          additions.push(file);
          known.add(key);
        }
      }
      if (additions.length) {
        state.selectedResumes = [...state.selectedResumes, ...additions];
        onFilesChanged?.();
        forceRender((n) => n + 1);
      }
    }
    input.value = "";
  };

  // 开合动画：挂载后置 .is-visible 播放过渡，关闭时播完离场动画再卸载
  const { mounted, visible } = useDialogAnimation(open, 300);

  if (!mounted) return null;

  const title = storedMode ? stored.candidateName || stored.filename : t("resumeWorkspaceTitle");
  const countText = storedMode
    ? stored.filename
    : t(state.language === "en" && total === 1 ? "resumeWorkspaceCountOne" : "resumeWorkspaceCount", { count: total });
  const positionText = t("previewPosition", { current: safeIndex + 1, total });

  return (
    // 遮罩层：编辑类弹窗不响应遮罩点击（无 onClick 关闭逻辑）
    <div className={visible ? "preview-backdrop is-visible" : "preview-backdrop"}>
      <section
        className={
          visible
            ? storedMode
              ? "resume-dialog stored-preview-mode is-visible"
              : "resume-dialog is-visible"
            : storedMode
              ? "resume-dialog stored-preview-mode"
              : "resume-dialog"
        }
        role="dialog"
        aria-modal="true"
        aria-label={t("resumeWorkspaceTitle")}
      >
        <div className="resume-workbench">
          <header className="resume-workbench-header">
            <div className="resume-workbench-title">
              <h2>{title}</h2>
              <span>{countText}</span>
            </div>
            <div className="resume-workbench-actions">
              {!storedMode && total > 0 && (
                <div className="resume-viewer-navigation">
                  <Button
                    variant="icon"
                    disabled={safeIndex === 0}
                    title={t("previousResume")}
                    aria-label={t("previousResume")}
                    onClick={() => selectPreview(safeIndex - 1)}
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24">
                      <path d="m15 18-6-6 6-6" />
                    </svg>
                  </Button>
                  <span>{positionText}</span>
                  <Button
                    variant="icon"
                    disabled={safeIndex >= total - 1}
                    title={t("nextResume")}
                    aria-label={t("nextResume")}
                    onClick={() => selectPreview(safeIndex + 1)}
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24">
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </Button>
                </div>
              )}
              {!storedMode && (
                <>
                  <label
                    className="secondary-button"
                    htmlFor="resumeWorkspaceFiles"
                    title={t("addResumes")}
                    aria-label={t("addResumes")}
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                    <span>{t("addResumes")}</span>
                  </label>
                  <input
                    id="resumeWorkspaceFiles"
                    className="visually-hidden"
                    type="file"
                    multiple
                    accept={RESUME_ACCEPT}
                    onChange={handleAddChange}
                  />
                </>
              )}
              <Button
                variant="icon"
                title={t("close")}
                aria-label={t("closeResumeWorkspace")}
                onClick={onClose}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </Button>
            </div>
          </header>
          <div className="resume-workbench-body">
            <aside className="resume-library">
              <div className="resume-library-list">
                {storedMode ? (
                  <div className="resume-library-row active">
                    <div className="resume-file-open stored-resume-file">
                      <svg aria-hidden="true" viewBox="0 0 24 24">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
                        <path d="M14 2v6h6" />
                      </svg>
                      <span className="resume-file-copy">
                        <strong>{stored.filename}</strong>
                      </span>
                    </div>
                  </div>
                ) : (
                  files.map((file, fileIndex) => {
                    const active = fileIndex === safeIndex;
                    return (
                      <div className={active ? "resume-library-row active" : "resume-library-row"} key={fileKey(file)}>
                        <button
                          type="button"
                          className="resume-file-open"
                          title={t("previewNamed", { name: file.name })}
                          aria-label={t("previewNamed", { name: file.name })}
                          onClick={() => selectPreview(fileIndex)}
                        >
                          <svg aria-hidden="true" viewBox="0 0 24 24">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
                            <path d="M14 2v6h6" />
                          </svg>
                          <span className="resume-file-copy">
                            <strong>{file.name}</strong>
                            <span>{formatSize(file.size)}</span>
                          </span>
                        </button>
                        <button
                          type="button"
                          className="resume-file-delete"
                          title={t("removeNamed", { name: file.name })}
                          aria-label={t("removeNamed", { name: file.name })}
                          onClick={() => removeAt(fileIndex)}
                        >
                          <svg aria-hidden="true" viewBox="0 0 24 24">
                            <path d="M3 6h18" />
                            <path d="M8 6V4h8v2" />
                            <path d="M19 6l-1 15H6L5 6" />
                            <path d="M10 11v6M14 11v6" />
                          </svg>
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </aside>
            <section className="resume-viewer" aria-live="polite">
              <div className="resume-viewer-content">
                {preview.phase === "done" && (
                  <div className="resume-pdf-preview">
                    {preview.pages.map((page) => (
                      <img key={page.index} src={page.data} alt={`${currentName} - ${page.index}`} />
                    ))}
                  </div>
                )}
                {preview.phase === "loading" && <div className="resume-preview-status">{t("previewLoading")}</div>}
                {preview.phase === "image" && imageUrl && <img src={imageUrl} alt={currentName} />}
                {(preview.phase === "unavailable" || preview.phase === "error") && (
                  <div className="resume-preview-unavailable">
                    <svg aria-hidden="true" viewBox="0 0 24 24">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
                      <path d="M14 2v6h6M9 15h6" />
                    </svg>
                    <strong>{t(preview.phase === "error" ? "previewFailed" : "previewUnavailable")}</strong>
                    <span>{preview.phase === "error" ? preview.message : t("previewUnavailableDetail")}</span>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </section>
    </div>
  );
}
