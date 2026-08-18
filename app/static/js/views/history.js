"use strict";

import { state } from "../core/state.js";
import { t, onChange } from "../core/i18n.js";
import { api } from "../core/api.js";
import { $ } from "../core/dom.js";
import {
  callStatusLabel,
  createSvgIcon,
  displayJobTitle,
  formatDate,
  formatStorageSize,
  setButtonBusy,
  showToast,
  statusLabel,
} from "../core/utils.js";
import { loadJob, renderProgress, renderResults, resetWorkspace } from "./screening.js";
import { renderCallWorkbench, resetCallPreparation, selectCall } from "./phone.js";

let historyCloseTimer = null;

function openHistoryDialog() {
  const dialog = $("historyDialog");
  if (dialog.open) return;
  state.historyKind = document.body.dataset.view === "phone" ? "call" : "job";
  clearTimeout(historyCloseTimer);
  dialog.showModal();
  renderHistory();
  requestAnimationFrame(() => requestAnimationFrame(() => dialog.classList.add("is-visible")));
  if (state.historyKind === "call") refreshCallHistoryData();
  else refreshHistoryData();
}

export function closeHistoryDialog() {
  const dialog = $("historyDialog");
  if (!dialog.open || !dialog.classList.contains("is-visible")) {
    if (dialog.open) dialog.close();
    return;
  }
  dialog.classList.remove("is-visible");
  const finish = () => {
    clearTimeout(historyCloseTimer);
    if (dialog.open) dialog.close();
  };
  dialog.addEventListener("transitionend", (event) => {
    if (event.target === dialog && event.propertyName === "transform") finish();
  }, { once: true });
  historyCloseTimer = setTimeout(finish, 360);
}

export function renderHistory() {
  const host = $("jobHistory");
  host.replaceChildren();
  const isCall = state.historyKind === "call";
  const scope = isCall ? state.callScope : state.historyScope;
  const archived = scope === "archived";
  const items = isCall
    ? (archived ? state.callArchivedTasks : state.callTasks)
    : (archived ? state.archivedJobs : state.jobs);
  const totals = isCall ? state.callTotals : state.historyTotals;
  $("historyTitle").textContent = t(isCall ? "phoneRecord" : "taskHistory");
  $("historyStorage").hidden = isCall;
  for (const tab of $("historyTabs").querySelectorAll("button[data-history-scope]")) {
    const active = tab.dataset.historyScope === scope;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  }
  $("recentHistoryCount").textContent = totals.recent;
  $("archivedHistoryCount").textContent = totals.archived;
  host.setAttribute("aria-label", t(archived ? "archivedTab" : "recentTasks"));

  for (const item of items) {
    const active = isCall ? state.currentCall?.id === item.id : state.currentJob?.id === item.id;
    const row = document.createElement("div");
    row.className = `history-row${active ? " active" : ""}`;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "history-item";
    if (active) button.setAttribute("aria-current", "page");
    const title = document.createElement("strong");
    title.textContent = item.title ? (isCall ? item.title : displayJobTitle(item.title)) : t("untitledJob");
    const meta = document.createElement("span");
    const itemMeta = [isCall ? callStatusLabel(item) : statusLabel(item)];
    if (isCall && item.job_title) itemMeta.push(item.job_title);
    itemMeta.push(formatDate(item.updated_at));
    meta.textContent = itemMeta.filter(Boolean).join(" · ");
    button.append(title, meta);
    button.addEventListener("click", () => {
      closeHistoryDialog();
      if (isCall) selectCall(item.id);
      else loadJob(item.id);
    });
    const more = document.createElement("button");
    more.type = "button";
    more.className = "history-more";
    more.title = t("moreActions");
    more.setAttribute("aria-label", t("moreActions"));
    more.setAttribute("aria-haspopup", "menu");
    more.setAttribute("aria-expanded", "false");
    more.disabled = state.historyLoading;
    more.append(createSvgIcon(["M5 12h.01M12 12h.01M19 12h.01"]));

    const menu = document.createElement("div");
    menu.className = "history-menu";
    menu.id = `historyMenu-${isCall ? "call" : "job"}-${item.id}`;
    menu.setAttribute("role", "menu");
    more.setAttribute("aria-controls", menu.id);
    menu.hidden = true;
    const lifecycle = document.createElement("button");
    lifecycle.type = "button";
    lifecycle.setAttribute("role", "menuitem");
    lifecycle.disabled = ["queued", "running"].includes(item.status);
    lifecycle.append(
      archived
        ? createSvgIcon(["M3 12a9 9 0 1 0 3-6.7L3 8", "M3 3v5h5"])
        : createSvgIcon(["M21 8v13H3V8", "M1 3h22v5H1z", "M10 12h4"]),
      document.createTextNode(t(archived ? "restoreJob" : "archiveJob")),
    );
    lifecycle.addEventListener("click", () => {
      if (isCall) changeCallArchiveState(item, archived ? "restore" : "archive");
      else changeJobArchiveState(item, archived ? "restore" : "archive");
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.setAttribute("role", "menuitem");
    remove.className = "danger";
    remove.disabled = ["queued", "running"].includes(item.status);
    remove.append(
      createSvgIcon(["M3 6h18", "M8 6V4h8v2", "M19 6l-1 15H6L5 6", "M10 11v6M14 11v6"]),
      document.createTextNode(t("deleteJob")),
    );
    remove.addEventListener("click", () => isCall ? openCallDeleteDialog(item) : openDeleteJobDialog(item));
    menu.append(lifecycle, remove);

    more.addEventListener("click", (event) => {
      event.stopPropagation();
      const willOpen = menu.hidden;
      closeHistoryMenus();
      menu.hidden = !willOpen;
      more.setAttribute("aria-expanded", String(willOpen));
      if (willOpen) {
        menu.classList.remove("opens-up");
        requestAnimationFrame(() => {
          const menuBounds = menu.getBoundingClientRect();
          const listBounds = host.getBoundingClientRect();
          menu.classList.toggle("opens-up", menuBounds.bottom > listBounds.bottom);
          lifecycle.focus();
        });
      }
    });
    row.append(button, more, menu);
    host.append(row);
  }

  const empty = $("historyEmptyState");
  empty.replaceChildren();
  empty.hidden = items.length > 0;
  host.style.flex = items.length ? "" : "0 1 auto";
  if (!empty.hidden) {
    if (state.historyLoading) {
      empty.textContent = t(isCall ? "callHistoryLoading" : "historyLoading");
    } else {
      empty.append(
        createSvgIcon(["M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"]),
        document.createTextNode(t(isCall
          ? (archived ? "callHistoryEmptyArchived" : "callHistoryEmptyRecent")
          : (archived ? "historyEmptyArchived" : "historyEmptyRecent"))),
      );
    }
  }
  $("historyLoadMore").hidden = state.historyLoading || items.length >= totals[scope];
  if (!isCall) renderStorageUsage();
}

function closeHistoryMenus() {
  for (const menu of $("jobHistory").querySelectorAll(".history-menu")) menu.hidden = true;
  for (const button of $("jobHistory").querySelectorAll(".history-more")) {
    button.setAttribute("aria-expanded", "false");
  }
}

function renderStorageUsage() {
  const host = $("historyStorage");
  if (!state.storageStats) {
    host.textContent = t("storageLoading");
  } else if (!state.storageStats.job_count) {
    host.textContent = t("storageEmpty");
  } else {
    host.textContent = t("storageUsage", { size: formatStorageSize(state.storageStats.jobs_bytes) });
  }
}

async function fetchHistory(scope, append = false) {
  const collection = scope === "archived" ? state.archivedJobs : state.jobs;
  const offset = append ? collection.length : 0;
  const payload = await api(`/api/jobs?scope=${scope}&limit=50&offset=${offset}`);
  const next = append ? [...collection, ...payload.jobs] : payload.jobs;
  if (scope === "archived") state.archivedJobs = next;
  else state.jobs = next;
  state.historyTotals[scope] = payload.total;
}

async function fetchStorageUsage() {
  state.storageStats = await api("/api/storage");
}

async function refreshHistoryData() {
  if (state.historyLoading) return;
  state.historyLoading = true;
  renderHistory();
  try {
    await Promise.all([fetchHistory("recent"), fetchHistory("archived"), fetchStorageUsage()]);
  } catch (error) {
    showToast(error.message);
  } finally {
    state.historyLoading = false;
    renderHistory();
  }
}

async function loadMoreHistory() {
  if (state.historyLoading) return;
  state.historyLoading = true;
  renderHistory();
  try {
    if (state.historyKind === "call") await fetchCallHistory(state.callScope, true);
    else await fetchHistory(state.historyScope, true);
  } catch (error) {
    showToast(error.message);
  } finally {
    state.historyLoading = false;
    renderHistory();
  }
}

async function changeJobArchiveState(job, action) {
  closeHistoryMenus();
  try {
    const updated = await api(`/api/jobs/${job.id}/${action}`, { method: "POST" });
    if (state.currentJob?.id === job.id) {
      state.currentJob = { ...state.currentJob, ...updated };
      if (state.currentJob.status === "completed") renderResults(state.currentJob);
      else renderProgress(state.currentJob);
    }
    await refreshHistoryData();
    showToast(t(action === "archive" ? "archivedToast" : "restoredToast"));
  } catch (error) {
    showToast(error.message);
  }
}

function updateDeleteJobDialog() {
  const job = state.pendingDeleteJob;
  if (!job) return;
  $("deleteJobLead").textContent = t("deleteJobLead", {
    name: job.title ? displayJobTitle(job.title) : t("untitledJob"),
  });
  const button = $("confirmDeleteJobButton");
  if (!button.disabled) button.textContent = t("deletePermanently");
}

function openDeleteJobDialog(job) {
  closeHistoryMenus();
  state.pendingDeleteJob = job;
  updateDeleteJobDialog();
  const dialog = $("deleteJobDialog");
  dialog.showModal();
  requestAnimationFrame(() => {
    if (dialog.open) dialog.classList.add("is-visible");
  });
}

async function deletePendingJob() {
  const job = state.pendingDeleteJob;
  if (!job) return;
  const button = $("confirmDeleteJobButton");
  const cancel = $("cancelDeleteJobButton");
  button.disabled = true;
  cancel.disabled = true;
  button.textContent = t("deleting");
  try {
    await api(`/api/jobs/${job.id}`, { method: "DELETE" });
    $("deleteJobDialog").close();
    if (state.currentJob?.id === job.id) resetWorkspace();
    await refreshHistoryData();
    showToast(t("deletedToast"));
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
    cancel.disabled = false;
    button.textContent = t("deletePermanently");
  }
}

async function fetchCallHistory(scope, append = false) {
  const collection = scope === "archived" ? state.callArchivedTasks : state.callTasks;
  const offset = append ? collection.length : 0;
  const payload = await api(`/api/calls?scope=${scope}&limit=50&offset=${offset}`);
  const next = append ? [...collection, ...payload.calls] : payload.calls;
  if (scope === "archived") state.callArchivedTasks = next;
  else state.callTasks = next;
  state.callTotals[scope] = payload.total;
}

export async function refreshCallHistoryData({ render = true } = {}) {
  if (state.historyLoading && render) return;
  if (render) {
    state.historyLoading = true;
    renderHistory();
  }
  try {
    await Promise.all([fetchCallHistory("recent"), fetchCallHistory("archived")]);
  } catch (error) {
    showToast(error.message);
  } finally {
    if (render) {
      state.historyLoading = false;
      if ($("historyDialog").open && state.historyKind === "call") renderHistory();
    }
  }
}

async function changeCallArchiveState(call, action) {
  if (!call || ["queued", "running"].includes(call.status)) return;
  closeHistoryMenus();
  try {
    const updated = await api(`/api/calls/${call.id}/${action}`, { method: "POST" });
    if (state.currentCall?.id === call.id) {
      state.currentCall = { ...state.currentCall, ...updated };
      renderCallWorkbench();
    }
    await refreshCallHistoryData({ render: $("historyDialog").open && state.historyKind === "call" });
    showToast(t(action === "archive" ? "callArchivedToast" : "callRestoredToast"));
  } catch (error) {
    showToast(error.message);
  }
}

function openCallDeleteDialog(call = state.currentCall) {
  if (!call || ["queued", "running"].includes(call.status)) return;
  state.pendingDeleteCall = call;
  $("callDeleteLead").textContent = t("callDeleteLead", { name: call.title || t("untitledJob") });
  const dialog = $("callDeleteDialog");
  dialog.showModal();
  requestAnimationFrame(() => {
    if (dialog.open) dialog.classList.add("is-visible");
  });
}

async function deletePendingCall() {
  const call = state.pendingDeleteCall;
  if (!call) return;
  const button = $("confirmDeleteCallButton");
  setButtonBusy(button, true);
  try {
    await api(`/api/calls/${call.id}`, { method: "DELETE" });
    $("callDeleteDialog").close();
    if (state.currentCall?.id === call.id) {
      localStorage.removeItem("talentHub.lastCall");
      resetCallPreparation();
    }
    await refreshCallHistoryData({ render: $("historyDialog").open && state.historyKind === "call" });
    showToast(t("callDeletedToast"));
  } catch (error) {
    showToast(error.message);
  } finally {
    setButtonBusy(button, false);
  }
}

export function init() {
  onChange(() => {
    renderHistory();
    if ($("deleteJobDialog").open) updateDeleteJobDialog();
    if ($("callDeleteDialog").open && state.pendingDeleteCall) {
      $("callDeleteLead").textContent = t("callDeleteLead", { name: state.pendingDeleteCall.title || t("untitledJob") });
    }
  });
  $("openHistoryButton").addEventListener("click", openHistoryDialog);
  $("closeHistoryButton").addEventListener("click", closeHistoryDialog);
  $("historyDialog").addEventListener("cancel", (event) => { event.preventDefault(); closeHistoryDialog(); });
  $("historyDialog").addEventListener("click", (event) => { if (event.target === $("historyDialog")) closeHistoryDialog(); });
  $("historyTabs").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-history-scope]");
    if (!button) return;
    const scopeKey = state.historyKind === "call" ? "callScope" : "historyScope";
    if (button.dataset.historyScope === state[scopeKey]) return;
    state[scopeKey] = button.dataset.historyScope;
    closeHistoryMenus();
    renderHistory();
  });
  $("historyTabs").addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabs = [...event.currentTarget.querySelectorAll("button[data-history-scope]")];
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
  $("historyLoadMore").addEventListener("click", loadMoreHistory);
  $("confirmDeleteJobButton").addEventListener("click", deletePendingJob);
  $("deleteJobDialog").addEventListener("cancel", (event) => {
    if ($("confirmDeleteJobButton").disabled) event.preventDefault();
  });
  $("deleteJobDialog").addEventListener("close", () => {
    $("deleteJobDialog").classList.remove("is-visible");
    state.pendingDeleteJob = null;
  });
  $("confirmDeleteCallButton").addEventListener("click", deletePendingCall);
  $("callDeleteDialog").addEventListener("cancel", (event) => {
    if ($("confirmDeleteCallButton").disabled) event.preventDefault();
  });
  $("callDeleteDialog").addEventListener("close", () => {
    $("callDeleteDialog").classList.remove("is-visible");
    state.pendingDeleteCall = null;
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".history-row")) closeHistoryMenus();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("deleteJobDialog").open) closeHistoryMenus();
  });
}
