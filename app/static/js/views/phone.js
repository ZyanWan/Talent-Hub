"use strict";

import { state } from "../core/state.js";
import { t, onChange } from "../core/i18n.js";
import { api } from "../core/api.js";
import { $ } from "../core/dom.js";
import { currentView as routerCurrentView, registerView, show as routerShow } from "../core/router.js";
import { createCustomSelect } from "../core/customSelect.js";
import {
  callItemStatusLabel,
  callStatusBadgeClass,
  createSvgIcon,
  defaultCallTitle,
  fileSuffix,
  formatDate,
  formatSize,
  renderErrors,
  setButtonBusy,
  showToast,
  stageLabel,
} from "../core/utils.js";
import { openSettings, showSettingsMessage } from "../dialogs/settings.js";
import { refreshCallHistoryData } from "./history.js";

const CALL_AUDIO_SUFFIXES = new Set([".m4a", ".wav", ".mp3", ".ogg", ".opus"]);
const CALL_AUDIO_MAX_BYTES = 100 * 1024 * 1024;

// 预设软性素质维度：key 与后端 SOFT_SKILL_DIMENSIONS 对齐，label 走 i18n。
const SOFT_SKILL_DIMENSIONS = [
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
const SOFT_SKILL_KEYWORD_MAP = [
  { key: "self_drive", keywords: ["自驱", "主动", "自我驱动", "内驱"] },
  { key: "resilience", keywords: ["韧性", "抗压", "抗挫", "情绪稳定", "坚持", "不放弃"] },
  { key: "logic", keywords: ["逻辑", "条理", "结构化", "思考清晰"] },
  { key: "learning", keywords: ["学习", "成长", "上手快", "新知识"] },
  { key: "openness", keywords: ["开放", "拥抱变化", "接受意见", "试错", "迭代"] },
  { key: "pragmatism", keywords: ["务实", "落地", "执行", "结果导向"] },
  { key: "collaboration", keywords: ["协作", "沟通", "跨部门", "团队", "配合"] },
  { key: "passion", keywords: ["热爱", "兴趣", "激情", "喜欢"] },
];

// 当前创建表单勾选的维度 key 集合（未保存到服务端前仅存于此）。
let selectedSoftSkillDims = new Set();

// 岗位联动导入的请求序号：快速切换岗位时只允许最后一次请求落地，防止乱序覆盖。
let importCallFocusSeq = 0;

// 关联岗位自定义下拉组件实例（init 时创建）。
let callJobSelect = null;

// 已加载的条目音频 Blob URL 缓存（key: callId:itemId），轮询重建 DOM 时复用，避免泄漏与重复下载。
const audioBlobUrls = new Map();
// 正在下载的条目音频 Promise（key 同上）：并发触发时复用同一请求，避免同一录音被重复下载。
const audioBlobPending = new Map();
// 当前详情浮层预览的候选人条目 id；打开时记录，轮询重画后据此恢复浮层。
let activeCallItemId = null;
// 浮层关闭的延迟隐藏定时器：收起动画结束后才清几何并隐藏，快速重开时先取消。
let closeItemDetailTimer = 0;

// 生命周期：离开电话视图时停止自己的详情轮询。互斥由 router 保证（同一时刻仅一个视图激活），
// 每个视图只清理自己的轮询字段，无需感知其他视图；resetCallPreparation 里的显式 stopCallPolling 保留为防御性冗余。
registerView("phone", {
  exit: () => {
    clearTimeout(state.callPollTimer);
    state.callPollTimer = null;
  },
});

export function stopCallPolling() {
  clearTimeout(state.callPollTimer);
  state.callPollTimer = null;
}

function releaseAudioBlobs() {
  for (const url of audioBlobUrls.values()) {
    URL.revokeObjectURL(url);
  }
  audioBlobUrls.clear();
  audioBlobPending.clear();
}

export function resetCallPreparation() {
  stopCallPolling();
  releaseAudioBlobs();
  state.currentCall = null;
  state.pendingCallFiles = [];
  $("callTitleInput").value = "";
  $("callJobInput").value = "";
  $("callSoftSkillInput").value = "";
  $("callJobLinkSelect").value = "";
  selectedSoftSkillDims = new Set();
  $("callAudioFiles").value = "";
  renderCallSoftSkillDims();
  renderCallWorkbench();
}

export function openPhoneView({ reset = true } = {}) {
  routerShow("phone");
  $("viewTitle").hidden = true;
  $("phoneView").hidden = false;
  document.body.dataset.view = "phone";
  localStorage.setItem("talentHub.activeTool", "phone");
  if (reset) {
    localStorage.removeItem("talentHub.lastCall");
    resetCallPreparation();
  } else {
    renderCallWorkbench();
  }
  refreshCallHistoryData({ render: false });
}

export function renderCallWorkbench() {
  const call = state.currentCall;
  if (!call || call.status === "draft") {
    showCallCreate();
    return;
  }
  renderCallDetail();
}

function showCallCreate() {
  $("callDetailView").hidden = true;
  $("callCreateView").hidden = false;
  $("appendCallAudioButton").hidden = true;
  if (state.currentCall && state.currentCall.status === "draft") {
    $("callSoftSkillInput").value = state.currentCall.soft_skill_focus || "";
    $("callJobLinkSelect").value = state.currentCall.job_id || "";
    selectedSoftSkillDims = new Set(state.currentCall.soft_skill_dimensions || []);
  }
  renderCallSoftSkillDims();
  loadCallJobLinks();
  renderCallAudioList();
}

function renderCallSoftSkillDims() {
  const host = $("callSoftSkillDims");
  host.replaceChildren();
  for (const dim of SOFT_SKILL_DIMENSIONS) {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = dim.key;
    checkbox.checked = selectedSoftSkillDims.has(dim.key);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedSoftSkillDims.add(dim.key);
      else selectedSoftSkillDims.delete(dim.key);
    });
    const text = document.createElement("span");
    text.textContent = t(dim.labelKey);
    label.append(checkbox, text);
    host.append(label);
  }
}

async function loadCallJobLinks() {
  const select = $("callJobLinkSelect");
  const keep = select.value;
  select.replaceChildren();
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = t("callJobLinkPlaceholder");
  empty.dataset.i18n = "callJobLinkPlaceholder"; // 语言切换时由 applyStaticLanguage 更新文案
  select.append(empty);
  const known = new Set();
  try {
    const data = await api("/api/jobs?scope=recent&limit=100");
    for (const job of data.jobs || []) {
      known.add(job.id);
      const option = document.createElement("option");
      option.value = job.id;
      option.textContent = job.title || job.id;
      select.append(option);
    }
  } catch (_) { /* 岗位列表加载失败不阻塞创建流程 */ }
  // 编辑 draft 时已关联的岗位可能不在最近 100 条内：补拉该岗位，保证下拉显示与任务数据一致。
  if (keep && !known.has(keep)) {
    try {
      const job = await api(`/api/jobs/${keep}`);
      known.add(job.id);
      const option = document.createElement("option");
      option.value = job.id;
      option.textContent = job.title || job.id;
      select.append(option);
    } catch (_) { /* 岗位不存在或已删除，保持空选中 */ }
  }
  select.value = known.has(keep) ? keep : "";
  callJobSelect.sync();
}

async function importCallJobFocus() {
  const jobId = $("callJobLinkSelect").value;
  const seq = ++importCallFocusSeq;
  const matched = new Set();
  let focusText = "";
  if (jobId) {
    try {
      const response = await api(`/api/jobs/${jobId}/criteria-json`);
      const criteria = response.criteria || {};
      const bonusSignals = Array.isArray(criteria.bonus_signals) ? criteria.bonus_signals : [];
      focusText = bonusSignals.length ? `来自岗位加分信号：${bonusSignals.join("；")}` : "";
      const joined = bonusSignals.join("，");
      for (const dim of SOFT_SKILL_KEYWORD_MAP) {
        if (dim.keywords.some((keyword) => joined.includes(keyword))) matched.add(dim.key);
      }
    } catch (error) {
      if (seq !== importCallFocusSeq) return; // 已切换到其他岗位，丢弃过期请求的提示
      showToast(
        typeof error?.message === "string" && error.message.includes("筛选标准尚未生成")
          ? t("callJobCriteriaMissing")
          : t("callJobImportFail")
      );
      return;
    }
  }
  if (seq !== importCallFocusSeq) return;
  // 完全替换语义：勾选与文本只反映当前岗位；切回“不关联岗位”同样清空。
  selectedSoftSkillDims = matched;
  $("callSoftSkillInput").value = focusText;
  renderCallSoftSkillDims();
}

function renderCallAudioList() {
  const host = $("callAudioList");
  host.replaceChildren();
  const uploaded = state.currentCall?.items || [];
  for (const item of uploaded) {
    const row = document.createElement("div");
    row.className = "call-audio-row";
    const copy = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = item.audio_file || item.id;
    const meta = document.createElement("em");
    meta.textContent = item.candidate_name || item.id;
    copy.append(name, meta);
    row.append(createSvgIcon(["M19 11a7 7 0 0 1-7 7h-2a7 7 0 0 1-7-7M12 2v10", "m9 13 3-3 3 3"]), copy);
    host.append(row);
  }
  for (const file of state.pendingCallFiles) {
    const row = document.createElement("div");
    row.className = "call-audio-row is-pending";
    const copy = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = file.name;
    const meta = document.createElement("em");
    meta.textContent = formatSize(file.size);
    copy.append(name, meta);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "call-audio-remove";
    remove.title = t("callRemoveAudio", { name: file.name });
    remove.setAttribute("aria-label", remove.title);
    remove.append(createSvgIcon(["M6 6l12 12M18 6 6 18"]));
    remove.addEventListener("click", () => {
      state.pendingCallFiles.splice(state.pendingCallFiles.indexOf(file), 1);
      renderCallAudioList();
    });
    row.append(createSvgIcon(["M19 11a7 7 0 0 1-7 7h-2a7 7 0 0 1-7-7M12 2v10", "m9 13 3-3 3 3"]), copy, remove);
    host.append(row);
  }
  $("startCallProcessButton").disabled = !state.pendingCallFiles.length && !uploaded.length;
}

function collectCallAudioFiles(fileList) {
  const files = [];
  let skipped = 0;
  for (const file of fileList) {
    if (!CALL_AUDIO_SUFFIXES.has(fileSuffix(file)) || file.size > CALL_AUDIO_MAX_BYTES) {
      skipped += 1;
      continue;
    }
    files.push(file);
  }
  if (skipped) showToast(t("callInvalidAudio", { count: skipped }));
  return files;
}

function addPendingCallAudio(fileList) {
  const files = collectCallAudioFiles(fileList);
  if (!files.length) return;
  const known = new Set(state.pendingCallFiles.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
  for (const file of files) {
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (!known.has(key)) {
      state.pendingCallFiles.push(file);
      known.add(key);
    }
  }
  renderCallAudioList();
}

export async function selectCall(callId) {
  stopCallPolling();
  releaseAudioBlobs();
  activeCallItemId = null;
  try {
    const call = await api(`/api/calls/${callId}`);
    state.currentCall = call;
    state.pendingCallFiles = [];
    $("callAudioFiles").value = "";
    localStorage.setItem("talentHub.activeTool", "phone");
    localStorage.setItem("talentHub.lastCall", callId);
    renderCallWorkbench();
  } catch (error) {
    localStorage.removeItem("talentHub.lastCall");
    showToast(error.message);
  }
}

async function createCall(title, jobTitle, softSkillFocus, jobId, softSkillDims) {
  const call = await api("/api/calls", {
    method: "POST",
    body: JSON.stringify({
      title,
      job_title: jobTitle,
      job_id: jobId,
      soft_skill_focus: softSkillFocus,
      soft_skill_dimensions: softSkillDims,
    }),
  });
  state.currentCall = call;
  localStorage.setItem("talentHub.activeTool", "phone");
  localStorage.setItem("talentHub.lastCall", call.id);
  await refreshCallHistoryData({ render: false });
  return call;
}

async function refreshCallDetail() {
  if (!state.currentCall) return;
  const call = await api(`/api/calls/${state.currentCall.id}`);
  state.currentCall = call;
  renderCallWorkbench();
}

async function uploadPendingCallAudio() {
  const call = state.currentCall;
  if (!call) return 0;
  let duplicateCount = 0;
  while (state.pendingCallFiles.length) {
    const file = state.pendingCallFiles[0];
    const result = await api(`/api/calls/${call.id}/audio?filename=${encodeURIComponent(file.name)}`, { method: "PUT", body: file });
    if (result.upload?.accepted === false) duplicateCount += 1;
    state.pendingCallFiles.shift();
    renderCallAudioList();
  }
  await refreshCallDetail();
  refreshCallHistoryData({ render: false });
  if (duplicateCount) showToast(t("duplicateAudioSkipped", { count: duplicateCount }));
  return duplicateCount;
}

// 已完成任务追加录音：上传 → 有新增则自动重新整理（复用筛选"追加简历"的交互模式）。
async function appendCallAudio(fileList) {
  const call = state.currentCall;
  if (!call || call.status !== "done" || call.archived_at) return;
  const files = collectCallAudioFiles(fileList);
  if (!files.length) return;
  if (!state.settings?.asr_configured) {
    openSettings();
    showSettingsMessage(t("callNoReady"), true);
    return;
  }
  const button = $("appendCallAudioButton");
  setButtonBusy(button, true);
  try {
    let acceptedCount = 0;
    let duplicateCount = 0;
    for (let index = 0; index < files.length; index += 1) {
      const result = await api(
        `/api/calls/${call.id}/audio?filename=${encodeURIComponent(files[index].name)}`,
        { method: "PUT", body: files[index] }
      );
      if (result.upload?.accepted === false) duplicateCount += 1;
      else acceptedCount += 1;
    }
    if (!acceptedCount) {
      showToast(t("noNewAudio"));
      await refreshCallDetail();
      return;
    }
    if (duplicateCount) showToast(t("duplicateAudioSkipped", { count: duplicateCount }));
    const started = await api(`/api/calls/${call.id}/process`, { method: "POST" });
    state.currentCall = started;
    renderCallDetail();
    refreshCallHistoryData({ render: false });
    startCallPolling();
  } catch (error) {
    showToast(error.message);
    await refreshCallDetail();
  } finally {
    setButtonBusy(button, false);
  }
}

async function startCallProcess() {
  let call = state.currentCall;
  if (call && call.status !== "draft") return;
  const hasAudio = state.pendingCallFiles.length || (call?.items || []).length;
  if (!hasAudio) {
    showToast(t("callNoAudio"));
    return;
  }
  if (!state.settings?.asr_configured) {
    openSettings();
    showSettingsMessage(t("callNoReady"), true);
    return;
  }
  const button = $("startCallProcessButton");
  setButtonBusy(button, true);
  try {
    if (!call) {
      const title = $("callTitleInput").value.trim() || defaultCallTitle();
      const jobTitle = $("callJobInput").value.trim();
      const jobId = $("callJobLinkSelect").value;
      const softSkillFocus = $("callSoftSkillInput").value.trim();
      const softSkillDims = [...selectedSoftSkillDims];
      call = await createCall(title, jobTitle, softSkillFocus, jobId, softSkillDims);
      $("callTitleInput").value = "";
      $("callJobInput").value = "";
      $("callSoftSkillInput").value = "";
      $("callJobLinkSelect").value = "";
      selectedSoftSkillDims = new Set();
      renderCallSoftSkillDims();
      $("callAudioFiles").value = "";
    }
    if (state.pendingCallFiles.length) {
      const beforeCount = (call.items || []).length;
      await uploadPendingCallAudio();
      if ((state.currentCall.items || []).length === beforeCount) {
        showToast(t("noNewAudio"));
        return; // 所选录音全部重复，无新增条目，不触发整理
      }
    }
    const started = await api(`/api/calls/${call.id}/process`, { method: "POST" });
    state.currentCall = started;
    renderCallDetail();
    refreshCallHistoryData({ render: false });
    startCallPolling();
  } catch (error) {
    showToast(error.message);
  } finally {
    setButtonBusy(button, false);
    renderCallWorkbench();
  }
}

function renderCallDetail({ preservePlayback = false } = {}) {
  const call = state.currentCall;
  if (!call) return;
  $("callCreateView").hidden = true;
  $("callDetailView").hidden = false;
  $("callDetailTitle").textContent = call.title || t("untitledJob");
  const meta = [];
  if (call.job_title) meta.push(call.job_title);
  meta.push(t("callCandidateCount", { count: (call.items || []).length }));
  if (call.stage) meta.push(stageLabel(call.stage));
  meta.push(formatDate(call.updated_at));
  $("callDetailMeta").textContent = meta.join(" · ");
  const running = ["queued", "running"].includes(call.status);
  $("callCancelButton").hidden = !running;
  $("retryCallNotificationButton").hidden = running || Boolean(call.archived_at);
  $("callRetryButton").hidden = running || call.archived_at || !["failed", "cancelled"].includes(call.status);
  // 追加录音 FAB：仅已完成且未归档的任务显示（与筛选"追加简历"同款交互）。
  $("appendCallAudioButton").hidden = call.status !== "done" || Boolean(call.archived_at);
  // 轮询重画会重建整张卡片列表；重画前捕获浮层播放状态，重画后恢复，
  // 避免处理中刷新打断用户正在听的录音。仅轮询路径启用，其余渲染不做快照。
  const activeDetailOpen = Boolean(activeCallItemId && $("callItemDetail")?.open);
  const refreshActiveDetail = !(preservePlayback && activeDetailOpen);
  const playback = preservePlayback && refreshActiveDetail ? captureCallPlayback() : new Map();
  renderCallItems(call);
  renderErrors("callErrors", call.errors || []);
  if (refreshActiveDetail && activeCallItemId) renderCallItemDetail(activeCallItemId, playback);
  if (running) startCallPolling();
}

// 轮询重画前捕获当前详情浮层的播放状态（key: itemId），供 restoreCallPlayback 恢复。
function captureCallPlayback() {
  const snapshot = new Map();
  if (!activeCallItemId) return snapshot;
  const audio = $("callItemDetailBody")?.querySelector(".call-audio");
  if (!audio) return snapshot;
  const currentTime = audio.currentTime;
  snapshot.set(activeCallItemId, {
    expanded: true,
    currentTime: Number.isFinite(currentTime) && currentTime > 0 ? currentTime : 0,
    playing: Boolean(!audio.paused && !audio.ended),
    capturedAt: Date.now(),
  });
  // 记录快照后立即暂停旧元素：重画会销毁它，若不暂停，声音会一直持续到 GC，
  // 与恢复的新元素叠加成双音/混响（M1）。
  audio.pause();
  return snapshot;
}

// 轮询重画后恢复详情浮层的播放状态：无快照时不处理。
// 播放恢复依赖 loadCallAudio 的 Blob 缓存（重画后同步拿到 URL），seek 到原位置继续播。
function restoreCallPlayback(call, item, audio, saved) {
  if (!saved || !saved.expanded) return;
  loadCallAudio(call.id, item.id, audio).then(() => {
    if (!audio.src) return; // 加载失败已隐藏播放器
    // 下载慢跨轮时恢复动作可能晚于用户对播放器的操作（M2）：检测到用户已操作则不覆盖。
    let userTouched = false;
    for (const eventName of ["play", "pause", "seeked"]) {
      audio.addEventListener(eventName, () => { userTouched = true; }, { once: true });
    }
    const resume = () => {
      if (userTouched) return;
      // 补偿「捕获→恢复」间的已播时长（L1），避免每次刷新进度回跳。
      const target = saved.playing
        ? saved.currentTime + (Date.now() - saved.capturedAt) / 1000
        : saved.currentTime;
      if (target > 0) {
        try { audio.currentTime = target; } catch (_) { /* 元数据未就绪时忽略 */ }
      }
      if (saved.playing) audio.play().catch(() => { });
    };
    if (audio.readyState >= 1) resume();
    else audio.addEventListener("loadedmetadata", resume, { once: true });
  });
}

function callPanelSection(title) {
  const panel = document.createElement("details");
  panel.className = "call-panel";
  const summary = document.createElement("summary");
  summary.textContent = title;
  const body = document.createElement("div");
  body.className = "call-panel-body";
  panel.append(summary, body);
  return { panel, body };
}

function renderCallItems(call) {
  const host = $("callItems");
  host.replaceChildren();
  for (const item of call.items || []) {
    const card = document.createElement("article");
    card.className = "call-item-card";
    if (item.status === "done") card.classList.add("done");
    card.dataset.itemId = item.id;
    const head = document.createElement("button");
    head.type = "button";
    head.className = "call-item-head";
    const name = document.createElement("strong");
    name.textContent = item.candidate_name || item.audio_file || item.id;
    const badge = document.createElement("span");
    badge.className = `call-badge ${callStatusBadgeClass(item.status)}`;
    const statusLabel = callItemStatusLabel(item.status);
    badge.textContent = statusLabel;
    head.append(name, badge);
    if (item.status === "done") {
      // 已完成条目：点击打开全屏详情浮层。
      head.addEventListener("click", () => openCallItemDetail(item.id));
    }
    card.append(head);
    if (item.status !== "done") {
      const progress = document.createElement("div");
      progress.className = "call-item-progress";
      // 处理中（转写/AI 整理）显示活动动画，让"还在跑"与"卡住"一眼可辨
      if (item.status === "transcribing" || item.status === "summarizing") {
        progress.classList.add("is-active");
      }
      const track = document.createElement("div");
      track.className = "call-progress-track";
      const fill = document.createElement("span");
      fill.style.width = `${item.progress || 0}%`;
      track.append(fill);
      const percent = document.createElement("span");
      percent.textContent = `${item.progress || 0}%`;
      progress.append(track, percent);
      card.append(progress);
      if (item.error) {
        const error = document.createElement("div");
        error.className = "call-item-error";
        error.textContent = item.error;
        card.append(error);
      }
    }
    host.append(card);
  }
}

// 构建单个候选人的详情正文（候选人、录音、纪要、面板、操作），返回可挂载到浮层的节点。
function buildCallItemDetailBody(call, item) {
  const summary = item.summary || {};
  const body = document.createElement("div");
  body.className = "call-item-body";
  const candidateRow = document.createElement("div");
  candidateRow.className = "call-candidate-row";
  const candidateLabel = document.createElement("span");
  candidateLabel.textContent = t("callCandidate");
  const candidateInput = document.createElement("input");
  candidateInput.className = "call-candidate-input";
  candidateInput.value = item.candidate_name || "";
  candidateRow.append(candidateLabel, candidateInput);
  // 音频播放器：懒加载（浮层打开时通过 api() 下载为 Blob），点击事实可跳转对应时间点
  const audio = document.createElement("audio");
  audio.className = "call-audio";
  audio.controls = true;
  audio.preload = "none";
  const narrativeLabel = document.createElement("span");
  narrativeLabel.className = "call-section-label";
  narrativeLabel.textContent = t("callNarrative");
  const narrative = document.createElement("textarea");
  narrative.className = "call-narrative";
  narrative.value = summary.narrative || "";
  body.append(candidateRow, audio, narrativeLabel, narrative);
  const panels = document.createElement("div");
  panels.className = "call-panels";
  if ((summary.fields || []).length) {
    const fieldsPanel = callPanelSection(t("callFieldsPanel"));
    for (const field of summary.fields) {
      const row = document.createElement("label");
      row.className = "call-field-row";
      const label = document.createElement("span");
      label.textContent = field.label || field.key;
      const input = document.createElement("input");
      input.className = "call-field-input";
      input.value = field.value || "";
      input.dataset.fieldKey = field.key || "";
      row.append(label, input);
      fieldsPanel.body.append(row);
    }
    panels.append(fieldsPanel.panel);
  }
  if ((summary.doubts || []).length) {
    const doubtsPanel = callPanelSection(t("callDoubtsPanel"));
    const list = document.createElement("ul");
    list.className = "call-doubt-list";
    for (const doubt of summary.doubts) {
      const li = document.createElement("li");
      li.textContent = doubt;
      list.append(li);
    }
    doubtsPanel.body.append(list);
    panels.append(doubtsPanel.panel);
  }
  if ((summary.facts || []).length) {
    const factsPanel = callPanelSection(t("callFactsPanel"));
    for (const fact of summary.facts) {
      const hasTime = fact.start_time != null && Number.isFinite(Number(fact.start_time));
      const row = document.createElement("button");
      row.type = "button";
      row.className = "call-fact-row";
      row.disabled = !hasTime;
      row.title = hasTime ? t("callFactJump") : t("callFactNoTime");
      const main = document.createElement("span");
      main.className = "call-fact-content";
      main.textContent = fact.content || "";
      const meta = document.createElement("em");
      meta.textContent = [
        fact.speaker || "",
        hasTime ? formatFactTime(fact.start_time) : t("callFactNoTime"),
        fact.ref || "",
      ].filter(Boolean).join(" · ");
      row.append(main, meta);
      if (hasTime) {
        row.addEventListener("click", () => jumpCallAudio(audio, call.id, item.id, fact.start_time));
      }
      factsPanel.body.append(row);
    }
    panels.append(factsPanel.panel);
  }
  if (summary.transcript) {
    const transcriptPanel = callPanelSection(t("callTranscriptPanel"));
    const pre = document.createElement("pre");
    pre.className = "call-transcript";
    pre.textContent = summary.transcript;
    transcriptPanel.body.append(pre);
    panels.append(transcriptPanel.panel);
  }
  if ((summary.guard_warnings || []).length) {
    // 事实核对告警：折叠面板默认收起，避免长串告警占用详情空间。
    const guardPanel = callPanelSection(t("callGuardPanel", { count: summary.guard_warnings.length }));
    const list = document.createElement("ul");
    list.className = "call-doubt-list";
    for (const warning of summary.guard_warnings) {
      const li = document.createElement("li");
      li.textContent = warning;
      list.append(li);
    }
    guardPanel.body.append(list);
    panels.append(guardPanel.panel);
  }
  if (panels.children.length) body.append(panels);
  const actions = document.createElement("div");
  actions.className = "call-item-actions";
  const save = document.createElement("button");
  save.type = "button";
  save.className = "secondary-button";
  save.textContent = t("callSave");
  save.addEventListener("click", () => saveCallItem(item.id));
  const download = document.createElement("button");
  download.type = "button";
  download.className = "secondary-button";
  download.textContent = t("callDownload");
  download.addEventListener("click", () => downloadCallItem(item.id));
  actions.append(save, download);
  body.append(actions);
  return body;
}

// 渲染详情浮层：标题、上/下一个可用性、正文内容；轮询重画后按快照恢复播放。
function renderCallItemDetail(itemId, playback = new Map()) {
  const call = state.currentCall;
  const item = (call.items || []).find((entry) => entry.id === itemId);
  if (!item || item.status !== "done") {
    closeCallItemDetail();
    return;
  }
  $("callItemDetailName").textContent = item.candidate_name || item.audio_file || item.id;
  const stage = item.stage ? stageLabel(item.stage) : "";
  const statusLabel = callItemStatusLabel(item.status);
  $("callItemDetailMeta").textContent =
    stage && stage !== statusLabel ? `${stage} · ${statusLabel}` : statusLabel;
  const ids = (call.items || []).filter((entry) => entry.status === "done").map((entry) => entry.id);
  const index = ids.indexOf(itemId);
  $("callItemDetailPrev").disabled = index <= 0;
  $("callItemDetailNext").disabled = index === -1 || index >= ids.length - 1;
  const body = buildCallItemDetailBody(call, item);
  const host = $("callItemDetailBody");
  host.replaceChildren(body);
  const audio = body.querySelector(".call-audio");
  const saved = playback.get(itemId);
  if (saved) restoreCallPlayback(call, item, audio, saved);
  else loadCallAudio(call.id, item.id, audio);
  activeCallItemId = itemId;
}

// 点击候选人卡片：渲染并展示详情浮层（复用 preview-dialog 的弹窗样式与动画）。
function openCallItemDetail(itemId) {
  const item = (state.currentCall.items || []).find((entry) => entry.id === itemId);
  if (!item || item.status !== "done") return;
  clearTimeout(closeItemDetailTimer);
  renderCallItemDetail(itemId);
  const overlay = $("callItemDetail");
  if (!overlay.open) {
    overlay.showModal();
    // 强制回流锁定 opacity:0 起点后立即加 is-visible，过渡即时启动，
    // 避免双重 rAF 造成的「弹窗悬空不可见」卡顿。
    void overlay.offsetHeight;
    overlay.classList.add("is-visible");
  }
}

// 关闭详情浮层：播放淡出动画后调用 dialog.close()（快速重开时取消定时关闭）。
function closeCallItemDetail() {
  const overlay = $("callItemDetail");
  const audio = $("callItemDetailBody")?.querySelector(".call-audio");
  audio?.pause();
  activeCallItemId = null;
  if (!overlay.open || !overlay.classList.contains("is-visible")) {
    if (overlay.open) overlay.close();
    return;
  }
  overlay.classList.remove("is-visible");
  // 仅当弹窗未被重新打开时才真正关闭，避免淡出期间快速切换导致误关。
  const finish = () => {
    if (overlay.open && !overlay.classList.contains("is-visible")) overlay.close();
  };
  overlay.addEventListener("transitionend", (event) => {
    if (event.target === overlay && event.propertyName === "transform") finish();
  }, { once: true });
  closeItemDetailTimer = setTimeout(finish, 320);
}

// 详情浮层上/下一个：按已完成条目顺序切换。
function stepCallItemDetail(delta) {
  const ids = (state.currentCall.items || []).filter((entry) => entry.status === "done").map((entry) => entry.id);
  const index = ids.indexOf(activeCallItemId);
  const target = ids[index + delta];
  if (target) openCallItemDetail(target);
}

function formatFactTime(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

async function loadCallAudio(callId, itemId, audio) {
  if (audio.src) return;
  const key = `${callId}:${itemId}`;
  let url = audioBlobUrls.get(key);
  if (!url) {
    let pending = audioBlobPending.get(key);
    if (!pending) {
      pending = api(`/api/calls/${callId}/items/${itemId}/audio`)
        .then((response) => response.blob())
        .then((blob) => {
          const created = URL.createObjectURL(blob);
          audioBlobUrls.set(key, created);
          return created;
        });
      // 无论成败都清理进行中标记；失败不写缓存，允许下次重试。catch 吞掉 rejection，
      // 错误提示统一在下方 await 处处理，避免产生未处理的 Promise 拒绝。
      pending.finally(() => audioBlobPending.delete(key)).catch(() => { });
      audioBlobPending.set(key, pending);
    }
    try {
      url = await pending;
    } catch (_) {
      if (!audio.hidden) {
        showToast(t("callAudioLoadFail"));
        audio.hidden = true;
      }
      return;
    }
  }
  audio.src = url;
}

function jumpCallAudio(audio, callId, itemId, startTime) {
  const seekAndPlay = () => {
    try {
      audio.currentTime = Number(startTime) || 0;
    } catch (_) { /* 元数据未就绪时忽略 */ }
    audio.play().catch(() => { });
  };
  if (audio.src && audio.readyState >= 1) {
    seekAndPlay();
    return;
  }
  loadCallAudio(callId, itemId, audio).then(() => {
    if (!audio.src) return; // 加载失败已隐藏播放器
    if (audio.readyState >= 1) seekAndPlay();
    else audio.addEventListener("loadedmetadata", seekAndPlay, { once: true });
  });
}

async function saveCallItem(itemId) {
  const call = state.currentCall;
  if (!call) return;
  const item = (call.items || []).find((entry) => entry.id === itemId);
  const scope = $("callItemDetailBody");
  const narrativeInput = scope.querySelector(".call-narrative");
  if (!item || !narrativeInput) return;
  const narrative = narrativeInput.value.trim();
  const candidateInput = scope.querySelector(".call-candidate-input");
  const candidateName = candidateInput ? candidateInput.value.trim() : "";
  const fieldByKey = new Map((item.summary?.fields || []).map((field) => [field.key, field]));
  const fields = [...scope.querySelectorAll(".call-field-input")].map((input) => {
    const base = fieldByKey.get(input.dataset.fieldKey) || {};
    return {
      key: input.dataset.fieldKey,
      label: base.label || input.dataset.fieldKey,
      value: input.value,
      status: base.status || "已确认",
      fact_ids: base.fact_ids || [],
      note: base.note || "",
    };
  });
  try {
    await api(`/api/calls/${call.id}/items/${itemId}`, {
      method: "PUT",
      body: JSON.stringify({ narrative, candidate_name: candidateName, fields }),
    });
    state.currentCall = await api(`/api/calls/${call.id}`);
    refreshCallHistoryData({ render: false });
    showToast(t("callSaved"));
  } catch (error) {
    showToast(error.message);
  }
}

async function downloadCallItem(itemId) {
  const call = state.currentCall;
  if (!call) return;
  try {
    const response = await api(`/api/calls/${call.id}/items/${itemId}/download`);
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") || "";
    const utf8 = disposition.match(/filename\*=utf-8''([^;]+)/i);
    let name = `${itemId}.md`;
    if (utf8) name = decodeURIComponent(utf8[1]);
    else {
      const plain = disposition.match(/filename="?([^";]+)"?/i);
      if (plain) name = plain[1];
    }
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  } catch (error) {
    showToast(error.message);
  }
}

async function cancelCall() {
  const call = state.currentCall;
  if (!call) return;
  const button = $("callCancelButton");
  setButtonBusy(button, true);
  try {
    state.currentCall = await api(`/api/calls/${call.id}/cancel`, { method: "POST" });
    renderCallDetail();
    refreshCallHistoryData({ render: false });
    showToast(t("callCancelledToast"));
  } catch (error) {
    showToast(error.message);
  } finally {
    setButtonBusy(button, false);
  }
}

async function retryCall() {
  const call = state.currentCall;
  if (!call) return;
  const button = $("callRetryButton");
  setButtonBusy(button, true);
  try {
    state.currentCall = await api(`/api/calls/${call.id}/process`, { method: "POST" });
    renderCallDetail();
    refreshCallHistoryData({ render: false });
    startCallPolling();
  } catch (error) {
    showToast(error.message);
  } finally {
    setButtonBusy(button, false);
  }
}

async function retryCallNotification() {
  const call = state.currentCall;
  if (!call) return;
  const button = $("retryCallNotificationButton");
  setButtonBusy(button, true);
  try {
    const result = await api(`/api/calls/${call.id}/retry-notification`, { method: "POST" });
    state.currentCall = result.call || state.currentCall;
    renderCallDetail();
    refreshCallHistoryData({ render: false });
    if (result.errors?.length) showToast(result.errors.join("\n"));
    else showToast(t(result.sent ? "feishuNotificationSent" : "feishuNotificationNotSent"));
  } catch (error) { showToast(error.message); }
  finally { setButtonBusy(button, false); }
}

function startCallPolling() {
  stopCallPolling();
  state.callPollTimer = setTimeout(pollCall, 2500);
}

async function pollCall() {
  if (!state.currentCall) return;
  const id = state.currentCall.id;
  try {
    const call = await api(`/api/calls/${id}`);
    // 已切换到简历筛选页时丢弃本轮结果，避免电话确认轮询在后台继续运行。
    if (routerCurrentView() !== "phone") return;
    if (!state.currentCall || state.currentCall.id !== id) return;
    state.currentCall = call;
    // 轮询重画保留展开/播放状态，避免处理中刷新打断正在听的录音。
    renderCallDetail({ preservePlayback: true });
    refreshCallHistoryData({ render: false });
    if (["queued", "running"].includes(call.status)) startCallPolling();
  } catch (error) {
    showToast(error.message);
    if (routerCurrentView() !== "phone") return;
    startCallPolling();
  }
}

export function init() {
  onChange(() => {
    if (routerCurrentView() === "phone") renderCallWorkbench();
  });
  $("callAudioFiles").addEventListener("change", (event) => {
    addPendingCallAudio(event.target.files);
    event.target.value = "";
  });
  const callAudioDrop = $("callAudioDrop");
  for (const eventName of ["dragenter", "dragover"]) {
    callAudioDrop.addEventListener(eventName, (event) => { event.preventDefault(); callAudioDrop.classList.add("dragging"); });
  }
  for (const eventName of ["dragleave", "drop"]) {
    callAudioDrop.addEventListener(eventName, (event) => { event.preventDefault(); callAudioDrop.classList.remove("dragging"); });
  }
  callAudioDrop.addEventListener("drop", (event) => addPendingCallAudio(event.dataTransfer.files));
  $("startCallProcessButton").addEventListener("click", startCallProcess);
  $("appendCallAudioButton").addEventListener("click", () => $("appendCallAudioFiles").click());
  $("appendCallAudioFiles").addEventListener("change", (event) => {
    appendCallAudio(event.target.files);
    event.target.value = "";
  });
  $("callCancelButton").addEventListener("click", cancelCall);
  $("callRetryButton").addEventListener("click", retryCall);
  $("retryCallNotificationButton").addEventListener("click", retryCallNotification);
  $("callJobLinkSelect").addEventListener("change", importCallJobFocus);
  callJobSelect = createCustomSelect({ wrap: $("callJobLinkSelectWrap"), select: $("callJobLinkSelect") });
  $("callItemDetailBack").addEventListener("click", closeCallItemDetail);
  $("callItemDetailPrev").addEventListener("click", () => stepCallItemDetail(-1));
  $("callItemDetailNext").addEventListener("click", () => stepCallItemDetail(1));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && $("callItemDetail").open) closeCallItemDetail();
  });
}
