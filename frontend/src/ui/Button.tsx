// =====================================================================
// 按钮基础组件：class 名与状态语义对齐全局按钮样式体系。
// - variant 映射：primary → .primary-button（黑底白字）、secondary → .secondary-button（白底描边）、
//   danger → .danger-button（红底）、icon → .icon-button（圆形 36px）、send → .send-button（黑色主 CTA）
// - busy 状态：加 .is-busy（前置 13px spinner 由 CSS ::before 绘制）、
//   同时置 disabled、写 aria-busy="true"；非 busy 时不携带 aria-busy 属性
// - 默认 type="button"，提交按钮由调用方显式传 type="submit"
// =====================================================================

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
