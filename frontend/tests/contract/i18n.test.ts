import { describe, expect, it, vi } from "vitest";
import { messages } from "../../src/i18n/messages";
import { t } from "../../src/i18n";

// =====================================================================
// i18n 消息表契约：src/i18n/messages.ts 是唯一消息源。
// =====================================================================

describe("B2 新 i18n 消息表一致性", () => {
  it("新 messages 的 zh-CN 与 en key 集合一致", () => {
    const zh = new Set(Object.keys(messages["zh-CN"]));
    const en = new Set(Object.keys(messages.en));
    expect([...zh].filter((k) => !en.has(k))).toEqual([]);
    expect([...en].filter((k) => !zh.has(k))).toEqual([]);
    expect(zh.size).toBe(254);
  });

  it("t() 缺失 key 返回 key 并 console.warn（一次）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => { });
    expect(t("__nonexistent_key__")).toBe("__nonexistent_key__");
    expect(warn).toHaveBeenCalledTimes(1);
    t("__nonexistent_key__");
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("t() 变量占位符替换 {name}", () => {
    expect(t("resumeSelectedMetaOne", { size: "2.3 MB" })).toBe("1 份 · 2.3 MB");
  });

  it("消息表结构健全（zh/en 均含 documentTitle）", () => {
    expect(typeof messages["zh-CN"].documentTitle).toBe("string");
    expect(typeof messages.en.documentTitle).toBe("string");
  });
});
