"use strict";

import { state } from "../core/state.js";
import { t, onChange } from "../core/i18n.js";
import { api } from "../core/api.js";
import { $ } from "../core/dom.js";
import { createSvgIcon, fileSuffix, formatSize } from "../core/utils.js";
import { renderSelectedMaterials } from "../views/screening.js";

const PREVIEWABLE_IMAGE_SUFFIXES = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp"]);
let resumeCloseTimer = null;
let resumeAnimationGeneration = 0;

function releaseResumePreviewUrl() {
  state.resumeRenderController?.abort();
  state.resumeRenderController = null;
  state.resumePrefetchController?.abort();
  state.resumePrefetchController = null;
  $("resumePdfPreview").replaceChildren();
  $("resumeImagePreview").removeAttribute("src");
  if (state.resumePreviewUrl) URL.revokeObjectURL(state.resumePreviewUrl);
  state.resumePreviewUrl = null;
}

async function renderPdfToImages(file, options = {}) {
  const key = `${file.name}:${file.size}:${file.lastModified}`;
  const cached = state.resumeRenderCache.get(key);
  if (cached) return cached;
  const controller = options.controller || new AbortController();
  if (!options.controller) state.resumeRenderController = controller;
  const form = new FormData();
  form.append("file", file);
  const scale = Math.min(4, 3 * (window.devicePixelRatio || 1));
  const payload = await api(`/api/resumes/preview?scale=${scale}`, { method: "POST", body: form, signal: controller.signal });
  state.resumeRenderCache.set(key, payload.pages);
  return payload.pages;
}

async function prefetchResumePreviews() {
  state.resumePrefetchController?.abort();
  const controller = new AbortController();
  state.resumePrefetchController = controller;
  const current = state.selectedResumes[state.resumePreviewIndex];
  for (const file of state.selectedResumes) {
    if (controller.signal.aborted) return;
    if (file === current || fileSuffix(file) !== ".pdf") continue;
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (state.resumeRenderCache.has(key)) continue;
    try {
      await renderPdfToImages(file, { controller });
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }
}

async function renderResumePreview() {
  releaseResumePreviewUrl();
  const file = state.selectedResumes[state.resumePreviewIndex];
  const pdfHost = $("resumePdfPreview");
  const image = $("resumeImagePreview");
  const unavailable = $("resumePreviewUnavailable");
  pdfHost.hidden = true;
  image.hidden = true;
  unavailable.hidden = true;
  if (!file) return;

  const suffix = fileSuffix(file);
  $("resumePreviewPosition").textContent = t("previewPosition", {
    current: state.resumePreviewIndex + 1,
    total: state.selectedResumes.length,
  });
  $("previousResumeButton").disabled = state.resumePreviewIndex === 0;
  $("nextResumeButton").disabled = state.resumePreviewIndex >= state.selectedResumes.length - 1;

  if (suffix === ".pdf") {
    pdfHost.hidden = false;
    const loading = document.createElement("div");
    loading.className = "resume-preview-status";
    loading.textContent = t("previewLoading");
    pdfHost.append(loading);
    try {
      const pages = await renderPdfToImages(file);
      if (state.selectedResumes[state.resumePreviewIndex] !== file) return;
      pdfHost.replaceChildren();
      for (const page of pages) {
        const pageImage = document.createElement("img");
        pageImage.src = page.data;
        pageImage.alt = `${file.name} - ${page.index}`;
        pdfHost.append(pageImage);
      }
    } catch (error) {
      if (error.name === "AbortError") return;
      pdfHost.hidden = true;
      unavailable.querySelector("span").textContent = error.message || t("previewUnavailableDetail");
      unavailable.hidden = false;
    }
  } else if (PREVIEWABLE_IMAGE_SUFFIXES.has(suffix)) {
    state.resumePreviewUrl = URL.createObjectURL(file);
    image.src = state.resumePreviewUrl;
    image.alt = file.name;
    image.hidden = false;
  } else {
    unavailable.hidden = false;
  }
}

async function renderStoredResumePreview() {
  releaseResumePreviewUrl();
  const preview = state.storedResumePreview;
  const pdfHost = $("resumePdfPreview");
  const image = $("resumeImagePreview");
  const unavailable = $("resumePreviewUnavailable");
  pdfHost.hidden = true;
  image.hidden = true;
  unavailable.hidden = true;
  if (!preview) return;

  const suffix = fileSuffix({ name: preview.filename });
  const controller = new AbortController();
  state.resumeRenderController = controller;
  try {
    if (suffix === ".pdf") {
      pdfHost.hidden = false;
      const loading = document.createElement("div");
      loading.className = "resume-preview-status";
      loading.textContent = t("previewLoading");
      pdfHost.append(loading);
      const scale = Math.min(4, 3 * (window.devicePixelRatio || 1));
      const payload = await api(
        `/api/jobs/${preview.jobId}/resumes/${encodeURIComponent(preview.filename)}/preview?scale=${scale}`,
        { signal: controller.signal },
      );
      if (state.storedResumePreview !== preview) return;
      pdfHost.replaceChildren();
      for (const page of payload.pages) {
        const pageImage = document.createElement("img");
        pageImage.src = page.data;
        pageImage.alt = `${preview.filename} - ${page.index}`;
        pdfHost.append(pageImage);
      }
    } else if (PREVIEWABLE_IMAGE_SUFFIXES.has(suffix)) {
      const response = await api(
        `/api/jobs/${preview.jobId}/resumes/${encodeURIComponent(preview.filename)}`,
        { signal: controller.signal },
      );
      const blob = await response.blob();
      if (state.storedResumePreview !== preview) return;
      state.resumePreviewUrl = URL.createObjectURL(blob);
      image.src = state.resumePreviewUrl;
      image.alt = preview.filename;
      image.hidden = false;
    } else {
      unavailable.hidden = false;
    }
  } catch (error) {
    if (error.name === "AbortError") return;
    pdfHost.hidden = true;
    unavailable.querySelector("span").textContent = error.message || t("previewUnavailableDetail");
    unavailable.hidden = false;
  }
}

function renderStoredResumeWorkspace() {
  const preview = state.storedResumePreview;
  if (!preview) return;
  $("resumeDialog").classList.add("stored-preview-mode");
  $("resumeWorkspaceTitle").textContent = preview.candidateName;
  $("resumeWorkspaceCount").textContent = preview.filename;
  $("resumeViewerNavigation").hidden = true;
  $("resumeWorkspaceAddButton").hidden = true;
  const list = $("resumeDialogFileList");
  list.replaceChildren();
  const row = document.createElement("div");
  row.className = "resume-library-row active";
  const file = document.createElement("div");
  file.className = "resume-file-open stored-resume-file";
  const copy = document.createElement("span");
  copy.className = "resume-file-copy";
  const name = document.createElement("strong");
  name.textContent = preview.filename;
  copy.append(name);
  file.append(
    createSvgIcon(["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z", "M14 2v6h6"]),
    copy,
  );
  row.append(file);
  list.append(row);
  renderStoredResumePreview();
}

export function openStoredResumePreview(jobId, item) {
  if (!jobId || !item.source_file) return;
  state.storedResumePreview = {
    jobId,
    filename: item.source_file,
    candidateName: item.candidate_name || item.source_file,
  };
  renderStoredResumeWorkspace();
  openResumeDialog();
}

function selectResumePreview(index) {
  if (index < 0 || index >= state.selectedResumes.length) return;
  state.resumePreviewIndex = index;
  renderResumeWorkspace();
}

function removeResumeAt(index) {
  if (index < 0 || index >= state.selectedResumes.length) return;
  state.selectedResumes.splice(index, 1);
  $("resumeFiles").value = "";
  if (index < state.resumePreviewIndex) state.resumePreviewIndex -= 1;
  if (state.resumePreviewIndex >= state.selectedResumes.length) {
    state.resumePreviewIndex = Math.max(0, state.selectedResumes.length - 1);
  }
  renderSelectedMaterials();
  if (!state.selectedResumes.length) closeResumeWorkspace();
  else renderResumeWorkspace();
}

function renderResumeWorkspace() {
  $("resumeDialog").classList.remove("stored-preview-mode");
  $("resumeWorkspaceTitle").textContent = t("resumeWorkspaceTitle");
  $("resumeViewerNavigation").hidden = false;
  $("resumeWorkspaceAddButton").hidden = false;
  const list = $("resumeDialogFileList");
  list.replaceChildren();
  const countKey = state.language === "en" && state.selectedResumes.length === 1
    ? "resumeWorkspaceCountOne"
    : "resumeWorkspaceCount";
  $("resumeWorkspaceCount").textContent = t(countKey, { count: state.selectedResumes.length });
  state.selectedResumes.forEach((file, index) => {
    const row = document.createElement("div");
    row.className = "resume-library-row";
    row.classList.toggle("active", index === state.resumePreviewIndex);

    const open = document.createElement("button");
    open.type = "button";
    open.className = "resume-file-open";
    open.title = t("previewNamed", { name: file.name });
    open.setAttribute("aria-label", t("previewNamed", { name: file.name }));
    open.addEventListener("click", () => selectResumePreview(index));
    const copy = document.createElement("span");
    copy.className = "resume-file-copy";
    const name = document.createElement("strong");
    name.textContent = file.name;
    const meta = document.createElement("span");
    meta.textContent = formatSize(file.size);
    copy.append(name, meta);
    open.append(
      createSvgIcon(["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z", "M14 2v6h6"]),
      copy,
    );

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "resume-file-delete";
    remove.title = t("removeNamed", { name: file.name });
    remove.setAttribute("aria-label", t("removeNamed", { name: file.name }));
    remove.append(createSvgIcon(["M3 6h18", "M8 6V4h8v2", "M19 6l-1 15H6L5 6", "M10 11v6M14 11v6"]));
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      removeResumeAt(index);
    });
    row.append(open, remove);
    list.append(row);
  });
  renderResumePreview();
  prefetchResumePreviews();
}

function openResumeDialog() {
  const dialog = $("resumeDialog");
  if (dialog.open) return;
  clearTimeout(resumeCloseTimer);
  const generation = ++resumeAnimationGeneration;
  dialog.showModal();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (dialog.open && generation === resumeAnimationGeneration) dialog.classList.add("is-visible");
  }));
}

function openResumeWorkspace() {
  if (!state.selectedResumes.length) return;
  state.storedResumePreview = null;
  state.resumePreviewIndex = Math.min(state.resumePreviewIndex, state.selectedResumes.length - 1);
  renderResumeWorkspace();
  openResumeDialog();
}

export function closeResumeWorkspace() {
  const dialog = $("resumeDialog");
  const generation = ++resumeAnimationGeneration;
  if (!dialog.open || !dialog.classList.contains("is-visible")) {
    releaseResumePreviewUrl();
    state.storedResumePreview = null;
    if (dialog.open) dialog.close();
    return;
  }
  dialog.classList.remove("is-visible");
  const finish = () => {
    if (generation !== resumeAnimationGeneration) return;
    clearTimeout(resumeCloseTimer);
    dialog.removeEventListener("transitionend", onTransitionEnd);
    releaseResumePreviewUrl();
    state.storedResumePreview = null;
    if (dialog.open) dialog.close();
  };
  const onTransitionEnd = (event) => {
    if (event.target === dialog && event.propertyName === "transform") finish();
  };
  dialog.addEventListener("transitionend", onTransitionEnd);
  resumeCloseTimer = setTimeout(finish, 320);
}

function setResumeFiles(fileList) {
  const known = new Set(state.selectedResumes.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
  for (const file of fileList) {
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (!known.has(key)) { state.selectedResumes.push(file); known.add(key); }
  }
  renderSelectedMaterials();
  if ($("resumeDialog").open) renderResumeWorkspace();
}

export function init() {
  onChange(() => {
    if ($("resumeDialog").open) {
      if (state.storedResumePreview) renderStoredResumeWorkspace();
      else renderResumeWorkspace();
    }
  });
  $("openResumeWorkspaceButton").addEventListener("click", openResumeWorkspace);
  $("closeResumeButton").addEventListener("click", closeResumeWorkspace);
  $("resumeDialog").addEventListener("cancel", (event) => { event.preventDefault(); closeResumeWorkspace(); });
  $("previousResumeButton").addEventListener("click", () => selectResumePreview(state.resumePreviewIndex - 1));
  $("nextResumeButton").addEventListener("click", () => selectResumePreview(state.resumePreviewIndex + 1));
  $("resumeFiles").addEventListener("change", (event) => {
    setResumeFiles(event.target.files);
    event.target.value = "";
  });
  const dropZone = $("resumeDropZone");
  for (const eventName of ["dragenter", "dragover"]) {
    dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.add("dragging"); });
  }
  for (const eventName of ["dragleave", "drop"]) {
    dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.remove("dragging"); });
  }
  dropZone.addEventListener("drop", (event) => setResumeFiles(event.dataTransfer.files));
  window.addEventListener("beforeunload", releaseResumePreviewUrl);
}
