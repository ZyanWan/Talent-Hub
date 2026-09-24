// 状态点：ready 时追加 .ready，其余状态只用基类 .status-dot。

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
