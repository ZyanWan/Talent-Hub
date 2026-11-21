// 共享展示辅助：文件标识、体积、日期与任务环节文案的唯一实现。
// 视图与对话框直接复用，避免同一规则在多处各自维护。

import { getLanguage, t } from "./i18n";

/** 文件唯一标识：同名同大小同修改时间的文件视为同一份 */
export function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

/** 文件扩展名（小写，含点）；无扩展名时返回空串 */
export function fileSuffix(name: string): string {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index).toLowerCase() : "";
}

/** 文件体积文案 */
export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 日期文案：随当前语言切换格式 */
export function formatDate(value: string | undefined): string {
  if (!value) return "";
  const locale = getLanguage() === "en" ? "en-US" : "zh-CN";
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

/** 视图标题：默认岗位名回退到通用标题 */
export function displayJobTitle(title: string): string {
  return !title || ["岗位候选人筛选", "Candidate Screening"].includes(title) ? t("jobTitle") : title;
}

/** 处理环节文案 */
export function stageLabel(stage: string | undefined): string {
  if (getLanguage() === "zh-CN") {
    const exactZh: Record<string, string> = {
      "JD 已就绪": "岗位说明已就绪",
      "解析岗位 JD": "解析岗位说明",
      "生成并校验 Excel": "生成并校验表格",
      "上传岗位 JD": "上传岗位说明",
    };
    return exactZh[stage ?? ""] || stage || t("preparingTask");
  }
  const exact: Record<string, string> = {
    "等待上传": "Waiting for files",
    "JD 已就绪": "Job brief ready",
    "等待开始": "Waiting to start",
    "上次运行被中断": "Previous run interrupted",
    "正在停止任务": "Stopping task",
    "解析岗位 JD": "Parsing job brief",
    "生成岗位筛选标准": "Building screening criteria",
    "评估候选人": "Evaluating candidates",
    "生成并校验 Excel": "Building and validating workbook",
    "筛选完成": "Screening complete",
    "已取消": "Cancelled",
    "任务失败": "Task failed",
    "上传岗位 JD": "Uploading job brief",
    "等待校准筛选标准": "Awaiting criteria review",
    "筛选标准已校准": "Criteria calibrated",
    "准备处理": "Preparing",
    "处理完成": "Processing complete",
    "已完成": "Done",
  };
  if (exact[stage ?? ""]) return exact[stage ?? ""];
  const uploaded = String(stage ?? "").match(/^已上传 (\d+) 份简历$/);
  if (uploaded) return `${uploaded[1]} resumes uploaded`;
  const evaluating = String(stage ?? "").match(/^评估候选人 (\d+)\/(\d+)$/);
  if (evaluating) return `Evaluating candidates ${evaluating[1]}/${evaluating[2]}`;
  const processing = String(stage ?? "").match(/^处理中 (\d+)\/(\d+)$/);
  if (processing) return `Processing ${processing[1]}/${processing[2]}`;
  return t("stageFallback");
}
