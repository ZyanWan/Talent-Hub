import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";

const BACKEND = "http://127.0.0.1:8765";

// dev 模式：从后端首页提取会话 token 注入 meta（等价后端托管 frontend 构建产物时渲染的 <meta name="app-token">），
// 并将 /api 请求代理到本地后端。仅 dev 需要，生产由 FastAPI 托管时自行注入。
// apply: "serve" 保证构建（vite build）不注入：dist/index.html 只保留源码里的 __APP_TOKEN__ 占位 meta，
// 由 FastAPI 运行时替换为真实 token；若构建时也注入会与占位 meta 并存，前端取到第一个空 meta 导致 403。
function injectAppToken(): Plugin {
  return {
    name: "inject-app-token",
    apply: "serve",
    transformIndexHtml: {
      order: "pre",
      handler: async () => {
        let token = "";
        try {
          const res = await fetch(`${BACKEND}/`);
          const html = await res.text();
          token = html.match(/<meta name="app-token" content="([^"]+)"/)?.[1] ?? "";
        } catch {
          // 后端未启动时留空：页面请求将 403，属预期
        }
        return [{ tag: "meta", attrs: { name: "app-token", content: token } }];
      },
    },
  };
}

// 单元/契约测试走 Vitest（jsdom）；视觉回归走 Playwright（见 playwright.config.ts）。
// 本文件同时承担应用构建配置（vite build / dev）。
export default defineConfig({
  plugins: [react(), injectAppToken()],
  server: {
    proxy: { "/api": BACKEND },
  },
  build: {
    outDir: "dist",
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["tests/setup.ts"],
    include: ["tests/unit/**/*.test.{ts,tsx}", "tests/contract/**/*.test.{ts,tsx}"],
    exclude: ["tests/visual/**", "node_modules/**"],
    css: false,
  },
});
