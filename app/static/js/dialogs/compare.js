"use strict";

import { state } from "../core/state.js";
import { onChange, t } from "../core/i18n.js";
import { api } from "../core/api.js";
import { $ } from "../core/dom.js";
import { conclusionClass, conclusionLabel, showToast } from "../core/utils.js";

// 最近一次渲染的对比结果，供语言切换时重绘徽章等 t() 文本。
let lastCompareRanking = null;

export function updateCompareButton() {
  const button = $("compareButton");
  if (!button) return;
  const count = state.compareSelection.size;
  button.disabled = count < 2;
  button.querySelector("span").textContent = t("compareButton");
  button.title = count < 2 ? t("compareButtonTitle") : "";
}

async function runCompare() {
  if (state.compareSelection.size < 2 || !state.currentJob) return;
  const dialog = $("compareDialog");
  // 对话框已打开（含关闭动画期间）时忽略本次点击：对已打开的 dialog 调用 showModal 会抛
  // InvalidStateError，且此路径下按钮尚未进入禁用流程，直接返回不会造成按钮卡死。
  if (dialog.open) return;
  const button = $("compareButton");
  button.disabled = true;
  const cancelKey = crypto.randomUUID();
  state.compareCancelKey = cancelKey;
  $("compareError").hidden = true;
  $("compareMeta").textContent = "";
  $("compareList").replaceChildren();
  lastCompareRanking = null;
  $("compareStatusText").textContent = t("compareLoading");
  $("compareStatus").hidden = false;
  $("compareCancelButton").hidden = false;
  dialog.showModal();
  requestAnimationFrame(() => requestAnimationFrame(() => dialog.classList.add("is-visible")));
  try {
    const payload = await api(`/api/jobs/${state.currentJob.id}/compare?cancel_key=${encodeURIComponent(cancelKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: [...state.compareSelection] }),
    });
    renderCompareReport(payload.ranking || []);
  } catch (error) {
    if (state.compareCancelKey === null) return;
    $("compareError").textContent = t("compareFail", { message: error.message });
    $("compareError").hidden = false;
  } finally {
    if (state.compareCancelKey === cancelKey) state.compareCancelKey = null;
    $("compareStatus").hidden = true;
    $("compareCancelButton").hidden = true;
    button.disabled = state.compareSelection.size < 2;
  }
}

async function cancelCompare() {
  if (!state.compareCancelKey || !state.currentJob) return;
  const key = state.compareCancelKey;
  state.compareCancelKey = null;
  try {
    await api(`/api/jobs/${state.currentJob.id}/compare/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cancel_key: key }),
    });
  } catch (_) { /* 请求可能已完成，忽略 */ }
  closeCompareDialog();
  showToast(t("compareCancelled"));
}

function parseCompareCandidate(candidate) {
  const match = candidate.match(/^(.*)（(.*)）$/);
  return match ? { name: match[1], file: match[2] } : { name: candidate, file: "" };
}

function compareConclusionOfFile(file) {
  const result = (state.currentJob?.results || []).find((item) => item.source_file === file);
  return result ? result.conclusion : "";
}

function renderCompareReport(ranking) {
  lastCompareRanking = ranking;
  const list = $("compareList");
  list.replaceChildren();
  $("compareMeta").textContent = t("compareMetaCount", { count: ranking.length });
  if (!ranking.length) {
    const empty = document.createElement("p");
    empty.className = "preview-empty";
    empty.textContent = t("noFilteredResults");
    list.append(empty);
    return;
  }
  for (const item of ranking) {
    const row = document.createElement("li");
    row.className = "compare-row";
    const rank = document.createElement("span");
    rank.className = "compare-rank";
    rank.textContent = String(item.rank).padStart(2, "0");
    rank.title = item.rank === 1 ? t("compareFirst") : "";
    const detail = document.createElement("div");
    detail.className = "compare-detail";
    const { name, file } = parseCompareCandidate(item.candidate);
    const head = document.createElement("div");
    head.className = "compare-head";
    const nameEl = document.createElement("strong");
    nameEl.className = "compare-name";
    nameEl.textContent = name;
    head.append(nameEl);
    const conclusion = compareConclusionOfFile(file);
    if (conclusion) {
      const badge = document.createElement("span");
      badge.className = `conclusion ${conclusionClass(conclusion)}`;
      badge.textContent = conclusionLabel(conclusion);
      head.append(badge);
    }
    const reason = document.createElement("p");
    reason.className = "compare-reason";
    reason.textContent = item.reason;
    detail.append(head, reason);
    row.append(rank, detail);
    list.append(row);
  }
}

function closeCompareDialog() {
  // 对比仍在进行时（compareCancelKey 非空），关闭对话框的同时取消对比，避免后台白跑。
  // 与 ESC（cancel 事件）走 cancelCompare 的行为保持一致。
  if (state.compareCancelKey) {
    cancelCompare();
    return;
  }
  const dialog = $("compareDialog");
  if (!dialog.open || !dialog.classList.contains("is-visible")) {
    if (dialog.open) dialog.close();
    return;
  }
  dialog.classList.remove("is-visible");
  const finish = () => { if (dialog.open) dialog.close(); };
  dialog.addEventListener("transitionend", (event) => {
    if (event.target === dialog && event.propertyName === "transform") finish();
  }, { once: true });
  setTimeout(finish, 360);
}

export function init() {
  // 与 settings/resume/preview 保持一致：语言切换时若对话框开着，重绘动态内容（结论徽章、meta）。
  onChange(() => {
    if ($("compareDialog").open && lastCompareRanking) renderCompareReport(lastCompareRanking);
  });
  $("compareButton").addEventListener("click", runCompare);
  $("compareCancelButton").addEventListener("click", cancelCompare);
  $("closeCompareButton").addEventListener("click", closeCompareDialog);
  $("compareDialog").addEventListener("cancel", (event) => {
    event.preventDefault();
    if (state.compareCancelKey) cancelCompare();
    else closeCompareDialog();
  });
  $("compareDialog").addEventListener("click", (event) => { if (event.target === $("compareDialog")) closeCompareDialog(); });
}
