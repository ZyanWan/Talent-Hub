import { describe, expect, it } from "vitest";

// 冒烟测试：验证 Vitest 基础设施可运行。
describe("测试基础设施", () => {
  it("Vitest 可运行", () => {
    expect(1 + 1).toBe(2);
  });
});
