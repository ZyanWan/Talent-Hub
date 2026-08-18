"use strict";

import { state } from "../core/state.js";
import { t, onChange } from "../core/i18n.js";
import { api } from "../core/api.js";
import { $ } from "../core/dom.js";
import { setButtonBusy, showToast } from "../core/utils.js";

function updatePreviewLanguage() {
  const criteria = state.previewKind === "criteria";
  $("previewTitle").textContent = t(criteria ? "criteriaPreviewTitle" : "workbookPreviewTitle");
  $("previewDownloadLabel").textContent = t(criteria ? "downloadCriteria" : "downloadWorkbook");
  if (state.previewPayload?.kind === "workbook") renderWorkbookSheet();
}

function setPreviewLoading() {
  const status = $("previewStatus");
  status.textContent = t("previewLoading");
  status.classList.remove("error");
  status.hidden = false;
  $("markdownPreview").hidden = true;
  $("workbookPreview").hidden = true;
  $("previewNotice").hidden = true;
  $("previewDownloadButton").disabled = true;
}

function showPreviewError(message) {
  const status = $("previewStatus");
  status.textContent = message;
  status.classList.add("error");
  status.hidden = false;
  $("markdownPreview").hidden = true;
  $("workbookPreview").hidden = true;
  $("previewNotice").hidden = true;
  $("previewDownloadButton").disabled = true;
}

function renderMarkdownPreview(content) {
  const host = $("markdownPreview");
  host.replaceChildren();
  const fragment = document.createDocumentFragment();
  let list = null;
  for (const sourceLine of String(content || "").replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n")) {
    const line = sourceLine.trim();
    if (!line) { list = null; continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      list = null;
      const element = document.createElement(`h${heading[1].length}`);
      element.textContent = heading[2];
      fragment.append(element);
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      if (!list) { list = document.createElement("ul"); fragment.append(list); }
      const item = document.createElement("li");
      item.textContent = bullet[1];
      list.append(item);
      continue;
    }
    list = null;
    const paragraph = document.createElement("p");
    paragraph.textContent = line;
    fragment.append(paragraph);
  }
  if (!fragment.childNodes.length) {
    const empty = document.createElement("p");
    empty.textContent = t("emptyPreview");
    fragment.append(empty);
  }
  host.append(fragment);
  $("previewStatus").hidden = true;
  $("workbookPreview").hidden = true;
  host.hidden = false;
}

function renderWorkbookSheet() {
  const payload = state.previewPayload;
  if (!payload?.sheets?.length) return;
  const sheet = payload.sheets[state.previewSheetIndex] || payload.sheets[0];
  const table = $("previewTable");
  const empty = $("previewEmpty");
  table.replaceChildren();
  if (!sheet.rows.length) {
    table.hidden = true;
    empty.textContent = t("emptyWorksheet");
    empty.hidden = false;
  } else {
    const [headers, ...dataRows] = sheet.rows;
    const head = document.createElement("thead");
    const headerRow = document.createElement("tr");
    for (const value of headers) {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.textContent = String(value ?? "");
      headerRow.append(cell);
    }
    head.append(headerRow);
    const body = document.createElement("tbody");
    for (const values of dataRows) {
      const row = document.createElement("tr");
      for (const value of values) {
        const cell = document.createElement("td");
        cell.textContent = String(value ?? "");
        row.append(cell);
      }
      body.append(row);
    }
    table.append(head, body);
    table.hidden = false;
    empty.hidden = true;
  }
  const activeTab = $("sheetTabs").querySelector('[aria-selected="true"]');
  $("previewTablePanel").setAttribute("aria-labelledby", activeTab?.id || "");
  const notice = $("previewNotice");
  notice.textContent = t("previewTruncated");
  notice.hidden = !payload.truncated;
}

function renderWorkbookPreview(payload) {
  const tabs = $("sheetTabs");
  tabs.replaceChildren();
  payload.sheets.forEach((sheet, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.id = `previewSheetTab${index}`;
    button.setAttribute("role", "tab");
    button.textContent = sheet.name;
    button.setAttribute("aria-selected", String(index === state.previewSheetIndex));
    button.setAttribute("aria-controls", "previewTablePanel");
    button.tabIndex = index === state.previewSheetIndex ? 0 : -1;
    button.addEventListener("click", () => {
      state.previewSheetIndex = index;
      for (const [tabIndex, tab] of [...tabs.children].entries()) {
        const active = tabIndex === index;
        tab.setAttribute("aria-selected", String(active));
        tab.tabIndex = active ? 0 : -1;
      }
      renderWorkbookSheet();
    });
    tabs.append(button);
  });
  $("previewStatus").hidden = true;
  $("markdownPreview").hidden = true;
  $("workbookPreview").hidden = false;
  renderWorkbookSheet();
}

export async function openArtifactPreview(kind) {
  if (!state.currentJob) return;
  state.previewRequest?.abort();
  const request = new AbortController();
  state.previewRequest = request;
  state.previewKind = kind;
  state.previewPayload = null;
  state.previewSheetIndex = 0;
  updatePreviewLanguage();
  setPreviewLoading();
  const dialog = $("previewDialog");
  if (!dialog.open) {
    dialog.showModal();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (dialog.open) dialog.classList.add("is-visible");
    }));
  }
  try {
    const payload = await api(`/api/jobs/${state.currentJob.id}/preview/${kind}`, { signal: request.signal });
    if (request.signal.aborted || state.previewRequest !== request) return;
    state.previewPayload = payload;
    if (payload.kind === "markdown") renderMarkdownPreview(payload.content);
    else renderWorkbookPreview(payload);
    $("previewNotice").textContent = t("previewTruncated");
    $("previewNotice").hidden = !payload.truncated;
    $("previewDownloadButton").disabled = false;
  } catch (error) {
    if (error.name !== "AbortError") showPreviewError(error.message);
  }
}

function closeArtifactPreview() {
  state.previewRequest?.abort();
  state.previewRequest = null;
  const dialog = $("previewDialog");
  if (!dialog.open || !dialog.classList.contains("is-visible")) {
    if (dialog.open) dialog.close();
    return;
  }
  dialog.classList.remove("is-visible");
  const finish = () => { if (dialog.open) dialog.close(); };
  dialog.addEventListener("transitionend", (event) => {
    if (event.target === dialog && event.propertyName === "transform") finish();
  }, { once: true });
  setTimeout(finish, 320);
}

async function download(kind) {
  if (!state.currentJob) return;
  try {
    const response = await api(`/api/jobs/${state.currentJob.id}/${kind}`);
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") || "";
    let name = kind === "download" ? t("resultFilename") : t("criteriaFilename");
    const utf8 = disposition.match(/filename\*=utf-8''([^;]+)/i);
    if (utf8 && state.language === "zh-CN") name = decodeURIComponent(utf8[1]);
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  } catch (error) { showToast(error.message); }
}

async function downloadPreviewArtifact() {
  if (!state.previewKind) return;
  const button = $("previewDownloadButton");
  setButtonBusy(button, true);
  $("previewDownloadLabel").textContent = t("downloading");
  try {
    await download(state.previewKind === "criteria" ? "criteria" : "download");
  } finally {
    setButtonBusy(button, false);
    updatePreviewLanguage();
  }
}

export function init() {
  onChange(() => {
    if ($("previewDialog").open) updatePreviewLanguage();
  });
  $("closePreviewButton").addEventListener("click", closeArtifactPreview);
  $("previewDialog").addEventListener("cancel", (event) => { event.preventDefault(); closeArtifactPreview(); });
  $("previewDialog").addEventListener("click", (event) => { if (event.target === $("previewDialog")) closeArtifactPreview(); });
  $("previewDownloadButton").addEventListener("click", downloadPreviewArtifact);
  $("sheetTabs").addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabs = [...event.currentTarget.querySelectorAll('[role="tab"]')];
    if (!tabs.length) return;
    event.preventDefault();
    const current = tabs.indexOf(document.activeElement);
    let next = current;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else if (event.key === "ArrowRight") next = (Math.max(0, current) + 1) % tabs.length;
    else next = (current <= 0 ? tabs.length : current) - 1;
    tabs[next].focus();
    tabs[next].click();
  });
}
