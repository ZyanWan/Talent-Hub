import { describe, expect, it } from "vitest";
import { t } from "../../src/i18n";
import { messages } from "../../src/i18n/messages";

describe("国际化消息契约", () => {
  it("中英文消息键完全一致", () => {
    const zh = new Set(Object.keys(messages["zh-CN"]));
    const en = new Set(Object.keys(messages.en));

    expect([...zh].filter((key) => !en.has(key))).toEqual([]);
    expect([...en].filter((key) => !zh.has(key))).toEqual([]);
  });

  it("变量占位符能够替换", () => {
    expect(t("resumeSelectedMetaOne", { size: "2.3 MB" })).toBe("1 份 · 2.3 MB");
  });
});
