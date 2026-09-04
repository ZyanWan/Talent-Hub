import { t } from "./i18n";

export interface CallTitleSource {
  title?: unknown;
  title_mode?: unknown;
}

const DEFAULT_CALL_TITLE_PATTERNS = [
  /^(\d{4}-\d{2}-\d{2}) 电话确认$/,
  /^Phone screening · (\d{4}-\d{2}-\d{2})$/,
];

export function displayCallTitle(call: CallTitleSource | null | undefined): string {
  const title = String(call?.title ?? "").trim();
  const defaultMatch = DEFAULT_CALL_TITLE_PATTERNS
    .map((pattern) => title.match(pattern))
    .find(Boolean);
  const isAuto = call?.title_mode === "auto" || (call?.title_mode == null && Boolean(defaultMatch));
  if (isAuto && defaultMatch) return t("callDefaultTitle", { date: defaultMatch[1] });
  return title || t("untitledJob");
}
