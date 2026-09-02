// =====================================================================
// 进度条：对齐 .progress-track（高 4px、圆角、--surface-muted 底）内嵌填充 span，
// 填充色 #4673c4、宽度经 style 内联控制并做 0-100 收敛。
// 电话视图的 .call-progress-track 与基础进度条结构一致，通过 className 传覆盖类名复用。
// =====================================================================

import type { HTMLAttributes } from "react";

export interface ProgressProps extends HTMLAttributes<HTMLDivElement> {
  /** 进度百分比 0-100，越界自动收敛 */
  value: number;
  /** 轨道类名，默认 .progress-track；复用电话进度条时传 "call-progress-track" */
  trackClassName?: string;
}

export function Progress({ value, trackClassName, className, ...rest }: ProgressProps) {
  const clamped = Math.min(100, Math.max(0, Number(value) || 0));
  const trackClass = trackClassName ?? "progress-track";
  const classes = className ? `${trackClass} ${className}` : trackClass;
  return (
    <div className={classes} {...rest}>
      <span style={{ width: `${clamped}%` }} />
    </div>
  );
}
