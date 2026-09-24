// 按钮基础组件：variant 映射到全局按钮样式类；busy 时加 .is-busy 并置 disabled 与 aria-busy。
// 默认 type="button"，提交按钮由调用方显式传 type="submit"。

import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "icon" | "send";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** 忙碌态：加 .is-busy、disabled、aria-busy="true" */
  busy?: boolean;
  children?: ReactNode;
}

export function Button({
  variant = "primary",
  busy = false,
  disabled,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  const classes = [`${variant}-button`];
  if (busy) classes.push("is-busy");
  if (className) classes.push(className);
  return (
    <button
      type={type}
      className={classes.join(" ")}
      disabled={disabled || busy}
      aria-busy={busy ? "true" : undefined}
      {...rest}
    >
      {children}
    </button>
  );
}
