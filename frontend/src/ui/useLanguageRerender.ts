import { useCallback, useEffect, useState } from "react";
import { onChange } from "../i18n";

// 语言切换后强制重渲染：组件内文案与按语言计算的展示值需要随语言更新。
// 组件卸载后停止响应广播，避免对已卸载组件触发状态更新。
// 返回的重渲染函数身份稳定，可安全用作 effect 依赖或透传给子组件。
export function useLanguageRerender(): () => void {
  const [, forceRender] = useState(0);
  const rerender = useCallback(() => forceRender((n) => n + 1), []);
  useEffect(() => {
    let active = true;
    onChange(() => {
      if (active) rerender();
    });
    return () => {
      active = false;
    };
  }, [rerender]);
  return rerender;
}
