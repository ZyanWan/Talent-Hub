import { expect, test } from "@playwright/test";

// 冒烟测试：验证 Playwright 可访问 FastAPI 托管的现有前端。
// 运行前需先启动后端：python -m app.main --no-browser（默认 127.0.0.1:8765）。

test("首页可加载且包含 app-shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("body")).toBeVisible();
  await expect(page.locator("div.app-shell")).toHaveCount(1);
  // app-token 注入存在
  const token = await page.locator('meta[name="app-token"]').getAttribute("content");
  expect(token).toBeTruthy();
});
