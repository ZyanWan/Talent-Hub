"use strict";

import { state } from "./state.js";
import { t } from "./i18n.js";

const token = document.querySelector('meta[name="app-token"]').content;

export async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("X-App-Token", token);
  if (options.body && typeof options.body === "string") headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
    let message = t("requestFailed", { status: response.status });
    try {
      const detail = (await response.json()).detail;
      if (detail && (state.language === "zh-CN" || /^[\x00-\x7F]*$/.test(detail))) message = detail;
    } catch (_) { /* empty */ }
    throw new Error(message);
  }
  const type = response.headers.get("content-type") || "";
  return type.includes("application/json") ? response.json() : response;
}
