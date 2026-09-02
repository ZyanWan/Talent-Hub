import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// =====================================================================
// API client（frontend/src/api/client.ts）行为契约：
// 请求构造（X-App-Token / Content-Type 注入）、错误处理（detail 透传与通用文案回退）、
// 响应判定（JSON 解析 / 原始 Response 透传）。
// =====================================================================

type Client = typeof import("../../src/api/client");
let client: Client;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  document.head.innerHTML = '<meta name="app-token" content="test-token">';
  vi.resetModules();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  client = await import("../../src/api/client");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

describe("api() 请求构造（等价）", () => {
  it("所有请求强制注入 X-App-Token", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await client.api("/api/jobs");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/jobs");
    expect(init.headers.get("X-App-Token")).toBe("test-token");
  });

  it("string body 自动设置 Content-Type: application/json", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await client.api("/api/jobs", { method: "POST", body: JSON.stringify({ title: "x" }) });
    expect(fetchMock.mock.calls[0][1].headers.get("Content-Type")).toBe("application/json");
  });

  it("非 string body（FormData）不设置 Content-Type", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    const form = new FormData();
    form.append("file", new Blob(["x"]), "a.pdf");
    await client.api("/api/jobs/1/resumes", { method: "PUT", body: form });
    expect(fetchMock.mock.calls[0][1].headers.has("Content-Type")).toBe(false);
  });

  it("调用方提供的 headers 不被覆盖（合并后注入 token）", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await client.api("/api/jobs", { headers: { "X-Custom": "v" } });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.get("X-Custom")).toBe("v");
    expect(init.headers.get("X-App-Token")).toBe("test-token");
  });
});

describe("api() 错误处理（等价）", () => {
  it("zh-CN + JSON detail → 透传 detail", async () => {
    client.setApiLanguage("zh-CN");
    fetchMock.mockResolvedValue(jsonResponse({ detail: "任务不存在。" }, { status: 404 }));
    await expect(client.api("/api/jobs/404")).rejects.toThrow("任务不存在。");
  });

  it("en + ASCII detail → 透传 detail", async () => {
    client.setApiLanguage("en");
    fetchMock.mockResolvedValue(jsonResponse({ detail: "Job not found." }, { status: 404 }));
    await expect(client.api("/api/jobs/404")).rejects.toThrow("Job not found.");
  });

  it("en + 中文 detail → 回退通用文案 Request failed (status)", async () => {
    client.setApiLanguage("en");
    fetchMock.mockResolvedValue(jsonResponse({ detail: "任务不存在。" }, { status: 404 }));
    await expect(client.api("/api/jobs/404")).rejects.toThrow("Request failed (404)");
  });

  it("非 JSON 错误体 → 回退通用文案", async () => {
    client.setApiLanguage("zh-CN");
    fetchMock.mockResolvedValue(new Response("plain error", { status: 500 }));
    await expect(client.api("/api/jobs")).rejects.toThrow("请求失败（500）");
  });

  it("错误时保留 status 在通用文案中", async () => {
    client.setApiLanguage("zh-CN");
    fetchMock.mockResolvedValue(new Response("x", { status: 503 }));
    await expect(client.api("/api/jobs")).rejects.toThrow("请求失败（503）");
  });
});

describe("api() 响应判定（等价）", () => {
  it("content-type 含 application/json → 返回解析后的对象", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "job-1", status: "draft" }));
    const result = await client.api("/api/jobs/1");
    expect(result).toEqual({ id: "job-1", status: "draft" });
  });

  it("content-type 非 JSON → 返回原始 Response（Blob/下载契约）", async () => {
    const resp = new Response("file-bytes", {
      headers: { "content-type": "application/octet-stream", "content-disposition": "attachment; filename=x.xlsx" },
    });
    fetchMock.mockResolvedValue(resp);
    const result = await client.api("/api/jobs/1/download");
    expect(result).toBeInstanceOf(Response);
    expect(await (result as Response).blob().then((b) => b.text())).toBe("file-bytes");
  });

  it("content-type 为空 → 返回原始 Response", async () => {
    fetchMock.mockResolvedValue(new Response("x", { headers: {} }));
    const result = await client.api("/api/jobs/1/resumes/a.png");
    expect(result).toBeInstanceOf(Response);
  });
});
