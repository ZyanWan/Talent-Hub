import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { state } from "../../src/state";
import { SettingsDialog } from "../../src/ui/SettingsDialog";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  state.settings = null;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  state.settings = null;
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}

function renderDialog() {
  render(<SettingsDialog open onClose={vi.fn()} />);
}

function parsedBody(index = 0): Record<string, unknown> {
  return JSON.parse(fetchMock.mock.calls[index][1].body as string);
}

describe("应用设置", () => {
  it("公开配置不会回填任何密钥", () => {
    state.settings = {
      base_url: "https://api.example.com/v1",
      api_key: "sk-secret",
      asr_api_key: "asr-secret",
      feishu_sign_secret: "sign-secret",
      model: "gpt-4o-mini",
    };

    renderDialog();

    expect(screen.getByLabelText("接口密钥")).toHaveValue("");
    expect(screen.getByLabelText("语音转写密钥")).toHaveValue("");
    expect(screen.getByLabelText("飞书推送 · 签名密钥")).toHaveValue("");
  });

  it("保存时提交完整配置且留空密钥不触发清除", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    renderDialog();
    fireEvent.change(screen.getByLabelText("模型名称"), { target: { value: "gpt-4o-mini" } });

    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/settings");
    expect(fetchMock.mock.calls[0][1].method).toBe("PUT");
    expect(parsedBody()).toMatchObject({
      api_key: "",
      asr_api_key: "",
      clear_asr: false,
      feishu_sign_secret: "",
      clear_feishu_sign: false,
      model: "gpt-4o-mini",
    });
  });

  it("清除语音与飞书密钥分别提交对应标记", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    state.settings = { base_url: "https://api.example.com/v1", model: "gpt-4o-mini" };
    renderDialog();

    fireEvent.click(screen.getAllByRole("button", { name: "清除" })[0]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(parsedBody(0)).toMatchObject({ clear_asr: true, clear_feishu_sign: false });

    fireEvent.click(screen.getAllByRole("button", { name: "清除" })[1]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(parsedBody(1)).toMatchObject({ clear_asr: false, clear_feishu_sign: true });
  });

  it("模型与飞书连接测试调用各自端点", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "连接成功" }));
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "测试模型链接" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/settings/test");

    fireEvent.click(screen.getByRole("button", { name: "测试飞书链接" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe("/api/settings/feishu-test");
  });
});
