// 全局状态单对象：字段名、类型与初始值的唯一定义处。
// 各模块只读写自己的字段；模块局部 UI 状态（音频 Blob 缓存、维度选择、活动条目 id）不进入本对象。

export type Language = "zh-CN" | "en";

export interface GlobalState {
  // shell
  language: Language;
  // settings
  settings: Record<string, unknown> | null;
  // history
  jobs: unknown[];
  historyTotals: { recent: number; archived: number };
  // screening
  currentJob: Record<string, unknown> | null;
  selectedResumes: File[];
  resultFilter: string;
  pollTimer: ReturnType<typeof setTimeout> | null;
  // resume
  resumeRenderCache: Map<string, unknown>;
  // phone
  currentCall: Record<string, unknown> | null;
  callPollTimer: ReturnType<typeof setTimeout> | null;
  pendingCallFiles: File[];
  // compare
  compareSelection: Set<string>;
}

export const state: GlobalState = {
  language: localStorage.getItem("talentHub.language") === "en" ? "en" : "zh-CN",
  settings: null,
  jobs: [],
  selectedResumes: [],
  currentJob: null,
  resultFilter: "all",
  compareSelection: new Set(),
  pollTimer: null,
  resumeRenderCache: new Map(),
  historyTotals: { recent: 0, archived: 0 },
  currentCall: null,
  callPollTimer: null,
  pendingCallFiles: [],
};
