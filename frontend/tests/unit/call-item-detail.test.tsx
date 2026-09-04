// =====================================================================
// 电话条目详情的结构渲染、音频加载与关键恢复、编辑保存、事实跳转和处理中状态。
// 仅做渲染级断言，不含截图验证。
// =====================================================================

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { state } from "../../src/state";
import { CallItemDetail, releaseAudioBlobs, type CallItemSummary, type CallTask } from "../../src/views/CallItemDetail";

let fetchMock: ReturnType<typeof vi.fn>;
let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;

/** 已完成任务夹具：i1/i2 为 done（i2 带空 summary），i3 为转写中 */
function doneCall(): CallTask {
  return {
    id: "c1",
    title: "电话确认-2026-08-31",
    status: "done",
    updated_at: "2026-08-31T11:10:00+08:00",
    errors: [],
    items: [
      {
        id: "i1",
        audio_file: "张三-电话录音.m4a",
        candidate_name: "张三",
        stage: "整理完成",
        status: "done",
        progress: 100,
        error: null,
        summary: {
          narrative: "候选人表达清晰",
          fields: [{ key: "k1", label: "岗位匹配度", value: "高", status: "含糊", note: "备注" }],
          facts: [{ content: "事实内容1", speaker: "张三", ref: "r1", start_time: 12 }],
          doubts: ["疑点内容"],
          transcript: "转写文本",
        },
      },
      {
        id: "i2",
        audio_file: "李四.m4a",
        candidate_name: "李四",
        stage: "整理完成",
        status: "done",
        progress: 100,
        error: null,
        summary: { narrative: "", fields: [], facts: [], doubts: [], transcript: "" },
      },
      { id: "i3", audio_file: "王五.m4a", candidate_name: "王五", status: "transcribing", progress: 40, error: null },
    ],
  };
}

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

/** 音频响应：非 JSON content-type，api() 返回原始 Response（Blob 契约） */
function audioResponse() {
  return new Response(new Blob(["audio-bytes"], { type: "audio/mpeg" }));
}

type DetailProps = Parameters<typeof CallItemDetail>[0];

function renderDetail(call: CallTask, itemId = "i1", props: Partial<DetailProps> = {}) {
  const onSelectItem = vi.fn();
  const onClose = vi.fn();
  const onToast = vi.fn();
  const onSaved = vi.fn();
  const view = render(
    <CallItemDetail
      call={call}
      itemId={itemId}
      onSelectItem={onSelectItem}
      onClose={onClose}
      onToast={onToast}
      onSaved={onSaved}
      {...props}
    />
  );
  return { ...view, onSelectItem, onClose, onToast, onSaved };
}

/** 默认兜底：未匹配路由返回 ok；audio 端点返回 Blob */
function mockServer(handler: (url: URL, init: RequestInit | undefined) => Response | Promise<Response>) {
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    return handler(url, init);
  });
}

const audioFetchCount = () => fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/items/i1/audio")).length;

beforeEach(() => {
  state.language = "zh-CN";
  state.currentCall = null;
  localStorage.clear();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  createObjectURL = vi.fn(() => "blob:mock-url");
  revokeObjectURL = vi.fn();
  URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
  // 模块级音频缓存与进行中标记跨用例清空（同时覆盖 releaseAudioBlobs 的 revoke 行为）
  releaseAudioBlobs();
  // jsdom 未实现媒体元素方法：pause 置为 no-op（原型直接赋值，测试收尾的
  // 自动 cleanup 卸载仍会调用，避免虚拟控制台 "Not implemented" 噪音）
  HTMLMediaElement.prototype.pause = () => { };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  state.language = "zh-CN";
  state.currentCall = null;
  localStorage.clear();
});

describe("详情渲染", () => {
  it("渲染 narrative/fields/facts/doubts/transcript 与候选人与 meta", async () => {
    mockServer((url) => {
      if (url.pathname.endsWith("/items/i1/audio")) return Promise.resolve(audioResponse());
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    renderDetail(doneCall(), "i1");

    // 候选人输入与标题 meta（stage + 状态文案）
    expect(screen.getByDisplayValue("张三")).toBeInTheDocument();
    expect(screen.getByText("整理完成 · 已完成")).toBeInTheDocument();
    // narrative
    expect(screen.getByDisplayValue("候选人表达清晰")).toBeInTheDocument();
    // 面板标题
    expect(screen.getByText("字段速览")).toBeInTheDocument();
    expect(screen.getByText("事实清单")).toBeInTheDocument();
    expect(screen.getByText("疑点清单")).toBeInTheDocument();
    expect(screen.getByText("转写原文")).toBeInTheDocument();
    // 面板内容
    expect(screen.getByText("岗位匹配度")).toBeInTheDocument();
    expect(screen.getByText("含糊")).toBeInTheDocument();
    expect(screen.getByDisplayValue("高")).toBeInTheDocument();
    expect(screen.getByText("事实内容1")).toBeInTheDocument();
    expect(screen.getByText("张三 · 0:12 · r1")).toBeInTheDocument();
    expect(screen.getByText("疑点内容")).toBeInTheDocument();
    expect(document.querySelector(".call-transcript")!.textContent).toContain("转写文本");
  });
});
describe("音频加载与缓存", () => {
  it("Blob → createObjectURL 挂载到播放器；加载失败隐藏播放器并 toast", async () => {
    mockServer((url) => {
      if (url.pathname.endsWith("/items/i1/audio")) return Promise.resolve(audioResponse());
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    const first = renderDetail(doneCall(), "i1");

    await waitFor(() => expect((document.querySelector(".call-audio") as HTMLAudioElement).src).toBe("blob:mock-url"));
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("/items/i1/audio"))).toBe(true);
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(first.onToast).not.toHaveBeenCalled();

    // 加载失败：隐藏播放器 + callAudioLoadFail toast
    first.unmount();
    releaseAudioBlobs();
    const fail = vi.fn();
    mockServer((url) => {
      if (url.pathname.endsWith("/items/i1/audio")) {
        return Promise.resolve(jsonResponse({ detail: "音频不可用" }, { status: 404 }));
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    renderDetail(doneCall(), "i1", { onToast: fail });
    await waitFor(() => expect(document.querySelector(".call-audio")!.getAttribute("hidden")).not.toBeNull());
    expect(fail).toHaveBeenCalledWith("录音加载失败");
  });

  it("首包解码失败时从首个正常 AAC 包重试一次", async () => {
    mockServer((url) => {
      if (url.pathname.endsWith("/items/i1/audio")) return Promise.resolve(audioResponse());
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    renderDetail(doneCall(), "i1");
    const audio = document.querySelector(".call-audio") as HTMLAudioElement;
    await waitFor(() => expect(audio.src).toBe("blob:mock-url"));
    const load = vi.spyOn(audio, "load").mockImplementation(() => { });
    Object.defineProperty(audio, "error", { value: { code: 3 }, configurable: true });

    fireEvent.error(audio);
    fireEvent.error(audio);

    expect(audio.src).toBe("blob:mock-url#t=0.064");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("缓存复用：关闭重开不重复请求；releaseAudioBlobs 统一 revoke 后重新下载", async () => {
    mockServer((url) => {
      if (url.pathname.endsWith("/items/i1/audio")) return Promise.resolve(audioResponse());
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    const { unmount } = renderDetail(doneCall(), "i1");
    await waitFor(() => expect((document.querySelector(".call-audio") as HTMLAudioElement).src).toBe("blob:mock-url"));
    expect(audioFetchCount()).toBe(1);

    // 关闭重开：命中模块级缓存，不重复请求
    unmount();
    renderDetail(doneCall(), "i1");
    await waitFor(() => expect((document.querySelector(".call-audio") as HTMLAudioElement).src).toBe("blob:mock-url"));
    expect(audioFetchCount()).toBe(1);

    // 整体释放：缓存中的 URL 全部 revoke（对应切换任务/重置）
    releaseAudioBlobs();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");

    // 释放后重开：重新下载
    renderDetail(doneCall(), "i1");
    await waitFor(() => expect((document.querySelector(".call-audio") as HTMLAudioElement).src).toBe("blob:mock-url"));
    expect(audioFetchCount()).toBe(2);
  });

});

describe("播放恢复", () => {
  it("轮询重绘：同一条目复用 <audio> 元素，currentTime 与播放状态保持", async () => {
    mockServer((url) => {
      if (url.pathname.endsWith("/items/i1/audio")) return Promise.resolve(audioResponse());
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    const { rerender, onSelectItem, onClose, onToast, onSaved } = renderDetail(doneCall(), "i1");
    await waitFor(() => expect((document.querySelector(".call-audio") as HTMLAudioElement).src).toBe("blob:mock-url"));
    const audio = document.querySelector(".call-audio") as HTMLAudioElement;
    // 模拟用户正在播放：定位到 42s 并处于播放中
    audio.currentTime = 42;
    Object.defineProperty(audio, "paused", { value: false, configurable: true });

    // 轮询重绘：call 数据更新（同一条目内容变化，如转写追加）
    const updated = doneCall();
    (updated.items![0].summary as CallItemSummary).transcript = "追加的转写";
    rerender(
      <CallItemDetail
        call={updated}
        itemId="i1"
        onSelectItem={onSelectItem}
        onClose={onClose}
        onToast={onToast}
        onSaved={onSaved}
      />
    );

    const audioAfter = document.querySelector(".call-audio") as HTMLAudioElement;
    expect(audioAfter).toBe(audio); // 同一 DOM 节点，未重建
    expect(audioAfter.currentTime).toBe(42); // 播放位置保持
    expect(audioAfter.paused).toBe(false); // 播放状态保持
    expect(audioFetchCount()).toBe(1); // 未重复下载
  });

});

describe("编辑保存", () => {
  it("PUT /api/calls/{id}/items/{item_id} body 完整覆盖字段，成功后回读任务", async () => {
    const call = doneCall();
    let savedBody: Record<string, unknown> | null = null;
    mockServer((url, init) => {
      const method = init?.method ?? "GET";
      if (url.pathname.endsWith("/items/i1/audio")) return Promise.resolve(audioResponse());
      if (url.pathname === "/api/calls/c1/items/i1" && method === "PUT") {
        savedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      if (url.pathname === "/api/calls/c1" && method === "GET") {
        return Promise.resolve(jsonResponse(call)); // 保存后回读
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    const { onToast, onSaved } = renderDetail(call, "i1");

    // 编辑 narrative 与字段值
    fireEvent.change(document.querySelector(".call-narrative")!, { target: { value: "新的整理记录" } });
    fireEvent.change(document.querySelectorAll(".call-field-input")[0], { target: { value: "较高" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(savedBody).toEqual({
      narrative: "新的整理记录",
      candidate_name: "张三",
      fields: [{ key: "k1", label: "岗位匹配度", value: "较高", status: "含糊", note: "备注" }],
    });
    expect(state.currentCall).toEqual(call); // 回读结果写入全局状态
    expect(onToast).toHaveBeenCalledWith("已保存");
  });
});

describe("facts 时间点跳转", () => {
  it("点击事实行：设置 currentTime = start_time 并播放", async () => {
    mockServer((url) => {
      if (url.pathname.endsWith("/items/i1/audio")) return Promise.resolve(audioResponse());
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    renderDetail(doneCall(), "i1");
    await waitFor(() => expect((document.querySelector(".call-audio") as HTMLAudioElement).src).toBe("blob:mock-url"));
    const audio = document.querySelector(".call-audio") as HTMLAudioElement;
    Object.defineProperty(audio, "readyState", { value: 4, configurable: true });
    const playSpy = vi.spyOn(audio, "play").mockImplementation(() => Promise.resolve());

    fireEvent.click(document.querySelector(".call-fact-row")!);
    expect(audio.currentTime).toBe(12);
    expect(playSpy).toHaveBeenCalledTimes(1);
  });
});

describe("非 done 条目", () => {
  it("转写中/整理中/failed 在详情内展示进度与错误，不加载音频", async () => {
    const runningCall: CallTask = {
      id: "c1",
      status: "running",
      items: [
        { id: "i1", audio_file: "a.m4a", status: "transcribing", progress: 40, error: null },
        { id: "i2", audio_file: "b.m4a", status: "failed", progress: 10, error: "转写失败" },
      ],
    };
    const first = renderDetail(runningCall, "i1");
    expect(screen.getByText("40%")).toBeInTheDocument();
    expect(document.querySelector(".call-item-progress")!.classList.contains("is-active")).toBe(true);
    expect(document.querySelector(".call-audio")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    first.unmount();

    renderDetail(runningCall, "i2");
    expect(screen.getByText("10%")).toBeInTheDocument();
    expect(screen.getByText("转写失败")).toBeInTheDocument();
    expect(document.querySelector(".call-audio")).toBeNull();
  });
});
