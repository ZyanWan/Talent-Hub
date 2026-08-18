"use strict";

import { onChange } from "./i18n.js";
import { measureSelectFlip } from "./utils.js";

// 自定义下拉组件：隐藏的原生 <select> 做值载体 + 自绘菜单。
// 展开/收起带过渡动画、键盘导航、方向自适应（不撑出滚动条）、语言切换自动重建菜单。
// 用法：
//   const sel = createCustomSelect({ wrap, select });
//   // wrap  = .custom-select 容器（内含 .custom-select-trigger 与 .custom-select-menu）
//   // select = 隐藏的原生 select（选项来源 + 值载体，值变化派发 change 事件）
//   sel.sync();   // 选项/值变化后重建菜单（值回填、动态选项加载完成后调用）
//   sel.close();  // 收起菜单
export function createCustomSelect({ wrap, select }) {
  const trigger = wrap.querySelector(".custom-select-trigger");
  const menu = wrap.querySelector(".custom-select-menu");
  let menuTimer = null;

  function sync() {
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
    trigger.querySelector(".custom-select-value").textContent = current ? current.textContent : "";
  }

  function close() {
    wrap.classList.remove("is-open");
    trigger.setAttribute("aria-expanded", "false");
    clearTimeout(menuTimer);
    menuTimer = setTimeout(() => { menu.hidden = true; }, 200);
  }

  function toggle(force) {
    const opening = force ?? !wrap.classList.contains("is-open");
    if (opening) {
      if (wrap.classList.contains("is-open")) return;
      clearTimeout(menuTimer); // 取消上一次关闭的延迟隐藏，防止快速重开时菜单被旧定时器收起
      menu.hidden = false;
      // 底部空间不足时向上弹出（以滚动容器/视口底部为界，避免撑出滚动条）
      wrap.classList.toggle("menu-up", measureSelectFlip(trigger, menu));
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!menu.hidden) {
          wrap.classList.add("is-open");
          trigger.setAttribute("aria-expanded", "true");
        }
      }));
    } else {
      close();
    }
  }

  function pick(value) {
    if (select.value !== value) {
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    sync();
    close();
  }

  function moveHighlight(direction) {
    const options = [...menu.querySelectorAll('[role="option"]')];
    if (!options.length) return; // 选项尚未加载（动态列表），直接忽略
    const current = options.findIndex((item) => item === document.activeElement);
    options[(current + direction + options.length) % options.length].focus();
  }

  function focusSelected() {
    const value = select.value;
    const item = menu.querySelector(`[data-value="${value}"]`) || menu.querySelector('[role="option"]');
    if (item) item.focus();
  }

  trigger.addEventListener("click", () => {
    toggle();
    // shell.js 全局点击会 blur 非 dialog 内按钮，延迟一帧把焦点还给触发器，保证展开后键盘可用
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
      if (item) pick(item.dataset.value);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveHighlight(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Tab") {
      close();
    }
  });
  document.addEventListener("click", (event) => {
    if (!wrap.contains(event.target) && wrap.classList.contains("is-open")) close();
  });
  // 语言切换时重建菜单（select option 文案由 applyStaticLanguage 更新在前）
  onChange(() => sync());

  return { sync, close };
}
