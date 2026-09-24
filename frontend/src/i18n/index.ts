// i18n：语言状态与消息查找。语言集合仅 zh-CN / en，state.language 是唯一事实来源。
// t(key, values) 缺失 key 时返回 key 并 console.warn 一次；切换语言经 onChange 广播。

import { messages } from "./messages";
import { state, type Language } from "../state";

export type { Language };

export function getLanguage(): Language {
  return state.language;
}

/** 切换语言：写 state.language、持久化并广播 */
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
