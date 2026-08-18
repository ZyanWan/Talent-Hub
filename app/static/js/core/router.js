"use strict";

// 视图路由与生命周期：集中管理「视图切换」与「轮询启停」。
// - registerView(name, { enter, exit })：注册视图生命周期钩子。约定：exit 负责停止「本视图自己的轮询」，
//   enter 负责启动（如需）。router 保证同一时刻仅一个视图激活（show 先 exit 旧视图、再 enter 新视图），
//   因此各视图只需管好自己的轮询字段、无需感知其他视图，天然互斥。
// - show(name)：切到指定视图（离开旧视图、隐藏所有 section、进入新视图）。
// - showSection(id)：只切换 section 可见性（同视图内重渲染时使用，不触发生命周期）。
// - currentView()：当前视图名，供轮询回调判断是否应丢弃过期结果（替代原先对 phoneView DOM 的读取）。

import { state } from "./state.js";
import { $ } from "./dom.js";

const SECTION_IDS = ["setupView", "progressView", "criteriaReviewView", "resultsView", "phoneView"];
const views = new Map();
let current = null;

export function registerView(name, hooks = {}) {
  views.set(name, hooks);
}

export function show(name) {
  if (name === current) return;
  if (current && views.get(current)?.exit) views.get(current).exit();
  current = name;
  hideAll();
  if (views.get(name)?.enter) views.get(name).enter();
}

export function currentView() {
  return current;
}

function hideAll() {
  for (const id of SECTION_IDS) $(id).hidden = true;
  $("resultActions").hidden = true;
  $("appendResumesButton").hidden = true;
  $("appendCallAudioButton").hidden = true;
  $("viewTitle").hidden = false;
}

export function showSection(sectionId) {
  hideAll();
  $(sectionId).hidden = false;
}
