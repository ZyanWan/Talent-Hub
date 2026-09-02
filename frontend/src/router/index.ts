// =====================================================================
// 视图路由与生命周期：集中管理「视图切换」与「轮询启停」。
// - registerView(name, { enter, exit })：注册视图生命周期钩子。约定：exit 负责停止「本视图自己的轮询」，
//   enter 负责启动（如需）。router 保证同一时刻仅一个视图激活（show 先 exit 当前视图、再 enter 新视图），
//   因此各视图只需管好自己的轮询字段、无需感知其他视图，天然互斥。
// - show(name)：切到指定视图（离开当前视图、隐藏所有 section、进入新视图）。
// - showSection(id)：只切换 section 可见性（同视图内重渲染时使用，不触发生命周期）。
// - currentView()：当前视图名，供轮询回调判断是否应丢弃过期结果。
// 路由行为契约：本模块不读取全局 state。
// =====================================================================

export interface ViewHooks {
  enter?: () => void;
  exit?: () => void;
}

const SECTION_IDS = ["setupView", "progressView", "criteriaReviewView", "resultsView", "phoneView"];
const views = new Map<string, ViewHooks>();
let current: string | null = null;

// 元素查找：缺失时告警，帮助「新页面漏元素」类问题尽早暴露。
function $(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) console.warn(`[dom] Missing element #${id}`);
  return node as HTMLElement;
}

export function registerView(name: string, hooks: ViewHooks = {}): void {
  views.set(name, hooks);
}

export function show(name: string): void {
  if (name === current) return;
  const old = current ? views.get(current) : undefined;
  if (old?.exit) old.exit();
  current = name;
  hideAll();
  const next = views.get(name);
  if (next?.enter) next.enter();
}

export function currentView(): string | null {
  return current;
}

function hideAll(): void {
  for (const id of SECTION_IDS) $(id).hidden = true;
  $("resultActions").hidden = true;
  $("appendResumesButton").hidden = true;
  $("appendCallAudioButton").hidden = true;
  $("viewTitle").hidden = false;
}

export function showSection(sectionId: string): void {
  hideAll();
  $(sectionId).hidden = false;
}
