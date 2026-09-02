import { expect, test } from "@playwright/test";

// =====================================================================
// 静态托管与安全边界（集成测试，需 FastAPI 运行于 127.0.0.1:8765）
//   验证：首页 token 注入 / 静态资源路径 / 无 token 403 / CSP 响应头
// =====================================================================

test("首页注入 meta app-token 且占位符被替换", async ({ request }) => {
  const resp = await request.get("/");
  expect(resp.status()).toBe(200);
  const html = await resp.text();
  expect(html).toContain('name="app-token"');
  expect(html).not.toContain("__APP_TOKEN__");
  // React 挂载点（app-shell 为运行时渲染，静态 HTML 不含）
  expect(html).toContain('<div id="root">');
});

test("静态资源路径可访问（脚本/样式/图标/字体）", async ({ request }) => {
  const home = await request.get("/");
  const html = await home.text();
  // 从构建产物 index.html 动态解析 /assets/* 引用（src/href）
  const assets = [...html.matchAll(/["'](\/assets\/[^"']+)["']/g)].map((m) => m[1]);
  expect(assets.length).toBeGreaterThan(0);
  const paths = [...new Set([...assets, "/styles.css", "/fonts/AlibabaPuHuiTi-3-65-Medium.ttf"])];
  for (const p of paths) {
    const resp = await request.get(p);
    expect(resp.status(), `GET ${p}`).toBe(200);
  }
});

test("/health 响应字段保持（发布烟测依赖）", async ({ request }) => {
  const resp = await request.get("/health");
  expect(resp.status()).toBe(200);
  const body = await resp.json();
  expect(body.app).toBe("talent-hub");
  expect(body.status).toBe("ok");
});

test("无 token 访问 /api/bootstrap → 403 与固定错误文案", async ({ request }) => {
  const resp = await request.get("/api/bootstrap");
  expect(resp.status()).toBe(403);
  const body = await resp.json();
  expect(body.detail).toContain("无效的本地会话令牌");
});

test("错误 token 访问 /api → 403", async ({ request }) => {
  const resp = await request.get("/api/bootstrap", { headers: { "X-App-Token": "wrong-token" } });
  expect(resp.status()).toBe(403);
});

test("有效 token 访问 /api/bootstrap → 200 且含 settings/jobs", async ({ request }) => {
  const home = await request.get("/");
  const html = await home.text();
  const token = html.match(/<meta name="app-token" content="([^"]+)"/)?.[1] ?? "";
  expect(token).toBeTruthy();
  const resp = await request.get("/api/bootstrap", { headers: { "X-App-Token": token } });
  expect(resp.status()).toBe(200);
  const body = await resp.json();
  expect(body).toHaveProperty("settings");
  expect(body).toHaveProperty("jobs");
  expect(body).toHaveProperty("limits");
  // 公开配置永不回传明文密钥
  expect(body.settings).not.toHaveProperty("api_key");
  expect(body.settings).not.toHaveProperty("asr_api_key");
});

test("CSP 响应头保持（script-src 'self' 等冻结项）", async ({ request }) => {
  const resp = await request.get("/");
  const csp = resp.headers()["content-security-policy"] || "";
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("style-src 'self' 'unsafe-inline'");
  expect(csp).toContain("img-src 'self' data: blob:");
  expect(csp).toContain("connect-src 'self'");
  expect(csp).toContain("media-src 'self' blob:");
  const xcto = resp.headers()["x-content-type-options"];
  expect(xcto).toBe("nosniff");
});
