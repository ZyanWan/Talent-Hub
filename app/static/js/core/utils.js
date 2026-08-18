"use strict";

import { state } from "./state.js";
import { t } from "./i18n.js";
import { $ } from "./dom.js";

export function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 3500);
}

export function setButtonBusy(button, busy) {
  button.classList.toggle("is-busy", busy);
  button.disabled = busy;
  if (busy) button.setAttribute("aria-busy", "true");
  else button.removeAttribute("aria-busy");
}

// 自定义下拉：判断菜单应向上还是向下弹出。以最近的滚动容器（dialog 等）底部为可用边界，
// 避免菜单超出容器边界把容器撑出垂直滚动条；无滚动容器时退回视口底部。
export function measureSelectFlip(trigger, menu) {
  const menuHeight = Math.min(menu.scrollHeight, 300);
  const triggerRect = trigger.getBoundingClientRect();
  let limit = window.innerHeight;
  let node = trigger.parentElement;
  while (node && node !== document.body) {
    if (/(auto|scroll|overlay)/.test(getComputedStyle(node).overflowY)) {
      limit = node.getBoundingClientRect().bottom;
      break;
    }
    node = node.parentElement;
  }
  return triggerRect.bottom + menuHeight + 8 > limit;
}

export function hideStartupLoading() {
  const el = $("startupLoading");
  if (el) el.hidden = true;
}

export function formatDate(value) {
  if (!value) return "";
  const locale = state.language === "en" ? "en-US" : "zh-CN";
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatStorageSize(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unitIndex = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const amount = value / (1024 ** unitIndex);
  return `${amount.toFixed(unitIndex > 1 && amount < 10 ? 1 : 0)} ${units[unitIndex]}`;
}

export function createSvgIcon(paths) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const pathData of paths) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    svg.append(path);
  }
  return svg;
}

export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (total < 60) return state.language === "en" ? `${total}s` : `${total} 秒`;
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  if (state.language === "en") return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
  return remainder ? `${minutes} 分 ${remainder} 秒` : `${minutes} 分钟`;
}

export function jobElapsed(job) {
  if (!["queued", "running"].includes(job.status) || !job.evaluation_started_at) {
    return Number(job.elapsed_seconds) || 0;
  }
  const live = (Date.now() - new Date(job.evaluation_started_at).getTime()) / 1000;
  return Math.max(Number(job.elapsed_seconds) || 0, live);
}

export function stageLabel(stage) {
  if (state.language === "zh-CN") {
    const exactZh = {
      "JD 已就绪": "岗位说明已就绪", "解析岗位 JD": "解析岗位说明",
      "生成并校验 Excel": "生成并校验表格", "上传岗位 JD": "上传岗位说明",
    };
    return exactZh[stage] || stage || t("preparingTask");
  }
  const exact = {
    "等待上传": "Waiting for files", "JD 已就绪": "Job brief ready", "等待开始": "Waiting to start",
    "上次运行被中断": "Previous run interrupted", "正在停止任务": "Stopping task",
    "解析岗位 JD": "Parsing job brief", "生成岗位筛选标准": "Building screening criteria",
    "评估候选人": "Evaluating candidates", "生成并校验 Excel": "Building and validating workbook",
    "筛选完成": "Screening complete", "已取消": "Cancelled", "任务失败": "Task failed",
    "上传岗位 JD": "Uploading job brief", "等待校准筛选标准": "Awaiting criteria review",
    "筛选标准已校准": "Criteria calibrated",
    "准备处理": "Preparing", "处理完成": "Processing complete", "已完成": "Done",
  };
  if (exact[stage]) return exact[stage];
  let match = String(stage || "").match(/^已上传 (\d+) 份简历$/);
  if (match) return `${match[1]} resumes uploaded`;
  match = String(stage || "").match(/^评估候选人 (\d+)\/(\d+)$/);
  if (match) return `Evaluating candidates ${match[1]}/${match[2]}`;
  match = String(stage || "").match(/^处理中 (\d+)\/(\d+)$/);
  if (match) return `Processing ${match[1]}/${match[2]}`;
  return t("stageFallback");
}

export function displayJobTitle(title) {
  return !title || ["岗位候选人筛选", "Candidate Screening"].includes(title) ? t("jobTitle") : title;
}

export function statusLabel(job) {
  return {
    draft: t("statusDraft"), queued: t("statusQueued"), waiting: t("statusWaiting"),
    running: stageLabel(job.stage), completed: t("statusCompleted"),
    failed: t("statusFailed"), cancelled: t("statusCancelled"),
  }[job.status] || job.status;
}

export function conclusionClass(conclusion) {
  return conclusion.startsWith("A") ? "a" : conclusion.startsWith("B") ? "b" : "c";
}

export function conclusionLabel(conclusion) {
  if (conclusion.startsWith("A")) return t("conclusionA");
  if (conclusion.startsWith("B")) return t("conclusionB");
  return t("conclusionC");
}

export function renderErrors(elementId, errors) {
  const host = $(elementId);
  host.hidden = !errors?.length;
  host.textContent = errors?.length ? errors.join("\n") : "";
}

export function callStatusLabel(call) {
  return {
    draft: t("callStatusDraft"), queued: t("callStatusQueued"), running: t("callStatusRunning"),
    done: t("callStatusDone"), failed: t("callStatusFailed"), cancelled: t("callStatusCancelled"),
  }[call.status] || call.status;
}

export function callItemStatusLabel(status) {
  return {
    queued: t("callStatusQueued"), transcribing: t("callStatusTranscribing"),
    summarizing: t("callStatusSummarizing"), done: t("callStatusDone"),
    failed: t("callStatusFailed"), cancelled: t("callStatusCancelled"),
  }[status] || status;
}

export function callStatusBadgeClass(status) {
  return {
    draft: "is-waiting", queued: "is-waiting", running: "is-running", transcribing: "is-running",
    summarizing: "is-running", done: "is-done", failed: "is-failed", cancelled: "is-muted",
  }[status] || "";
}

export function defaultCallTitle() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return t("callDefaultTitle", { date });
}

export function fileSuffix(file) {
  const index = file.name.lastIndexOf(".");
  return index >= 0 ? file.name.slice(index).toLowerCase() : "";
}
