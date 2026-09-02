import { expect, test, type Page } from "@playwright/test";

// =====================================================================
// 视觉回归基线：关键页面在固定视口/语言下的截图。
// 首次运行需生成基线：node node_modules/@playwright/test/cli.js test --update-snapshots
// 注意：测试用独立 data-dir，模型未配置时 bootstrap 会自动打开设置弹窗。
// =====================================================================

async function waitReady(page: Page): Promise<void> {
  // bootstrap 完成后 hideStartupLoading() 隐藏 #startupLoading
  await page.locator("#startupLoading").waitFor({ state: "hidden" });
}

async function useEmptyHistory(page: Page): Promise<void> {
  await page.route("**/api/jobs?scope=recent&limit=50&offset=0", (route) =>
    route.fulfill({ json: { jobs: [], total: 0 } })
  );
  await page.route("**/api/jobs?scope=archived&limit=50&offset=0", (route) =>
    route.fulfill({ json: { jobs: [], total: 0 } })
  );
  await page.route("**/api/calls?scope=recent&limit=50&offset=0", (route) =>
    route.fulfill({ json: { calls: [], total: 0 } })
  );
  await page.route("**/api/calls?scope=archived&limit=50&offset=0", (route) =>
    route.fulfill({ json: { calls: [], total: 0 } })
  );
}

async function openSettingsDialog(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog", { name: /模型服务|Model service/ });
  if (!(await dialog.isVisible().catch(() => false))) {
    await page.locator("#openSettingsButton").click();
  }
  await expect(dialog).toBeVisible();
}

async function closeSettingsDialog(page: Page): Promise<void> {
  const dialog = page.locator(".settings-dialog");
  if ((await dialog.count()) > 0 && (await dialog.evaluate((el) => el.classList.contains("is-visible")))) {
    await page.locator(".settings-dialog .close-button").click();
    await dialog.waitFor({ state: "hidden" });
  }
}

test.describe("视觉回归基线（zh-CN）", () => {
  test("设置弹窗（desktop 1280x720）", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    await waitReady(page);
    await openSettingsDialog(page);
    await expect(page).toHaveScreenshot("settings-zh-desktop.png", { animations: "disabled" });
  });

  test("历史任务空状态（desktop 1280x720）", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await useEmptyHistory(page);
    await page.goto("/");
    await waitReady(page);
    await closeSettingsDialog(page);
    await page.locator("#openHistoryButton").click();
    await page.locator(".history-dialog.is-visible").waitFor({ state: "visible" });
    await page.locator("#openHistoryButton").evaluate((el) => (el as HTMLElement).blur());
    await expect(page).toHaveScreenshot("history-empty-zh-desktop.png", { animations: "disabled", maxDiffPixels: 1000 });
  });
});

test.describe("视觉回归基线（en）", () => {
  test("设置弹窗（desktop 1280x720）", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.addInitScript(() => localStorage.setItem("talentHub.language", "en"));
    await page.goto("/");
    await waitReady(page);
    await openSettingsDialog(page);
    await expect(page).toHaveScreenshot("settings-en-desktop.png", { animations: "disabled" });
  });
});

test.describe("视觉回归基线（窄屏）", () => {
  test("设置弹窗（mobile 420px，zh-CN）", async ({ page }) => {
    await page.setViewportSize({ width: 420, height: 800 });
    await page.goto("/");
    await waitReady(page);
    await openSettingsDialog(page);
    await expect(page).toHaveScreenshot("settings-zh-mobile.png", { animations: "disabled" });
  });
});
