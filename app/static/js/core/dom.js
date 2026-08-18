"use strict";

// 元素查找助手：缺失时告警，帮助「新页面漏元素」类问题尽早暴露。
export const $ = (id) => {
  const el = document.getElementById(id);
  if (!el) console.warn(`[dom] Missing element #${id}`);
  return el;
};
