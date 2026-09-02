// =====================================================================
// 状态点：对齐 .status-dot（默认金色「未就绪」态）与 .status-dot.ready（蓝色就绪态）。
// 仅以 classList.toggle("ready") 切换就绪态，无独立的 error 样式类，
// 故 error 语义映射为基类 .status-dot（不带修饰类，沿用默认金色底）。
// =====================================================================

import type { HTMLAttributes } from "react";

export type StatusDotStatus = "ready" | "error";

export interface StatusDotProps extends HTMLAttributes<HTMLSpanElement> {
  /** 默认 error（基类金色态，即未就绪/异常）；ready 时追加 .ready */
  status?: StatusDotStatus;
}

export function StatusDot({ status = "error", className, ...rest }: StatusDotProps) {
  const classes = ["status-dot"];
  if (status === "ready") classes.push("ready");
  if (className) classes.push(className);
  return <span className={classes.join(" ")} {...rest} />;
}
