"use strict";

import { state } from "../core/state.js";
import { t, onChange } from "../core/i18n.js";
import { api } from "../core/api.js";
import { $ } from "../core/dom.js";
import { currentView as routerCurrentView, registerView, show as routerShow, showSection } from "../core/router.js";
import {
  conclusionClass,
  conclusionLabel,
  createSvgIcon,
  displayJobTitle,
  formatDuration,
  formatSize,
  hideStartupLoading,
  jobElapsed,
  renderErrors,
  setButtonBusy,
  showToast,
  stageLabel,
} from "../core/utils.js";
import { openSettings, showSettingsMessage } from "../dialogs/settings.js";
import { openArtifactPreview } from "../dialogs/preview.js";
import { updateCompareButton } from "../dialogs/compare.js";
import { closeResumeWorkspace, openStoredResumePreview } from "../dialogs/resume.js";
import { closeHistoryDialog, renderHistory } from "./history.js";
import { stopCallPolling } from "./phone.js";

let lastProgressPercent = -1;

// 生命周期：离开筛选视图时停止自己的进度轮询。互斥由 router 保证（同一时刻仅一个视图激活），
// 每个视图只清理自己的轮询字段，无需感知其他视图；resetWorkspace/loadJob 里的显式 stopCallPolling 保留为防御性冗余。
registerView("screening", {
  exit: () => {
    clearTimeout(state.pollTimer);
    state.pollTimer = null;
  },
});

export function renderSelectedMaterials() {
  const hasJd = Boolean($("jdText").value.trim());
  const count = state.selectedResumes.length;
  const totalSize = state.selectedResumes.reduce((sum, file) => sum + file.size, 0);
  const selectedMetaKey = state.language === "en" && count === 1 ? "resumeSelectedMetaOne" : "resumeSelectedMeta";
  $("resumeMaterialMeta").textContent = count
    ? t(selectedMetaKey, { count, size: formatSize(totalSize) })
    : t("resumeEmptyMeta");
  const materialAction = $("resumeMaterialAction");
  const workspaceButton = $("openResumeWorkspaceButton");
  materialAction.textContent = count ? t("manageFiles") : "";
  materialAction.hidden = count === 0;
  workspaceButton.disabled = count === 0;
  workspaceButton.title = count ? t("manageFiles") : "";
  workspaceButton.setAttribute("aria-label", count ? t("manageFiles") : t("resumeMaterials"));
  $("resumeDropZone").classList.toggle("has-files", count > 0);
  const ready = hasJd && state.selectedResumes.length > 0;
  $("runHint").textContent = ready ? t("readyToScreen", { count: state.selectedResumes.length }) : t("waitingMaterials");
  $("startButton").disabled = !ready;
}

function resetResultFilter() {
  state.resultFilter = "all";
  for (const button of $("resultFilter").querySelectorAll("button[data-filter]")) {
    button.classList.toggle("active", button.dataset.filter === "all");
  }
}

export function resetWorkspace() {
  clearTimeout(state.pollTimer);
  stopCallPolling();
  routerShow("screening");
  localStorage.setItem("talentHub.activeTool", "screening");
  localStorage.removeItem("talentHub.lastJob");
  localStorage.removeItem("talentHub.lastCall");
  if ($("historyDialog").open) closeHistoryDialog();
  if ($("resumeDialog").open) closeResumeWorkspace();
  document.body.dataset.view = "setup";
  state.currentJob = null;
  state.selectedResumes = [];
  state.resumePreviewIndex = 0;
  resetResultFilter();
  state.liveResultKeys = null;
  $("jdText").value = "";
  $("resumeFiles").value = "";
  showSection("setupView");
  $("viewTitle").textContent = t("jobTitle");
  renderSelectedMaterials();
  renderHistory();
}

function renderLiveResults(results) {
  const host = $("liveResults");
  const latest = results.slice(-8).reverse();
  // key 含语言：语言切换时缓存失效，强制重绘徽章等 t() 文本，否则 unchanged 早退会残留旧语言。
  const keyOf = (item) => `${state.language}|${item.candidate_name}|${item.conclusion}|${item.one_line}`;
  const keys = latest.map(keyOf);
  const prevKeys = state.liveResultKeys;
  const unchanged = prevKeys && prevKeys.length === keys.length && prevKeys.every((key, i) => key === keys[i]);
  if (unchanged) return;
  state.liveResultKeys = keys;
  const prevRows = [...host.children];
  const build = (item, index) => {
    const row = document.createElement("div");
    row.className = "live-row";
    row.style.animationDelay = `${Math.min(index * 45, 315)}ms`;
    const name = document.createElement("strong");
    name.textContent = item.candidate_name;
    const badge = document.createElement("span");
    badge.className = `conclusion ${conclusionClass(item.conclusion)}`;
    badge.textContent = conclusionLabel(item.conclusion);
    const line = document.createElement("span");
    line.textContent = item.one_line;
    row.append(name, badge, line);
    return row;
  };
  const nextRows = latest.map((item, index) => {
    const prev = prevRows[index];
    return prev && prevKeys[index] === keys[index] ? prev : build(item, index);
  });
  host.replaceChildren(...nextRows);
}

export function renderProgress(job) {
  document.body.dataset.view = "progress";
  showSection("progressView");
  $("progressView").classList.toggle("is-idle", !["queued", "running"].includes(job.status));
  $("viewTitle").textContent = displayJobTitle(job.title);
  $("progressStage").textContent = stageLabel(job.stage);
  const percent = job.progress || 0;
  const percentEl = $("progressPercent");
  percentEl.textContent = `${percent}%`;
  $("progressBar").style.width = `${percent}%`;
  if (percent !== lastProgressPercent) {
    lastProgressPercent = percent;
    percentEl.classList.remove("bump");
    void percentEl.offsetWidth;
    percentEl.classList.add("bump");
  }
  $("progressCount").textContent = t("resumeProgress", { done: job.completed || 0, total: job.total || 0 });
  const elapsed = jobElapsed(job);
  const perMinute = elapsed > 0 ? (Number(job.completed || 0) / elapsed * 60) : 0;
  $("progressPerformance").textContent = perMinute > 0
    ? t("speed", { time: formatDuration(elapsed), rate: perMinute.toFixed(1) })
    : t("elapsed", { time: formatDuration(elapsed) });
  renderLiveResults(job.results || []);
  renderErrors("progressErrors", job.errors || []);
  $("cancelJobButton").hidden = !["queued", "running"].includes(job.status);
  $("retryJobButton").hidden = job.archived_at || !["failed", "cancelled"].includes(job.status);
}

const REVIEW_LIST_FIELDS = [
  ["core_outputs", "核心产出"],
  ["target_objects", "核心对象"],
  ["required_scenarios", "必需业务场景"],
  ["allowed_adjacent", "允许迁移的相邻场景"],
  ["rejected_adjacent", "不可自动放宽的相邻场景"],
  ["similar_wrong_profiles", "相似但错误的候选人类型"],
  ["evaluation_notes", "评估备注"],
  ["bonus_signals", "加分信号（仅排序，不降级）"],
];
const REVIEW_RULE_FIELDS = [
  ["hard_requirements", "硬性门槛"],
  ["a_conditions", "A类规则（优先约面）"],
  ["b_conditions", "B类规则（电话确认）"],
  ["c_conditions", "C类规则（不推进）"],
  ["negative_signals", "负向否决信号"],
];

async function renderCriteriaReview(job, mode = "calibrate") {
  let criteria;
  try {
    const payload = await api(`/api/jobs/${job.id}/criteria-json`);
    criteria = payload.criteria;
  } catch (error) {
    showToast(error.message);
    if (job.status === "completed") renderResults(job);
    else renderProgress(job);
    return;
  }
  document.body.dataset.view = "review";
  showSection("criteriaReviewView");
  $("viewTitle").textContent = displayJobTitle(job.title);
  const confirmLabel = $("confirmCriteriaButton").querySelector("span");
  confirmLabel.dataset.i18n = mode === "re-edit" ? "confirmAndRestart" : "confirmAndStart";
  confirmLabel.textContent = t(confirmLabel.dataset.i18n);
  renderCriteriaEditor(criteria);
}

function reviewSection(title, body) {
  const section = document.createElement("section");
  section.className = "review-section";
  const heading = document.createElement("h3");
  heading.textContent = title;
  section.append(heading);
  const wrap = document.createElement("div");
  wrap.className = "review-body";
  wrap.append(body);
  section.append(wrap);
  return section;
}

function reviewRemoveButton(row) {
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "review-icon-button";
  remove.title = t("removingRule");
  remove.textContent = "×";
  remove.addEventListener("click", () => row.remove());
  return remove;
}

function reviewTextList(name, values) {
  const container = document.createElement("div");
  container.className = "review-list";
  container.dataset.criteriaList = name;
  const add = () => {
    const row = document.createElement("div");
    row.className = "review-row";
    const input = document.createElement("input");
    input.type = "text";
    const remove = reviewRemoveButton(row);
    row.append(input, remove);
    container.insertBefore(row, addButton);
    input.focus();
  };
  for (const value of values || []) {
    const row = document.createElement("div");
    row.className = "review-row";
    const input = document.createElement("input");
    input.type = "text";
    input.value = value || "";
    const remove = reviewRemoveButton(row);
    row.append(input, remove);
    container.append(row);
  }
  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "review-add-button";
  addButton.textContent = `+ ${t("addingRule")}`;
  addButton.addEventListener("click", add);
  container.append(addButton);
  return container;
}

function reviewRuleList(name, items) {
  const container = document.createElement("div");
  container.className = "review-list";
  container.dataset.criteriaRule = name;
  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "review-add-button";
  addButton.textContent = `+ ${t("addingRule")}`;
  container.append(addButton);
  const add = (item = {}) => {
    const row = document.createElement("div");
    row.className = "review-row";
    if (item.id) row.dataset.ruleId = item.id;
    const ruleInput = document.createElement("input");
    ruleInput.type = "text";
    ruleInput.className = "rule-input";
    ruleInput.value = item.rule || "";
    const verifyInput = document.createElement("input");
    verifyInput.type = "text";
    verifyInput.className = "verify-input";
    verifyInput.placeholder = "核验方式";
    verifyInput.value = item.verification || "";
    const remove = reviewRemoveButton(row);
    row.append(ruleInput, verifyInput, remove);
    container.insertBefore(row, addButton);
    ruleInput.focus();
  };
  for (const item of items || []) add(item);
  addButton.addEventListener("click", () => add());
  return container;
}

function renderCriteriaEditor(criteria) {
  state.criteriaBase = criteria;
  const host = $("criteriaEditor");
  host.replaceChildren();
  const essenceSection = document.createElement("section");
  essenceSection.className = "review-section";
  const essenceHeading = document.createElement("h3");
  essenceHeading.textContent = "岗位本质";
  essenceSection.append(essenceHeading);
  const essenceWrap = document.createElement("div");
  essenceWrap.className = "review-body";
  const essenceInput = document.createElement("textarea");
  essenceInput.id = "criteriaEssenceInput";
  essenceInput.className = "review-textarea";
  essenceInput.value = criteria.essence || "";
  essenceWrap.append(essenceInput);
  essenceSection.append(essenceWrap);
  host.append(essenceSection);
  for (const [name, title] of REVIEW_LIST_FIELDS) {
    host.append(reviewSection(title, reviewTextList(name, criteria[name] || [])));
  }
  for (const [name, title] of REVIEW_RULE_FIELDS) {
    host.append(reviewSection(title, reviewRuleList(name, criteria[name] || [])));
  }
}

function collectCriteria() {
  const result = { ...state.criteriaBase };
  result.essence = $("criteriaEssenceInput").value.trim();
  for (const [name] of REVIEW_LIST_FIELDS) {
    result[name] = [...document.querySelectorAll(`[data-criteria-list="${name}"] input`)]
      .map((input) => input.value.trim())
      .filter(Boolean);
  }
  for (const [name] of REVIEW_RULE_FIELDS) {
    result[name] = [...document.querySelectorAll(`[data-criteria-rule="${name}"] .review-row`)]
      .map((row) => {
        const item = {};
        if (row.dataset.ruleId) item.id = row.dataset.ruleId;
        item.rule = row.querySelector(".rule-input").value.trim();
        item.verification = row.querySelector(".verify-input").value.trim();
        return item;
      })
      .filter((item) => item.rule);
  }
  return result;
}

async function confirmCriteriaAndStart() {
  if (!state.currentJob) return;
  const button = $("confirmCriteriaButton");
  if (button.disabled) return;
  setButtonBusy(button, true);
  try {
    await api(`/api/jobs/${state.currentJob.id}/criteria-json`, {
      method: "PUT",
      body: JSON.stringify(collectCriteria()),
    });
    state.currentJob = await api(`/api/jobs/${state.currentJob.id}/start`, { method: "POST" });
    renderProgress(state.currentJob);
    schedulePoll();
  } catch (error) {
    showToast(error.message);
  } finally {
    setButtonBusy(button, false);
  }
}

function appendCell(row, value, className = "") {
  const cell = document.createElement("td");
  if (className) cell.className = className;
  if (className === "badge-cell") {
    const badge = document.createElement("span");
    badge.className = `conclusion ${conclusionClass(value)}`;
    badge.textContent = conclusionLabel(value);
    cell.append(badge);
  } else {
    const separator = state.language === "en" ? "; " : "；";
    cell.textContent = Array.isArray(value) ? (value.join(separator) || t("missingValue")) : (value || t("missingValue"));
  }
  row.append(cell);
}

export function renderResults(job) {
  document.body.dataset.view = "results";
  showSection("resultsView");
  $("resultActions").hidden = false;
  $("viewTitle").textContent = displayJobTitle(job.title);
  const appendButton = $("appendResumesButton");
  appendButton.hidden = Boolean(job.archived_at);
  $("editCriteriaButton").hidden = Boolean(job.archived_at);
  const all = job.results || [];
  const counts = {
    all: all.length,
    a: all.filter((item) => item.conclusion === "A优先约面").length,
    b: all.filter((item) => item.conclusion === "B电话确认").length,
    c: all.filter((item) => item.conclusion === "C不推进").length,
  };
  const summary = $("resultSummary");
  summary.replaceChildren();
  for (const [label, value] of [[t("summaryCandidates"), counts.all], [t("summaryA"), counts.a], [t("summaryB"), counts.b], [t("summaryC"), counts.c]]) {
    const stat = document.createElement("div");
    stat.className = "summary-stat";
    const strong = document.createElement("strong"); strong.textContent = value;
    const span = document.createElement("span"); span.textContent = label;
    stat.append(strong, span); summary.append(stat);
  }
  const filtered = state.resultFilter === "all" ? all : all.filter((item) => item.conclusion === state.resultFilter);
  const resultMeta = [t("candidateCount", { count: filtered.length }), t("durationMeta", { time: formatDuration(job.elapsed_seconds) })];
  $("resultCount").textContent = resultMeta.join(" · ");
  const body = $("resultsBody");
  body.replaceChildren();
  if (!filtered.length) {
    const row = document.createElement("tr");
    row.className = "empty-row";
    const cell = document.createElement("td");
    cell.colSpan = 8;
    cell.append(createSvgIcon(["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z", "M21 21l-4.3-4.3"]));
    const label = document.createElement("span");
    label.textContent = t("noFilteredResults");
    cell.append(label);
    row.append(cell);
    body.append(row);
  } else {
    filtered.forEach((item, index) => {
      const row = document.createElement("tr");
      row.style.animationDelay = `${Math.min(index * 40, 560)}ms`;
      const compareCell = document.createElement("td");
      compareCell.className = "compare-cell";
      const box = document.createElement("input");
      box.type = "checkbox";
      if (item.conclusion === "C不推进") {
        box.disabled = true;
        box.title = t("compareExcludeC");
      } else {
        box.checked = state.compareSelection.has(item.source_file);
        box.addEventListener("change", () => {
          if (box.checked) state.compareSelection.add(item.source_file);
          else state.compareSelection.delete(item.source_file);
          updateCompareButton();
        });
      }
      compareCell.append(box);
      row.append(compareCell);
      appendCell(row, index + 1);
      appendCell(row, item.candidate_name);
      const resumeCell = document.createElement("td");
      resumeCell.className = "resume-preview-cell";
      if (item.source_file) {
        const previewButton = document.createElement("button");
        previewButton.type = "button";
        previewButton.className = "candidate-preview-button";
        previewButton.title = t("previewNamed", { name: item.source_file });
        previewButton.setAttribute("aria-label", t("previewNamed", { name: item.candidate_name || item.source_file }));
        previewButton.append(createSvgIcon(["M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z", "M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z"]));
        previewButton.addEventListener("click", () => openStoredResumePreview(job.id, item));
        resumeCell.append(previewButton);
      }
      row.append(resumeCell);
      appendCell(row, item.conclusion, "badge-cell");
      appendCell(row, item.one_line);
      appendCell(row, item.blockers);
      appendCell(row, item.next_action);
      body.append(row);
    });
  }
  renderErrors("resultErrors", job.errors || []);
  updateCompareButton();
}

export async function loadJob(id) {
  try {
    // 切换任务前清掉上一任务的轮询定时器，避免过期回调轮询新的会话。
    clearTimeout(state.pollTimer);
    state.pollTimer = null;
    stopCallPolling();
    routerShow("screening");
    const job = await api(`/api/jobs/${id}`);
    // 切换到其他任务时清空对比勾选、进行中的取消状态与结果筛选，避免跨任务串入状态。
    if (state.currentJob && state.currentJob.id !== id) {
      state.compareSelection = new Set();
      state.compareCancelKey = null;
      resetResultFilter();
      state.liveResultKeys = null;
    }
    state.currentJob = job;
    localStorage.setItem("talentHub.activeTool", "screening");
    localStorage.setItem("talentHub.lastJob", id);
    localStorage.removeItem("talentHub.lastCall");
    const target = job.archived_at ? state.archivedJobs : state.jobs;
    const other = job.archived_at ? state.jobs : state.archivedJobs;
    const existing = target.findIndex((item) => item.id === id);
    if (existing >= 0) target[existing] = job;
    else target.unshift(job);
    const otherIndex = other.findIndex((item) => item.id === id);
    if (otherIndex >= 0) other.splice(otherIndex, 1);
    renderHistory();
    if (job.status === "completed") renderResults(job);
    else if (job.status === "waiting") renderCriteriaReview(job);
    else renderProgress(job);
    if (["queued", "running"].includes(job.status)) schedulePoll();
    hideStartupLoading();
  } catch (error) {
    showToast(error.message);
    hideStartupLoading();
    if (!state.currentJob) $("setupView").hidden = false;
  }
}

function schedulePoll() {
  clearTimeout(state.pollTimer);
  // 捕获排期时的任务 id：切换任务后旧定时器不再轮询新的会话，避免跨任务串扰。
  const id = state.currentJob?.id;
  if (!id) return;
  state.pollTimer = setTimeout(async () => {
    if (!state.currentJob || state.currentJob.id !== id) return;
    try {
      const job = await api(`/api/jobs/${id}`);
      // 已切换到电话确认页时丢弃本轮结果，避免重新显示筛选视图造成页面重合。
      if (routerCurrentView() !== "screening") return;
      if (!state.currentJob || state.currentJob.id !== id) return;
      state.currentJob = job;
      const index = state.jobs.findIndex((item) => item.id === id);
      if (index >= 0) state.jobs[index] = job;
      renderHistory();
      if (job.status === "completed") {
        renderResults(job);
        showToast(t("completedToast"));
      } else if (["failed", "cancelled"].includes(job.status)) {
        renderProgress(job);
        showToast(job.status === "cancelled" ? t("cancelledToast") : t("failedToast"));
      } else if (job.status === "waiting") {
        renderCriteriaReview(job);
      } else {
        renderProgress(job);
        schedulePoll();
      }
    } catch (error) {
      // 已切走时丢弃本轮错误与重试，避免过期轮询串到新会话。
      if (!state.currentJob || state.currentJob.id !== id) return;
      showToast(error.message);
      schedulePoll();
    }
  }, 1200);
}

async function uploadFile(jobId, endpoint, file) {
  return api(`/api/jobs/${jobId}/${endpoint}?filename=${encodeURIComponent(file.name)}`, { method: "PUT", body: file });
}

async function startScreening() {
  if (!state.settings?.is_ready) {
    openSettings();
    showSettingsMessage(t("settingsRequired"), true);
    return;
  }
  const jdText = $("jdText").value.trim();
  if (!jdText) return;
  if (!state.selectedResumes.length) return;
  const button = $("startButton");
  const buttonLabel = button.querySelector("span");
  setButtonBusy(button, true);
  buttonLabel.textContent = t("uploading");
  try {
    const job = await api("/api/jobs", { method: "POST", body: JSON.stringify({ title: "岗位候选人筛选" }) });
    state.currentJob = job;
    state.jobs.unshift(job);
    renderHistory();
    renderProgress({ ...job, stage: t("savingJobBrief"), progress: 1, total: state.selectedResumes.length });
    await api(`/api/jobs/${job.id}/jd`, { method: "PUT", body: JSON.stringify({ text: jdText }) });
    let duplicateCount = 0;
    for (let index = 0; index < state.selectedResumes.length; index += 1) {
      $("progressStage").textContent = t("uploadingResume", { current: index + 1, total: state.selectedResumes.length });
      $("progressPercent").textContent = `${Math.max(1, Math.round((index + 1) / state.selectedResumes.length * 8))}%`;
      const uploadResult = await uploadFile(job.id, "resumes", state.selectedResumes[index]);
      if (uploadResult.upload?.accepted === false) duplicateCount += 1;
    }
    state.currentJob = await api(`/api/jobs/${job.id}/start`, { method: "POST" });
    if (duplicateCount) showToast(t("duplicateResumesSkipped", { count: duplicateCount }));
    schedulePoll();
  } catch (error) {
    showToast(error.message);
    setButtonBusy(button, false);
  } finally {
    buttonLabel.textContent = t("startScreening");
  }
}

async function appendResumes(fileList) {
  if (!state.currentJob || state.currentJob.status !== "completed" || state.currentJob.archived_at) return;
  if (!state.settings?.is_ready) {
    openSettings();
    showSettingsMessage(t("settingsRequired"), true);
    return;
  }
  const files = [...fileList];
  if (!files.length) return;
  const jobId = state.currentJob.id;
  const evaluatedFiles = new Set((state.currentJob.results || []).map((item) => item.source_file));
  renderProgress({ ...state.currentJob, stage: t("uploading"), progress: 1 });
  try {
    let acceptedCount = 0;
    let duplicateCount = 0;
    let pendingDuplicateCount = 0;
    for (let index = 0; index < files.length; index += 1) {
      $("progressStage").textContent = t("uploadingResume", { current: index + 1, total: files.length });
      $("progressPercent").textContent = `${Math.max(1, Math.round((index + 1) / files.length * 8))}%`;
      const uploadResult = await uploadFile(jobId, "resumes", files[index]);
      if (uploadResult.upload?.accepted === false) {
        duplicateCount += 1;
        if (!evaluatedFiles.has(uploadResult.upload.duplicate_of)) pendingDuplicateCount += 1;
      } else {
        acceptedCount += 1;
      }
    }
    if (!acceptedCount && !pendingDuplicateCount) {
      state.currentJob = await api(`/api/jobs/${jobId}`);
      renderResults(state.currentJob);
      showToast(t("noNewResumes"));
      return;
    }
    state.currentJob = await api(`/api/jobs/${jobId}/start`, { method: "POST" });
    if (duplicateCount) showToast(t("duplicateResumesSkipped", { count: duplicateCount }));
    schedulePoll();
  } catch (error) {
    showToast(error.message);
    try {
      state.currentJob = await api(`/api/jobs/${jobId}`);
      if (state.currentJob.status === "completed") renderResults(state.currentJob);
      else renderProgress(state.currentJob);
    } catch (_refreshError) {
      // 保留当前错误提示；轮询或重新打开历史任务时会恢复服务端状态。
    }
  }
}

async function cancelCurrentJob() {
  if (!state.currentJob) return;
  const button = $("cancelJobButton");
  if (button.disabled) return;
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = stageLabel("正在停止任务");
  try {
    state.currentJob = await api(`/api/jobs/${state.currentJob.id}/cancel`, { method: "POST" });
    renderProgress(state.currentJob);
    schedulePoll();
  } catch (error) {
    button.disabled = false;
    button.textContent = originalLabel;
    showToast(error.message);
  }
}

async function retryCurrentJob() {
  if (!state.currentJob) return;
  try {
    state.currentJob = await api(`/api/jobs/${state.currentJob.id}/start`, { method: "POST" });
    renderProgress(state.currentJob);
    schedulePoll();
  } catch (error) { showToast(error.message); }
}

export function init() {
  onChange(() => {
    renderSelectedMaterials();
    if (routerCurrentView() !== "screening") return;
    if (state.currentJob) {
      if (state.currentJob.status === "completed") renderResults(state.currentJob);
      else if (state.currentJob.status === "waiting") renderCriteriaReview(state.currentJob);
      else renderProgress(state.currentJob);
    } else {
      $("viewTitle").textContent = t("jobTitle");
    }
  });
  $("startButton").addEventListener("click", startScreening);
  $("confirmCriteriaButton").addEventListener("click", confirmCriteriaAndStart);
  $("cancelCriteriaButton").addEventListener("click", () => {
    if (!state.currentJob) return;
    if (state.currentJob.status === "completed") renderResults(state.currentJob);
    else renderProgress(state.currentJob);
  });
  $("cancelJobButton").addEventListener("click", cancelCurrentJob);
  $("retryJobButton").addEventListener("click", retryCurrentJob);
  $("downloadResultButton").addEventListener("click", () => openArtifactPreview("workbook"));
  $("downloadCriteriaButton").addEventListener("click", () => openArtifactPreview("criteria"));
  $("editCriteriaButton").addEventListener("click", () => {
    if (state.currentJob && !state.currentJob.archived_at) renderCriteriaReview(state.currentJob, "re-edit");
  });
  $("appendResumesButton").addEventListener("click", () => $("appendResumeFiles").click());
  $("appendResumeFiles").addEventListener("change", (event) => {
    appendResumes(event.target.files);
    event.target.value = "";
  });
  $("jdText").addEventListener("input", renderSelectedMaterials);
  $("resultFilter").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-filter]");
    if (!button) return;
    state.resultFilter = button.dataset.filter;
    for (const item of $("resultFilter").querySelectorAll("button")) item.classList.toggle("active", item === button);
    renderResults(state.currentJob);
  });
}
