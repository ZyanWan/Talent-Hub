import { beforeEach, describe, expect, it, vi } from "vitest";

// =====================================================================
// router.show() 生命周期顺序：show 必须「exit 旧视图 → hide all → enter 新视图」；
// 同一时刻仅一个视图激活；exit 负责停本视图轮询（互斥基础）。
// =====================================================================

type Router = typeof import("../../src/router/index.js");
let router: Router;

const callOrder: string[] = [];

beforeEach(async () => {
  callOrder.length = 0;
  document.body.innerHTML = `
    <section id="setupView"></section>
    <section id="progressView"></section>
    <section id="criteriaReviewView"></section>
    <section id="resultsView"></section>
    <section id="phoneView"></section>
    <div id="resultActions"></div>
    <button id="appendResumesButton"></button>
    <button id="appendCallAudioButton"></button>
    <h1 id="viewTitle"></h1>
  `;
  vi.resetModules();
  router = await import("../../src/router/index.js");
});

describe("router 视图生命周期（契约）", () => {
  it("show 首次进入：仅调用 enter，不调用 exit", () => {
    router.registerView("screening", {
      enter: () => callOrder.push("enter:screening"),
      exit: () => callOrder.push("exit:screening"),
    });
    router.show("screening");
    expect(router.currentView()).toBe("screening");
    expect(callOrder).toEqual(["enter:screening"]);
  });

  it("show 切换：顺序为 exit(old) → hide all → enter(new)", () => {
    router.registerView("screening", {
      enter: () => callOrder.push("enter:screening"),
      exit: () => callOrder.push("exit:screening"),
    });
    router.registerView("phone", {
      enter: () => callOrder.push("enter:phone"),
      exit: () => callOrder.push("exit:phone"),
    });
    router.show("screening");
    callOrder.length = 0;
    router.show("phone");
    expect(callOrder).toEqual(["exit:screening", "enter:phone"]);
    expect(router.currentView()).toBe("phone");
  });

  it("同一视图重复 show：直接返回，不重复触发生命周期", () => {
    router.registerView("screening", { enter: () => callOrder.push("e") });
    router.show("screening");
    router.show("screening");
    expect(callOrder).toEqual(["e"]);
  });

  it("切换后所有 section 被隐藏（hide all）", () => {
    router.registerView("screening", { enter: () => { } });
    document.getElementById("setupView")!.hidden = false;
    router.show("screening");
    const hiddenIds = [
      "setupView",
      "progressView",
      "criteriaReviewView",
      "resultsView",
      "phoneView",
      "resultActions",
      "appendResumesButton",
      "appendCallAudioButton",
    ];
    for (const id of hiddenIds) {
      expect(document.getElementById(id)!.hidden, id).toBe(true);
    }
    expect(document.getElementById("viewTitle")!.hidden).toBe(false);
  });

  it("exit 钩子负责停止轮询：视图切换时 exit 被调用（防旧轮询串扰）", () => {
    const exit = vi.fn();
    router.registerView("screening", { exit });
    router.registerView("phone", { enter: () => { } });
    router.show("screening");
    expect(exit).not.toHaveBeenCalled();
    router.show("phone");
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("currentView 反映当前视图（轮询回调据此丢弃过期结果）", () => {
    router.registerView("a", {});
    router.registerView("b", {});
    router.show("a");
    expect(router.currentView()).toBe("a");
    router.show("b");
    expect(router.currentView()).toBe("b");
  });

  it("未注册的视图也可 show（currentView 仍更新，enter/exit 缺省安全）", () => {
    router.show("unregistered");
    expect(router.currentView()).toBe("unregistered");
  });
});
