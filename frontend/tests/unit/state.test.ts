import { beforeEach, describe, expect, it, vi } from "vitest";

// =====================================================================
// 全局状态（frontend/src/state）：字段名 / 初始值 / 类型契约；
// language 从 localStorage 初始化；模块局部 UI 状态不进入全局 state。
// =====================================================================

type NewState = typeof import("../../src/state");

let newState: NewState;

beforeEach(async () => {
  localStorage.clear();
  vi.resetModules();
  newState = await import("../../src/state");
});

describe("全局状态（src/state）", () => {
  it("初始值：language 默认 zh-CN、settings=null、jobs=[]、pollTimer=null", () => {
    expect(newState.state.language).toBe("zh-CN");
    expect(newState.state.settings).toBeNull();
    expect(newState.state.jobs).toEqual([]);
    expect(newState.state.pollTimer).toBeNull();
    expect(newState.state.callPollTimer).toBeNull();
  });

  it("language 从 localStorage 初始化（设 en 后重新 import 为 en）", async () => {
    localStorage.setItem("talentHub.language", "en");
    vi.resetModules();
    const fresh = await import("../../src/state");
    expect(fresh.state.language).toBe("en");
  });

  it("关键字段类型正确：compareSelection 为 Set、resumeRenderCache 为 Map、定时器句柄", () => {
    expect(newState.state.compareSelection).toBeInstanceOf(Set);
    expect(newState.state.resumeRenderCache).toBeInstanceOf(Map);
    expect(newState.state.historyTotals).toEqual({ recent: 0, archived: 0 });
    expect(Array.isArray(newState.state.jobs)).toBe(true);
    // pollTimer / callPollTimer 为定时器句柄，可持有 setTimeout 返回值（浏览器为 number、Node 环境为对象）
    const timer = setTimeout(() => { }, 1000);
    newState.state.pollTimer = timer;
    newState.state.callPollTimer = timer;
    expect(newState.state.pollTimer).toBe(timer);
    expect(newState.state.callPollTimer).toBe(timer);
    clearTimeout(timer);
    newState.state.pollTimer = null;
    newState.state.callPollTimer = null;
  });

  it("模块局部 UI 状态（音频 Blob 缓存、软性维度选择、活动条目 id）不进入全局 state", () => {
    for (const field of ["audioBlobUrls", "audioBlobPending", "selectedSoftSkillDims", "activeCallItemId"]) {
      expect(field in newState.state, field).toBe(false);
    }
  });
});
