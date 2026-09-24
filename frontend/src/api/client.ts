// API client。所有请求强制携带 X-App-Token（模块加载时从 meta[name="app-token"] 读取一次）。
// string body 自动置 application/json；错误响应取 {detail} 按语言透传；content-type 非 JSON 时返回
// 原始 Response，供 Blob 与下载消费。

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
