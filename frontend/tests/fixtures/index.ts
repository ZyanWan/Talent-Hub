// 测试数据夹具（TypeScript）。
// 覆盖：设置、任务历史、候选人评估结果、电话确认结果、预览内容、音频与错误响应。
// 字段结构对应后端 API 契约，供契约测试与视觉回归测试复用。

/** 公开配置（GET /api/bootstrap settings，永不包含明文密钥） */
export interface PublicSettings {
  base_url: string;
  api_key_configured: boolean;
  model: string;
  max_parallel: number;
  request_timeout: number;
  ocr_executable: string;
  asr_configured: boolean;
  retain_resume_text: boolean;
  call_qa_records: boolean;
  feishu_push_enabled: boolean;
  feishu_webhook_url: string;
  feishu_sign_configured: boolean;
  is_ready: boolean;
  ocr: { ready: boolean; languages: string[]; message: string };
}

export function publicSettings(overrides: Partial<PublicSettings> = {}): PublicSettings {
  return {
    base_url: "https://api.example.com/v1",
    api_key_configured: true,
    model: "gpt-4o",
    max_parallel: 4,
    request_timeout: 120,
    ocr_executable: "",
    asr_configured: true,
    retain_resume_text: true,
    call_qa_records: true,
    feishu_push_enabled: false,
    feishu_webhook_url: "",
    feishu_sign_configured: false,
    is_ready: true,
    ocr: { ready: true, languages: ["chi_sim", "eng"], message: "" },
    ...overrides,
  };
}

/** Job 摘要（public_job_summary） */
export interface JobSummary {
  id: string;
  title: string;
  status: "draft" | "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled";
  stage: string;
  progress: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  completed: number;
  total: number;
  reviewed: number;
  elapsed_seconds: number;
}

export function jobSummary(overrides: Partial<JobSummary> = {}): JobSummary {
  return {
    id: "job-1",
    title: "候选人筛选-2026-08-31",
    status: "completed",
    stage: "评估完成",
    progress: 100,
    created_at: "2026-08-31T10:00:00+08:00",
    updated_at: "2026-08-31T10:05:00+08:00",
    archived_at: null,
    completed: 5,
    total: 5,
    reviewed: 5,
    elapsed_seconds: 300,
    ...overrides,
  };
}

/** Call 摘要（public_call_summary） */
export interface CallSummary {
  id: string;
  title: string;
  job_title: string;
  status: "draft" | "queued" | "running" | "done" | "failed" | "cancelled";
  stage: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  item_count: number;
}

export function callSummary(overrides: Partial<CallSummary> = {}): CallSummary {
  return {
    id: "call-1",
    title: "电话确认-2026-08-31",
    job_title: "候选人筛选-2026-08-31",
    status: "done",
    stage: "整理完成",
    created_at: "2026-08-31T11:00:00+08:00",
    updated_at: "2026-08-31T11:10:00+08:00",
    archived_at: null,
    item_count: 3,
    ...overrides,
  };
}

/** 候选人评估结果项（job.results[]） */
export interface CandidateResult {
  candidate_name: string;
  source_file: string;
  conclusion: "A优先约面" | "B电话确认" | "C不推进";
  one_line: string;
  blockers: string[];
  next_action: string;
}

export function candidateResult(overrides: Partial<CandidateResult> = {}): CandidateResult {
  return {
    candidate_name: "张三",
    source_file: "张三-产品经理.pdf",
    conclusion: "A优先约面",
    one_line: "8 年 B 端产品经验，与岗位匹配度高",
    blockers: [],
    next_action: "优先约面",
    ...overrides,
  };
}

/** 电话条目（call.items[]） */
export interface CallItem {
  id: string;
  audio_file: string;
  candidate_name: string;
  stage: string;
  status: "queued" | "transcribing" | "summarizing" | "done" | "failed" | "cancelled";
  progress: number;
  error: string | null;
  summary: unknown;
}

export function callItem(overrides: Partial<CallItem> = {}): CallItem {
  return {
    id: "item-1",
    audio_file: "张三-电话录音.m4a",
    candidate_name: "张三",
    stage: "整理完成",
    status: "done",
    progress: 100,
    error: null,
    summary: {
      narrative: "候选人表达清晰，具备岗位所需经验。",
      fields: [{ key: "k1", label: "岗位匹配度", value: "高", status: "满足", note: "" }],
      facts: [],
      doubts: [],
      transcript: "",
    },
    ...overrides,
  };
}

/** 错误响应（{detail: ...}） */
export function errorDetail(detail: string): { detail: string } {
  return { detail };
}
