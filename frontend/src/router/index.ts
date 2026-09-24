// 视图路由与生命周期：集中管理视图切换与轮询启停。
// 契约：本模块不读取全局 state；同一时刻仅一个视图激活，各视图只在自己的 exit 停止所属轮询。

export interface ViewHooks {
  enter?: () => void;
  exit?: () => void;
}

const SECTION_IDS = ["setupView", "progressView", "criteriaReviewView", "resultsView", "phoneView"];
const views = new Map<string, ViewHooks>();
let current: string | null = null;

// 元素查找：缺失时告警，尽早暴露新页面漏元素的问题。
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
