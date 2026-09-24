import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";

const BACKEND = "http://127.0.0.1:8765";

// dev 模式：从后端首页提取会话 token 注入 meta，并把 /api 代理到本地后端；仅 dev 需要。
// apply: "serve" 保证构建不注入——dist/index.html 只保留 __APP_TOKEN__ 占位 meta，由 FastAPI
// 运行时替换；构建时同时注入会与占位 meta 并存，前端取到空 meta 导致 403。
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

// 单元/契约测试走 Vitest（jsdom），视觉回归走 Playwright；本文件同时承担应用构建配置。
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
