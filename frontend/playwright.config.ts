import { defineConfig, devices } from "@playwright/test";
import os from "node:os";
import path from "node:path";

const baseURL = process.env.APP_BASE_URL || "http://127.0.0.1:18765";
const dataDir = path.join(os.tmpdir(), `talent-hub-playwright-${process.pid}`);
const webServer = process.env.APP_BASE_URL
  ? undefined
  : {
    command: `python -X utf8 -m app.main --port 18765 --no-browser --data-dir ${JSON.stringify(dataDir)}`,
    cwd: "..",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30_000,
  };

// 视觉回归与集成测试配置。
// 默认启动独立后端并使用临时数据目录，避免复用用户数据。
export default defineConfig({
  testDir: "./tests",
  testMatch: /.*\.spec\.ts/,
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  webServer,
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "zh-CN",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
