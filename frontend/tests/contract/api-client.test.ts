import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("API 客户端契约", () => {
  it("所有请求携带本机会话令牌", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ ok: true })));

    await client.api("/api/jobs");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/jobs");
    expect(init.headers.get("X-App-Token")).toBe("test-token");
  });

  it("JSON 与文件请求使用各自正确的 Content-Type", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ ok: true })));
    await client.api("/api/jobs", { method: "POST", body: JSON.stringify({ title: "x" }) });
    expect(fetchMock.mock.calls[0][1].headers.get("Content-Type")).toBe("application/json");

    const form = new FormData();
    form.append("file", new Blob(["x"]), "a.pdf");
    await client.api("/api/jobs/1/resumes", { method: "PUT", body: form });
    expect(fetchMock.mock.calls[1][1].headers.has("Content-Type")).toBe(false);
  });

  it("英文界面不透传中文服务端错误", async () => {
    client.setApiLanguage("en");
    fetchMock.mockResolvedValue(jsonResponse({ detail: "任务不存在。" }, 404));

    await expect(client.api("/api/jobs/404")).rejects.toThrow("Request failed (404)");
  });

  it("JSON 响应解码，文件响应保持原始 Response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "job-1" }));
    await expect(client.api("/api/jobs/1")).resolves.toEqual({ id: "job-1" });

    fetchMock.mockResolvedValueOnce(new Response("file", {
      headers: { "content-type": "application/octet-stream" },
    }));
    await expect(client.api("/api/jobs/1/download")).resolves.toBeInstanceOf(Response);
  });
});
