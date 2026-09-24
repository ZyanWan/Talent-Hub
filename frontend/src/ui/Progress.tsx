// 进度条：对齐 .progress-track 结构，百分比收敛到 0-100 后内联为宽度。
// 电话视图的 .call-progress-track 结构一致，经 className 复用本组件。

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
