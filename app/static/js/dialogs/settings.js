"use strict";

import { state } from "../core/state.js";
import { t, onChange } from "../core/i18n.js";
import { api } from "../core/api.js";
import { $ } from "../core/dom.js";
import { setButtonBusy } from "../core/utils.js";

let settingsCloseTimer = null;
let settingsAnimationGeneration = 0;

export function renderSettingsStatus() {
  const ready = Boolean(state.settings?.is_ready);
  $("configDot").classList.toggle("ready", ready);
  $("configStatus").textContent = ready ? t("modelConnected", { model: state.settings.model }) : t("modelPending");
}

export function renderOcrStatus() {
  const host = $("ocrStatus");
  const ocr = state.settings?.ocr;
  host.classList.toggle("ready", Boolean(ocr?.ready));
  host.classList.toggle("error", Boolean(ocr && !ocr.ready));
  if (ocr?.ready) {
    const languageNames = { chi_sim: state.language === "en" ? "Simplified Chinese" : "简体中文", eng: state.language === "en" ? "English" : "英文" };
    const languages = (ocr.languages || []).map((item) => languageNames[item] || item).join(" + ");
    host.textContent = t("ocrReady", { languages });
  } else {
    const serverMessage = ocr?.message || "";
    host.textContent = state.language === "zh-CN" && serverMessage ? serverMessage : t("ocrMissing");
  }
}

export function openSettings() {
  const settings = state.settings || {};
  $("baseUrlInput").value = settings.base_url || "https://api.openai.com/v1";
  $("apiKeyInput").value = "";
  $("asrKeyInput").value = "";
  $("modelInput").value = settings.model || "";
  $("parallelInput").value = settings.max_parallel || 6;
  $("timeoutInput").value = settings.request_timeout || 180;
  $("ocrInput").value = settings.ocr_executable || "";
  $("retainTextInput").checked = settings.retain_resume_text !== false;
  $("qaRecordsInput").checked = settings.call_qa_records === true;
  renderOcrStatus();
  clearSettingsMessage();
  const dialog = $("settingsDialog");
  if (dialog.open) return;
  clearTimeout(settingsCloseTimer);
  const generation = ++settingsAnimationGeneration;
  dialog.showModal();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (dialog.open && generation === settingsAnimationGeneration) dialog.classList.add("is-visible");
  }));
}

function closeSettingsDialog() {
  const dialog = $("settingsDialog");
  settingsAnimationGeneration += 1;
  if (!dialog.open || !dialog.classList.contains("is-visible")) {
    if (dialog.open) dialog.close();
    return;
  }
  dialog.classList.remove("is-visible");
  const finish = () => {
    clearTimeout(settingsCloseTimer);
    dialog.removeEventListener("transitionend", onTransitionEnd);
    if (dialog.open) dialog.close();
  };
  const onTransitionEnd = (event) => {
    if (event.target === dialog && event.propertyName === "transform") finish();
  };
  dialog.addEventListener("transitionend", onTransitionEnd);
  settingsCloseTimer = setTimeout(finish, 320);
}

function settingsPayload() {
  const clearAsr = Boolean(state.clearAsrPending);
  state.clearAsrPending = false;
  return {
    base_url: $("baseUrlInput").value.trim(),
    api_key: $("apiKeyInput").value.trim(),
    asr_api_key: $("asrKeyInput").value.trim(),
    clear_asr: clearAsr,
    model: $("modelInput").value.trim(),
    max_parallel: Number($("parallelInput").value),
    request_timeout: Number($("timeoutInput").value),
    ocr_executable: $("ocrInput").value.trim(),
    retain_resume_text: $("retainTextInput").checked,
    call_qa_records: $("qaRecordsInput").checked,
  };
}

export function showSettingsMessage(message, error = false) {
  const host = $("settingsMessage");
  host.textContent = message;
  host.classList.toggle("error", error);
}

function clearSettingsMessage() {
  const host = $("settingsMessage");
  host.textContent = "";
  host.classList.remove("error");
}

async function testSettings() {
  const button = $("testSettingsButton");
  setButtonBusy(button, true);
  button.textContent = t("testing");
  try {
    const result = await api("/api/settings/test", { method: "POST", body: JSON.stringify(settingsPayload()) });
    showSettingsMessage(state.language === "en" ? t("connectionTestPassed") : (result.message || t("connectionTestPassed")), false);
  } catch (error) { showSettingsMessage(error.message, true); }
  finally { setButtonBusy(button, false); button.textContent = t("testConnection"); }
}

async function saveSettings(event) {
  event.preventDefault();
  const button = $("saveSettingsButton");
  setButtonBusy(button, true);
  button.textContent = t("saving");
  try {
    state.settings = await api("/api/settings", { method: "PUT", body: JSON.stringify(settingsPayload()) });
    renderSettingsStatus();
    renderOcrStatus();
    showSettingsMessage(t("settingsSaved"));
  } catch (error) { showSettingsMessage(error.message, true); }
  finally { setButtonBusy(button, false); button.textContent = t("saveSettings"); }
}

export function init() {
  onChange(() => {
    renderSettingsStatus();
    renderOcrStatus();
    clearSettingsMessage();
  });
  $("closeSettingsButton").addEventListener("click", closeSettingsDialog);
  $("settingsDialog").addEventListener("cancel", (event) => {
    event.preventDefault();
    closeSettingsDialog();
  });
  $("settingsForm").addEventListener("submit", saveSettings);
  $("testSettingsButton").addEventListener("click", testSettings);
  $("clearAsrButton").addEventListener("click", () => {
    $("asrKeyInput").value = "";
    state.clearAsrPending = true;
    $("settingsForm").requestSubmit();
  });
}
