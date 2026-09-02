// =====================================================================
// i18n：语言状态与消息查找
//   - 语言集合仅 zh-CN / en；语言状态以 src/state 的 state.language 为唯一事实来源
//   - t(key, values)：缺失 key 返回 key 并 console.warn 一次
//   - onChange/emitLanguageChange 语言切换广播
// =====================================================================

import { messages } from "./messages";
import { state, type Language } from "../state";

export type { Language };

export function getLanguage(): Language {
  return state.language;
}

/** 切换语言并广播（写 state.language + 持久化 + 广播） */
export function setLanguage(language: Language): void {
  if (language === state.language) return;
  state.language = language;
  if (typeof localStorage !== "undefined") {
    localStorage.setItem("talentHub.language", language);
  }
  emitLanguageChange();
}

const changeListeners: Array<() => void> = [];

export function onChange(listener: () => void): void {
  changeListeners.push(listener);
}

export function emitLanguageChange(): void {
  for (const listener of changeListeners) listener();
}

const warnedKeys = new Set<string>();

export function t(key: string, values: Record<string, string | number> = {}): string {
  let value = messages[state.language][key] || messages["zh-CN"][key] || key;
  if (value === key && !warnedKeys.has(key)) {
    warnedKeys.add(key);
    console.warn(`[i18n] Missing message key "${key}"`);
  }
  for (const [name, replacement] of Object.entries(values)) {
    value = value.replaceAll(`{${name}}`, String(replacement));
  }
  return value;
}
