// =====================================================================
// API client：请求/响应统一封装
//   - 请求强制 X-App-Token（meta[name="app-token"]，模块加载时一次读取）
//   - string body 自动 Content-Type: application/json
//   - 错误响应解析 {detail}，按语言透传（zh 直接透传 / en 且 ASCII 透传 / 否则通用文案）
//   - content-type 含 "application/json" → json()，否则返回原始 Response（Blob/下载契约）
// =====================================================================

import { getLanguage, setLanguage, t } from "../i18n";

/** 供契约测试控制语言（转发到 i18n 语言状态） */
export function setApiLanguage(language: "zh-CN" | "en"): void {
  setLanguage(language);
}

const TOKEN =
  typeof document !== "undefined"
    ? (document.querySelector('meta[name="app-token"]') as HTMLMetaElement | null)?.content ?? ""
    : "";

function requestFailedText(status: number): string {
  return t("requestFailed", { status });
}

export type ApiOptions = Omit<RequestInit, "headers"> & { headers?: HeadersInit };

export async function api<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set("X-App-Token", TOKEN);
  if (options.body && typeof options.body === "string") {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
    let message = requestFailedText(response.status);
    try {
      const detail = ((await response.json()) as { detail?: string }).detail;
      if (detail && (getLanguage() === "zh-CN" || /^[\x00-\x7F]*$/.test(detail))) {
        message = detail;
      }
    } catch {
      // 非 JSON 错误体：保留通用文案
    }
    throw new Error(message);
  }
  const type = response.headers.get("content-type") || "";
  return (type.includes("application/json") ? response.json() : response) as T;
}
