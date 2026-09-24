// 提示 toast：对齐 .toast + hidden 显隐控制；自动隐藏定时属调用方逻辑。

import type { HTMLAttributes, ReactNode } from "react";

export interface ToastProps extends HTMLAttributes<HTMLDivElement> {
  /** false 时置 hidden，默认显示 */
  open?: boolean;
  children?: ReactNode;
}

export function Toast({ open = true, className, children, ...rest }: ToastProps) {
  const classes = className ? `toast ${className}` : "toast";
  return (
    <div className={classes} role="status" hidden={!open} {...rest}>
      {children}
    </div>
  );
}
