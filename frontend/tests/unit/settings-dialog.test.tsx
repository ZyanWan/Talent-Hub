// =====================================================================
// 设置弹窗（src/ui/SettingsDialog.tsx）渲染与交互测试（jsdom）。
// 覆盖：字段渲染与初始置空（密钥不回填）、留空保存传空串、清除 ASR/飞书
// 签名提交 clear_* 标志、保存/测试连接/测试飞书的请求负载与按钮 busy、
// 错误提示展示（.dialog-message.error）、关闭行为（点遮罩不关闭、ESC/
// 关闭按钮可关）、语言切换重渲染。
// 仅做渲染级断言，不含截图验证（视觉回归由 tests/visual/baseline.spec.ts 覆盖）。
// =====================================================================

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLanguage } from "../../src/i18n";
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
  state.language = "zh-CN";
  localStorage.removeItem("talentHub.language");
});

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderDialog(props: Partial<Parameters<typeof SettingsDialog>[0]> = {}) {
  const onClose = vi.fn();
  const view = render(<SettingsDialog open onClose={onClose} {...props} />);
  return { ...view, onClose };
}

function parsedBody(callIndex = 0): Record<string, unknown> {
  return JSON.parse(fetchMock.mock.calls[callIndex][1].body as string);
}

describe("字段渲染与初始置空", () => {
  it("从已存配置回填非密钥字段，三个密钥输入框恒为空", () => {
    state.settings = {
      base_url: "https://api.example.com/v1",
      api_key: "sk-secret",
      asr_api_key: "asr-secret",
      model: "gpt-4o-mini",
      max_parallel: 8,
      request_timeout: 300,
      ocr_executable: "C:/tesseract/tesseract.exe",
      retain_resume_text: false,
      call_qa_records: true,
      feishu_push_enabled: true,
      feishu_webhook_url: "https://open.feishu.cn/open-apis/bot/v2/hook/abc",
      feishu_sign_secret: "sign-secret",
    };
    renderDialog();

    expect(screen.getByLabelText("接口地址")).toHaveValue("https://api.example.com/v1");
    expect(screen.getByLabelText("接口密钥")).toHaveValue("");
    expect(screen.getByLabelText("语音转写密钥")).toHaveValue("");
    expect(screen.getByLabelText("模型名称")).toHaveValue("gpt-4o-mini");
    expect(screen.getByLabelText("并发数")).toHaveValue(8);
    expect(screen.getByLabelText("超时（秒）")).toHaveValue(300);
    expect(screen.getByLabelText("文字识别程序路径")).toHaveValue("C:/tesseract/tesseract.exe");
    expect(screen.getByLabelText("在本机任务目录保留解析后的简历文本")).not.toBeChecked();
    expect(screen.getByLabelText("电话整理时生成快筛详情（问答原文，较慢）")).toBeChecked();
    expect(screen.getByLabelText("任务完成后自动推送结果到飞书群")).toBeChecked();
    expect(screen.getByLabelText("飞书推送 · Webhook 地址")).toHaveValue(
      "https://open.feishu.cn/open-apis/bot/v2/hook/abc"
    );
    expect(screen.getByLabelText("飞书推送 · 签名密钥")).toHaveValue("");
  });

  it("无已存配置时使用默认值（base_url / 并发 6 / 超时 180 / 保留文本勾选）", () => {
    renderDialog();

    expect(screen.getByLabelText("接口地址")).toHaveValue("https://api.openai.com/v1");
    expect(screen.getByLabelText("并发数")).toHaveValue(6);
    expect(screen.getByLabelText("超时（秒）")).toHaveValue(180);
    expect(screen.getByLabelText("在本机任务目录保留解析后的简历文本")).toBeChecked();
  });
});

describe("保存负载", () => {
  it("密钥留空保存：提交空串与 clear_* = false，走 PUT /api/settings", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    renderDialog();

    fireEvent.change(screen.getByLabelText("接口地址"), { target: { value: "https://api.example.com/v1" } });
    fireEvent.change(screen.getByLabelText("模型名称"), { target: { value: "gpt-4o-mini" } });
    fireEvent.change(screen.getByLabelText("并发数"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("超时（秒）"), { target: { value: "240" } });
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/settings");
    expect(fetchMock.mock.calls[0][1].method).toBe("PUT");
    expect(parsedBody()).toEqual({
      base_url: "https://api.example.com/v1",
      api_key: "",
      asr_api_key: "",
      clear_asr: false,
      model: "gpt-4o-mini",
      max_parallel: 10,
      request_timeout: 240,
      ocr_executable: "",
      retain_resume_text: true,
      call_qa_records: false,
      feishu_push_enabled: false,
      feishu_webhook_url: "",
      feishu_sign_secret: "",
      clear_feishu_sign: false,
    });
  });

  it("保存成功：按钮 is-busy + 「保存中…」，完成后恢复并展示成功消息、写回全局 state.settings", async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValue(pending.promise);
    renderDialog();
    fireEvent.change(screen.getByLabelText("模型名称"), { target: { value: "gpt-4o-mini" } });
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));

    const savingButton = await screen.findByRole("button", { name: "保存中…" });
    expect(savingButton).toHaveClass("is-busy");
    expect(savingButton).toBeDisabled();
    expect(savingButton).toHaveAttribute("aria-busy", "true");

    pending.resolve(
      jsonResponse({ base_url: "https://api.example.com/v1", model: "gpt-4o-mini", max_parallel: 10 })
    );
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("配置已安全保存在本机。"));
    expect(screen.getByRole("button", { name: "保存配置" })).not.toHaveClass("is-busy");
    expect(state.settings).toEqual({ base_url: "https://api.example.com/v1", model: "gpt-4o-mini", max_parallel: 10 });
  });

  it("保存失败：展示 error 样式的错误消息", async () => {
    fetchMock.mockRejectedValue(new Error("保存失败"));
    renderDialog();
    fireEvent.change(screen.getByLabelText("模型名称"), { target: { value: "gpt-4o-mini" } });
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));

    await screen.findByText("保存失败");
    expect(screen.getByRole("status")).toHaveClass("dialog-message", "error");
  });
});

describe("清除密钥", () => {
  it("清除 ASR：提交 clear_asr=true 且 asr_api_key 为空", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    state.settings = { base_url: "https://api.example.com/v1", model: "gpt-4o-mini" };
    renderDialog();

    fireEvent.change(screen.getByLabelText("语音转写密钥"), { target: { value: "asr-old" } });
    fireEvent.click(screen.getAllByRole("button", { name: "清除" })[0]);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/settings");
    const body = parsedBody();
    expect(body.clear_asr).toBe(true);
    expect(body.asr_api_key).toBe("");
    expect(body.clear_feishu_sign).toBe(false);
    expect(body.feishu_sign_secret).toBe("");
  });

  it("清除飞书签名：提交 clear_feishu_sign=true 且 feishu_sign_secret 为空", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    state.settings = { base_url: "https://api.example.com/v1", model: "gpt-4o-mini" };
    renderDialog();

    fireEvent.change(screen.getByLabelText("飞书推送 · 签名密钥"), { target: { value: "sign-old" } });
    fireEvent.click(screen.getAllByRole("button", { name: "清除" })[1]);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = parsedBody();
    expect(body.clear_feishu_sign).toBe(true);
    expect(body.feishu_sign_secret).toBe("");
    expect(body.clear_asr).toBe(false);
    expect(body.asr_api_key).toBe("");
  });
});

describe("测试模型连接", () => {
  it("POST /api/settings/test + 负载一致，按钮 busy + 「测试中…」，成功展示服务端 message", async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValue(pending.promise);
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "测试模型链接" }));

    const testingButton = await screen.findByRole("button", { name: "测试中…" });
    expect(testingButton).toHaveClass("is-busy");
    expect(testingButton).toBeDisabled();
    expect(testingButton).toHaveAttribute("aria-busy", "true");

    pending.resolve(jsonResponse({ message: "连接成功" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("连接成功"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/settings/test");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(parsedBody()).toEqual({
      base_url: "https://api.openai.com/v1",
      api_key: "",
      asr_api_key: "",
      clear_asr: false,
      model: "",
      max_parallel: 6,
      request_timeout: 180,
      ocr_executable: "",
      retain_resume_text: true,
      call_qa_records: false,
      feishu_push_enabled: false,
      feishu_webhook_url: "",
      feishu_sign_secret: "",
      clear_feishu_sign: false,
    });
    expect(screen.getByRole("button", { name: "测试模型链接" })).not.toHaveClass("is-busy");
  });

  it("服务端无 message 时回退通用文案；失败时展示 error 样式", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "测试模型链接" }));
    await screen.findByText("连接测试通过。");

    fetchMock.mockRejectedValueOnce(new Error("连接失败"));
    fireEvent.click(screen.getByRole("button", { name: "测试模型链接" }));
    await screen.findByText("连接失败");
    expect(screen.getByRole("status")).toHaveClass("dialog-message", "error");
  });
});

describe("测试飞书", () => {
  it("POST /api/settings/feishu-test，按钮 busy，成功展示飞书测试通过消息", async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValue(pending.promise);
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "测试飞书链接" }));

    const testingButton = await screen.findByRole("button", { name: "测试中…" });
    expect(testingButton).toHaveClass("is-busy");

    pending.resolve(jsonResponse({ ok: true }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("飞书推送测试成功。"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/settings/feishu-test");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(screen.getByRole("button", { name: "测试飞书链接" })).not.toHaveClass("is-busy");
  });

  it("失败时展示包装了服务端消息的错误文案", async () => {
    fetchMock.mockRejectedValue(new Error("签名错误"));
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "测试飞书链接" }));

    await screen.findByText("飞书推送测试失败：签名错误");
    expect(screen.getByRole("status")).toHaveClass("dialog-message", "error");
  });
});

describe("关闭行为", () => {
  it("点遮罩不关闭（编辑类弹窗），点弹窗内部也不关闭", () => {
    const { onClose, container } = renderDialog();
    fireEvent.click(container.querySelector(".preview-backdrop")!);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("接口地址"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("关闭按钮触发 onClose", () => {
    const { onClose } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ESC 触发 onClose", () => {
    const { onClose } = renderDialog();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("语言切换", () => {
  it("订阅 i18n onChange：切换语言后按钮与标题文案重渲染", () => {
    renderDialog();
    expect(screen.getByRole("heading", { name: "模型服务" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存配置" })).toBeInTheDocument();

    act(() => setLanguage("en"));
    expect(screen.getByRole("heading", { name: "Model service" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Test model link" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Test Feishu link" })).toBeInTheDocument();
  });
});
