import { beforeEach, describe, expect, it } from "vitest";
import { displayCallTitle } from "../../src/callTitle";
import { state } from "../../src/state";

describe("电话任务标题", () => {
  beforeEach(() => {
    state.language = "zh-CN";
  });

  it("自动标题随当前语言显示", () => {
    const call = { title: "2026-09-04 电话确认", title_mode: "auto" };

    expect(displayCallTitle(call)).toBe("2026-09-04 电话确认");
    state.language = "en";
    expect(displayCallTitle(call)).toBe("Phone screening · 2026-09-04");
  });

  it("兼容没有标题模式的中英文系统默认标题", () => {
    state.language = "en";
    expect(displayCallTitle({ title: "2026-09-04 电话确认" })).toBe("Phone screening · 2026-09-04");
    state.language = "zh-CN";
    expect(displayCallTitle({ title: "Phone screening · 2026-09-04" })).toBe("2026-09-04 电话确认");
  });

  it("自定义标题保持用户原文", () => {
    state.language = "en";
    expect(displayCallTitle({ title: "2026-09-04 电话确认", title_mode: "custom" })).toBe("2026-09-04 电话确认");
    expect(displayCallTitle({ title: "本周候选人回访", title_mode: "custom" })).toBe("本周候选人回访");
  });
});
