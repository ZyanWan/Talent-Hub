"use strict";

import { state } from "./js/core/state.js";
import { emitLanguageChange, t } from "./js/core/i18n.js";
import { api } from "./js/core/api.js";
import { $ } from "./js/core/dom.js";
import { hideStartupLoading, showToast } from "./js/core/utils.js";
import { show as routerShow } from "./js/core/router.js";
import { openSettings, renderOcrStatus, renderSettingsStatus } from "./js/dialogs/settings.js";
import { renderHistory } from "./js/views/history.js";
import { openPhoneView, selectCall } from "./js/views/phone.js";
import { loadJob, renderSelectedMaterials, resetWorkspace } from "./js/views/screening.js";

export function applyStaticLanguage() {
  document.documentElement.lang = state.language;
  document.title = t("documentTitle");
  for (const element of document.querySelectorAll("[data-i18n]")) element.textContent = t(element.dataset.i18n);
  for (const element of document.querySelectorAll("[data-i18n-title]")) element.title = t(element.dataset.i18nTitle);
  for (const element of document.querySelectorAll("[data-i18n-aria]")) element.setAttribute("aria-label", t(element.dataset.i18nAria));
  for (const element of document.querySelectorAll("[data-i18n-placeholder]")) element.placeholder = t(element.dataset.i18nPlaceholder);
  for (const button of $("languageSwitch").querySelectorAll("button")) {
    const active = button.dataset.language === state.language;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  $("languageSwitch").dataset.active = state.language;
  $("liveResults").dataset.emptyLabel = t("emptyLive");
  if (!state.settings) $("configStatus").textContent = t("configLoading");
}

export function setLanguage(language) {
  const next = language === "en" ? "en" : "zh-CN";
  if (next === state.language) return;
  state.language = next;
  localStorage.setItem("talentHub.language", state.language);

  // 语言切换广播：各模块已在 init() 注册自己的重渲染监听。
  const update = () => {
    applyStaticLanguage();
    emitLanguageChange();
  };

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (typeof document.startViewTransition === "function" && !reducedMotion) {
    document.startViewTransition(update);
  } else if (reducedMotion) {
    update();
  } else {
    document.body.classList.add("is-language-fading");
    setTimeout(() => {
      try {
        update();
      } finally {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          document.body.classList.remove("is-language-fading");
        }));
      }
    }, 120);
  }
}

function toggleCreateMenu() {
  const menu = $("createMenu");
  menu.hidden = !menu.hidden;
  state.createMenuOpen = !menu.hidden;
}

function closeCreateMenu() {
  $("createMenu").hidden = true;
  state.createMenuOpen = false;
}

async function exitApplication() {
  if (!window.confirm(t("exitConfirm"))) return;
  try {
    await api("/api/shutdown", { method: "POST" });
    clearTimeout(state.pollTimer);
    clearTimeout(state.callPollTimer);
    state.callPollTimer = null;
    document.body.replaceChildren();
    const message = document.createElement("main");
    message.className = "shutdown-message";
    const title = document.createElement("h1");
    title.textContent = t("exitedTitle");
    const detail = document.createElement("p");
    detail.textContent = t("closePage");
    message.append(title, detail);
    document.body.append(message);
  } catch (error) { showToast(error.message); }
}

export async function bootstrap() {
  try {
    const data = await api("/api/bootstrap");
    state.settings = data.settings;
    state.jobs = data.jobs || [];
    state.historyTotals.recent = state.jobs.length;
    renderSettingsStatus();
    renderOcrStatus();
    renderHistory();
    renderSelectedMaterials();
    const activeTool = localStorage.getItem("talentHub.activeTool");
    if (activeTool === "phone") {
      openPhoneView({ reset: false });
      const lastCallId = localStorage.getItem("talentHub.lastCall");
      if (lastCallId) await selectCall(lastCallId);
      hideStartupLoading();
    } else {
      const lastJobId = localStorage.getItem("talentHub.lastJob");
      if (lastJobId) {
        // 直接按任务详情恢复，避免 bootstrap 只返回最近任务列表时漏判
        await loadJob(lastJobId).catch(() => localStorage.removeItem("talentHub.lastJob"));
      } else {
        localStorage.setItem("talentHub.activeTool", "screening");
        routerShow("screening");
        $("setupView").hidden = false;
        hideStartupLoading();
      }
    }
    if (!state.settings.is_ready) openSettings();
  } catch (error) {
    showToast(error.message);
    routerShow("screening");
    $("setupView").hidden = false;
    hideStartupLoading();
  }
}

export function init() {
  $("languageSwitch").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-language]");
    if (button) setLanguage(button.dataset.language);
  });
  $("newJobButton").addEventListener("click", toggleCreateMenu);
  $("createMenu").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-menu]");
    if (!button) return;
    closeCreateMenu();
    if (button.dataset.menu === "phone") openPhoneView();
    else resetWorkspace();
  });
  document.addEventListener("click", (event) => {
    if (state.createMenuOpen && !event.target.closest("#createMenu") && !event.target.closest("#newJobButton")) {
      closeCreateMenu();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.createMenuOpen) closeCreateMenu();
  });
  document.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || event.detail === 0 || button.closest("dialog")) return;
    button.blur();
    requestAnimationFrame(() => document.querySelector("dialog[open]")?.focus());
  }, true);
  $("openSettingsButton").addEventListener("click", openSettings);
  $("exitAppButton").addEventListener("click", exitApplication);
}
