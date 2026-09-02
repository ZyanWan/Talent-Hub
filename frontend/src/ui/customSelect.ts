// =====================================================================
// 自定义下拉组件：隐藏的原生 <select> 做值载体 + 自绘菜单。
// - 值读写与 change 事件仍走原生 select，消费方零改动
// - 菜单从 select.options 渲染，动态选项变化后调用 sync() 重建
// - 展开/收起过渡、键盘导航（方向键/Enter/Space/Tab/Escape）
// - 方向自适应：按最近滚动容器/视口底部判断向上/向下弹出，菜单限高 300px 内部滚动
// - 订阅 src/i18n 的 onChange，语言切换时自动重建菜单
// 用法：
//   const sel = createCustomSelect({ wrap, select });
//   // wrap   = .custom-select 容器（内含 .custom-select-trigger 与 .custom-select-menu）
//   // select = 隐藏的原生 select（选项来源 + 值载体，值变化派发 change 事件）
//   sel.sync();   // 选项/值变化后重建菜单（值回填、动态选项加载完成后调用）
//   sel.close();  // 收起菜单
// =====================================================================

import { onChange } from "../i18n";

export interface CustomSelectHandle {
  /** 选项/值变化后重建菜单（值回填、动态选项加载完成后调用） */
  sync(): void;
  /** 收起菜单 */
  close(): void;
}

export function createCustomSelect(options: {
  wrap: HTMLElement;
  select: HTMLSelectElement;
}): CustomSelectHandle {
  const { wrap, select } = options;
  const trigger = wrap.querySelector(".custom-select-trigger") as HTMLButtonElement;
  const menu = wrap.querySelector(".custom-select-menu") as HTMLElement;
  let menuTimer: ReturnType<typeof setTimeout> | null = null;

  function sync(): void {
    const value = select.value;
    menu.replaceChildren();
    for (const option of select.options) {
      const item = document.createElement("button");
      item.type = "button";
      item.role = "option";
      item.dataset.value = option.value;
      item.textContent = option.textContent;
      item.setAttribute("aria-selected", String(option.value === value));
      item.addEventListener("click", () => pick(option.value));
      menu.append(item);
    }
    const current = select.options[select.selectedIndex] || select.options[0];
    (trigger.querySelector(".custom-select-value") as HTMLElement).textContent = current
      ? current.textContent
      : "";
  }

  function close(): void {
    wrap.classList.remove("is-open");
    trigger.setAttribute("aria-expanded", "false");
    if (menuTimer) clearTimeout(menuTimer);
    menuTimer = setTimeout(() => {
      menu.hidden = true;
    }, 200);
  }

  function measureSelectFlip(): boolean {
    const menuHeight = Math.min(menu.scrollHeight, 300);
    const triggerRect = trigger.getBoundingClientRect();
    let limit = window.innerHeight;
    let node = trigger.parentElement;
    while (node && node !== document.body) {
      if (/(auto|scroll|overlay)/.test(getComputedStyle(node).overflowY)) {
        limit = node.getBoundingClientRect().bottom;
        break;
      }
      node = node.parentElement;
    }
    return triggerRect.bottom + menuHeight + 8 > limit;
  }

  function toggle(force?: boolean): void {
    const opening = force ?? !wrap.classList.contains("is-open");
    if (opening) {
      if (wrap.classList.contains("is-open")) return;
      if (menuTimer) clearTimeout(menuTimer); // 取消上一次关闭的延迟隐藏，防止快速重开时菜单被上一个定时器收起
      menu.hidden = false;
      // 底部空间不足时向上弹出（以滚动容器/视口底部为界，避免撑出滚动条）
      wrap.classList.toggle("menu-up", measureSelectFlip());
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!menu.hidden) {
            wrap.classList.add("is-open");
            trigger.setAttribute("aria-expanded", "true");
          }
        })
      );
    } else {
      close();
    }
  }

  function pick(value: string): void {
    if (select.value !== value) {
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    sync();
    close();
  }

  function moveHighlight(direction: number): void {
    const options = [...menu.querySelectorAll<HTMLElement>('[role="option"]')];
    if (!options.length) return; // 选项尚未加载（动态列表），直接忽略
    const current = options.findIndex((item) => item === document.activeElement);
    options[(current + direction + options.length) % options.length].focus();
  }

  function focusSelected(): void {
    const value = select.value;
    const item = menu.querySelector(`[data-value="${value}"]`) || menu.querySelector('[role="option"]');
    if (item) (item as HTMLElement).focus();
  }

  trigger.addEventListener("click", () => {
    toggle();
    // 全局点击会 blur 非 dialog 内按钮，延迟一帧把焦点还给触发器，保证展开后键盘可用
    setTimeout(() => trigger.focus(), 0);
  });
  trigger.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    if (!wrap.classList.contains("is-open")) {
      toggle(true);
      focusSelected();
    } else {
      moveHighlight(event.key === "ArrowDown" ? 1 : -1);
    }
  });
  menu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      trigger.focus(); // 焦点落回触发器，避免停留在即将隐藏的选项上
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const item = menu.querySelector('[role="option"]:focus');
      if (item) pick((item as HTMLElement).dataset.value ?? "");
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveHighlight(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Tab") {
      close();
    }
  });
  document.addEventListener("click", (event) => {
    if (!wrap.contains(event.target as Node) && wrap.classList.contains("is-open")) close();
  });
  // 语言切换时重建菜单：option 文案由 React 异步提交 DOM，故 onChange 回调经
  // 双 requestAnimationFrame 延迟到提交完成后执行 sync()，避免读到切换前文案
  let raf1 = 0;
  let raf2 = 0;
  onChange(() => {
    cancelAnimationFrame(raf1);
    raf1 = requestAnimationFrame(() => {
      cancelAnimationFrame(raf2);
      raf2 = requestAnimationFrame(() => sync());
    });
  });

  return { sync, close };
}
