import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// =====================================================================
// 自定义下拉组件（src/ui/customSelect）行为测试（jsdom）。
// 覆盖：隐藏 select 值载体读写与 change 事件、菜单渲染与动态 option 同步、
// 键盘导航、方向自适应（按视口/最近滚动容器向上弹出）、语言切换重建。
// jsdom 无 requestAnimationFrame，测试中同步 stub 以保证展开状态即时可见。
// =====================================================================

type CustomSelect = typeof import("../../src/ui/customSelect");
type CustomSelectHandle = ReturnType<CustomSelect["createCustomSelect"]>;

const OPTIONS_HTML = `
  <option value="all">全部</option>
  <option value="a">优先约面</option>
  <option value="b">电话确认</option>
  <option value="c">不推进</option>
`;

const WRAP_HTML = `
  <div class="custom-select" id="wrap">
    <button type="button" class="custom-select-trigger" aria-haspopup="listbox" aria-expanded="false">
      <span class="custom-select-value"></span>
      <svg class="custom-select-arrow" aria-hidden="true" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>
    </button>
    <div class="custom-select-menu" role="listbox" hidden></div>
  </div>
`;

function mount(wrapHtml = WRAP_HTML): {
  wrap: HTMLElement;
  select: HTMLSelectElement;
  menu: HTMLElement;
  trigger: HTMLElement;
  handle: CustomSelectHandle;
} {
  // select 与 wrap 为兄弟节点，与生产 index.html 结构一致
  document.body.innerHTML = `${wrapHtml}<select id="sel" hidden>${OPTIONS_HTML}</select>`;
  const wrap = document.getElementById("wrap") as HTMLElement;
  const select = document.getElementById("sel") as HTMLSelectElement;
  return {
    wrap,
    select,
    menu: wrap.querySelector(".custom-select-menu") as HTMLElement,
    trigger: wrap.querySelector(".custom-select-trigger") as HTMLElement,
    handle: cs.createCustomSelect({ wrap, select }),
  };
}

let cs: CustomSelect;
let wrap: HTMLElement;
let select: HTMLSelectElement;
let menu: HTMLElement;
let trigger: HTMLElement;
let handle: CustomSelectHandle;

beforeEach(async () => {
  localStorage.clear();
  vi.resetModules();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  cs = await import("../../src/ui/customSelect");
  ({ wrap, select, menu, trigger, handle } = mount());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("值载体读写与菜单渲染", () => {
  it("sync() 从 select.options 渲染菜单并回填触发器文本", () => {
    handle.sync();
    const options = [...menu.querySelectorAll('[role="option"]')];
    expect(options).toHaveLength(4);
    expect(options.map((o) => o.textContent)).toEqual(["全部", "优先约面", "电话确认", "不推进"]);
    expect(trigger.querySelector(".custom-select-value")!.textContent).toBe("全部");
  });

  it("写 select.value 后 sync()：aria-selected 与触发器文本随值更新", () => {
    select.value = "b";
    handle.sync();
    expect(menu.querySelector('[aria-selected="true"]')!.getAttribute("data-value")).toBe("b");
    expect(trigger.querySelector(".custom-select-value")!.textContent).toBe("电话确认");
  });
});

describe("选择交互：值写入与 change 事件", () => {
  it("点击选项写入 select.value 并派发 bubbles change", () => {
    handle.sync();
    const change = vi.fn();
    select.addEventListener("change", change);
    trigger.click();
    (menu.querySelector('[data-value="a"]') as HTMLElement).dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
    expect(select.value).toBe("a");
    expect(change).toHaveBeenCalledTimes(1);
    expect(change.mock.calls[0][0].bubbles).toBe(true);
    expect(trigger.querySelector(".custom-select-value")!.textContent).toBe("优先约面");
  });

  it("选中当前值不重复派发 change（仍重建并收起）", () => {
    handle.sync();
    const change = vi.fn();
    select.addEventListener("change", change);
    trigger.click();
    (menu.querySelector('[data-value="all"]') as HTMLElement).dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
    expect(change).not.toHaveBeenCalled();
    expect(wrap.classList.contains("is-open")).toBe(false);
  });

  it("点击容器外部（select 兄弟节点）关闭菜单", () => {
    handle.sync();
    trigger.click();
    expect(wrap.classList.contains("is-open")).toBe(true);
    select.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(wrap.classList.contains("is-open")).toBe(false);
  });
});

describe("动态 option 同步", () => {
  it("新增/删除 option 后 sync() 重建菜单", () => {
    handle.sync();
    const option = document.createElement("option");
    option.value = "d";
    option.textContent = "待定";
    select.add(option);
    handle.sync();
    expect(menu.querySelectorAll('[role="option"]')).toHaveLength(5);
    expect(menu.querySelector('[data-value="d"]')!.textContent).toBe("待定");
    select.remove(0);
    handle.sync();
    expect(menu.querySelectorAll('[role="option"]')).toHaveLength(4);
    expect(menu.querySelector('[data-value="all"]')).toBeNull();
  });
});

describe("键盘导航", () => {
  it("ArrowDown 展开菜单并聚焦当前选中项", () => {
    select.value = "b";
    handle.sync();
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    expect(wrap.classList.contains("is-open")).toBe(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(menu.querySelector('[data-value="b"]'));
  });

  it("菜单内 ArrowDown/ArrowUp 循环移动高亮", () => {
    handle.sync();
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(menu.querySelector('[data-value="a"]'));
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(menu.querySelector('[data-value="b"]'));
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(menu.querySelector('[data-value="a"]'));
    // 从首项向上循环到末项
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }));
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(menu.querySelector('[data-value="c"]'));
  });

  it("Enter 选中聚焦项：写值、派发 change、收起", () => {
    handle.sync();
    const change = vi.fn();
    select.addEventListener("change", change);
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })); // a
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(select.value).toBe("a");
    expect(change).toHaveBeenCalledTimes(1);
    expect(wrap.classList.contains("is-open")).toBe(false);
    expect(trigger.querySelector(".custom-select-value")!.textContent).toBe("优先约面");
  });

  it("Space 与 Enter 等价", () => {
    handle.sync();
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
    expect(select.value).toBe("a");
    expect(wrap.classList.contains("is-open")).toBe(false);
  });

  it("Escape 关闭菜单并把焦点还给触发器", () => {
    handle.sync();
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(wrap.classList.contains("is-open")).toBe(false);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });

  it("触发器上按 Escape 直接关闭", () => {
    handle.sync();
    trigger.click();
    expect(wrap.classList.contains("is-open")).toBe(true);
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(wrap.classList.contains("is-open")).toBe(false);
  });

  it("菜单内按 Tab 关闭", () => {
    handle.sync();
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    expect(wrap.classList.contains("is-open")).toBe(false);
  });
});

describe("方向自适应", () => {
  it("视口底部空间不足时向上弹出（menu-up）", () => {
    trigger.getBoundingClientRect = () => ({ bottom: 900 }) as DOMRect;
    trigger.click();
    expect(wrap.classList.contains("menu-up")).toBe(true);
    expect(wrap.classList.contains("is-open")).toBe(true);
  });

  it("按最近滚动容器底部判断：容器限高向上、空间足够向下", () => {
    const scrolled = mount(`
      <div id="scrollbox" style="overflow-y: auto; height: 100px;">
        ${WRAP_HTML}
      </div>
    `);
    const scrollbox = document.getElementById("scrollbox") as HTMLElement;
    const menu2 = scrolled.menu;
    Object.defineProperty(menu2, "scrollHeight", { value: 300, configurable: true });
    scrolled.trigger.getBoundingClientRect = () => ({ bottom: 50 }) as DOMRect;

    scrollbox.getBoundingClientRect = () => ({ bottom: 100 }) as DOMRect;
    scrolled.trigger.click();
    expect(scrolled.wrap.classList.contains("menu-up")).toBe(true);

    scrolled.handle.close();
    scrollbox.getBoundingClientRect = () => ({ bottom: 500 }) as DOMRect;
    scrolled.trigger.click();
    expect(scrolled.wrap.classList.contains("menu-up")).toBe(false);
  });
});

describe("语言切换重建", () => {
  it("onChange 订阅：语言切换后菜单与触发器文本随 option 文案重建", async () => {
    handle.sync();
    // 语言切换逻辑更新 option 文案在前，组件经 onChange 订阅重建菜单
    select.options[0].textContent = "No linked job";
    const i18n = await import("../../src/i18n");
    i18n.setLanguage("en");
    expect(menu.querySelector('[role="option"]')!.textContent).toBe("No linked job");
    expect(trigger.querySelector(".custom-select-value")!.textContent).toBe("No linked job");
  });
});

describe("收起过渡", () => {
  it("close() 立即移除展开态，200ms 延迟后隐藏菜单", async () => {
    handle.sync();
    trigger.click();
    expect(wrap.classList.contains("is-open")).toBe(true);
    handle.close();
    expect(wrap.classList.contains("is-open")).toBe(false);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await vi.waitFor(() => expect(menu.hidden).toBe(true));
  });
});
