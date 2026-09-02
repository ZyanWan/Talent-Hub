// =====================================================================
// 全局状态单对象。字段名 / 初始值 / 类型为前端唯一定义。
// 字段归属约定见 SOURCE_MAP.md §2.1：各模块只读写自己的字段，禁止跨模块写他人字段。
// 模块局部 UI 状态（如音频 Blob 缓存、软性维度选择、当前活动条目 id）不进入本对象。
// =====================================================================

export type Language = "zh-CN" | "en";

export interface GlobalState {
  // shell
  language: Language;
  toolStripOpen: boolean;
  // settings
  settings: Record<string, unknown> | null;
  clearAsrPending: boolean;
  clearFeishuSignPending: boolean;
  // history
  jobs: unknown[];
  archivedJobs: unknown[];
  historyScope: "recent" | "archived";
  historyTotals: { recent: number; archived: number };
  historyKind: "call" | "job";
  historyLoading: boolean;
  storageStats: Record<string, unknown> | null;
  callTasks: unknown[];
  callArchivedTasks: unknown[];
  callScope: "recent" | "archived";
  callTotals: { recent: number; archived: number };
  // screening
  currentJob: Record<string, unknown> | null;
  selectedResumes: File[];
  resultFilter: string;
  liveResultKeys: string[] | null;
  criteriaBase: Record<string, unknown> | null;
  pendingDeleteJob: Record<string, unknown> | null;
  pollTimer: ReturnType<typeof setTimeout> | null;
  // resume
  resumePreviewIndex: number;
  resumePreviewUrl: string | null;
  resumeRenderController: AbortController | null;
  resumeRenderCache: Map<string, unknown>;
  resumePrefetchController: AbortController | null;
  storedResumePreview: Record<string, unknown> | null;
  // phone
  currentCall: Record<string, unknown> | null;
  callPollTimer: ReturnType<typeof setTimeout> | null;
  pendingCallFiles: File[];
  pendingDeleteCall: Record<string, unknown> | null;
  // compare
  compareSelection: Set<string>;
  compareCancelKey: string | null;
  // preview
  previewKind: string | null;
  previewPayload: unknown;
  previewSheetIndex: number;
  previewRequest: unknown;
}

export const state: GlobalState = {
  language: localStorage.getItem("talentHub.language") === "en" ? "en" : "zh-CN",
  settings: null,
  jobs: [],
  archivedJobs: [],
  selectedResumes: [],
  currentJob: null,
  resultFilter: "all",
  compareSelection: new Set(),
  compareCancelKey: null,
  pollTimer: null,
  liveResultKeys: null,
  previewKind: null,
  previewPayload: null,
  previewSheetIndex: 0,
  previewRequest: null,
  resumePreviewIndex: 0,
  resumePreviewUrl: null,
  resumeRenderController: null,
  resumeRenderCache: new Map(),
  resumePrefetchController: null,
  storedResumePreview: null,
  historyScope: "recent",
  historyTotals: { recent: 0, archived: 0 },
  historyKind: "job",
  historyLoading: false,
  storageStats: null,
  clearAsrPending: false,
  clearFeishuSignPending: false,
  pendingDeleteJob: null,
  criteriaBase: null,
  toolStripOpen: false,
  callTasks: [],
  callArchivedTasks: [],
  callScope: "recent",
  callTotals: { recent: 0, archived: 0 },
  currentCall: null,
  callPollTimer: null,
  pendingCallFiles: [],
  pendingDeleteCall: null,
};
