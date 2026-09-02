import { beforeEach, describe, expect, it, vi } from "vitest";

// =====================================================================
// i18n（src/i18n）语言状态与切换广播集成测试。
// 等价行为：语言初始读 localStorage；setLanguage 持久化 + 广播；t() 随语言切换。
// =====================================================================

type I18n = typeof import("../../src/i18n");
let i18n: I18n;

beforeEach(async () => {
  localStorage.clear();
  vi.resetModules();
  i18n = await import("../../src/i18n");
});

describe("i18n 语言状态（等价）", () => {
  it("初始语言默认 zh-CN", () => {
    expect(i18n.getLanguage()).toBe("zh-CN");
  });

  it("初始语言从 localStorage 读取", async () => {
    localStorage.setItem("talentHub.language", "en");
    vi.resetModules();
    i18n = await import("../../src/i18n");
    expect(i18n.getLanguage()).toBe("en");
  });

  it("setLanguage 更新语言并持久化到 localStorage", () => {
    i18n.setLanguage("en");
    expect(i18n.getLanguage()).toBe("en");
    expect(localStorage.getItem("talentHub.language")).toBe("en");
  });

  it("setLanguage 触发 onChange 广播", () => {
    const listener = vi.fn();
    i18n.onChange(listener);
    i18n.setLanguage("en");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("切换回同一语言不重复广播", () => {
    const listener = vi.fn();
    i18n.onChange(listener);
    i18n.setLanguage("zh-CN"); // 初始即 zh-CN
    expect(listener).not.toHaveBeenCalled();
  });

  it("t() 返回值随语言切换（zh ↔ en）", () => {
    expect(i18n.t("appName")).toBe("招聘工作台");
    i18n.setLanguage("en");
    expect(i18n.t("appName")).toBe("Talent Hub");
  });

  it("t() 带参数文案随语言切换", () => {
    expect(i18n.t("requestFailed", { status: 404 })).toBe("请求失败（404）");
    i18n.setLanguage("en");
    expect(i18n.t("requestFailed", { status: 404 })).toBe("Request failed (404)");
  });
});
