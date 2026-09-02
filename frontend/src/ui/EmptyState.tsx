// =====================================================================
// 空状态：支持两种形态。
// - variant="history"：.history-empty-state（flex 列居中、muted 文案，可选图标）
// - variant="table"：.empty-row > td（结果表空行，图标 + 文案，渲染 `tr.empty-row` 结构）
// =====================================================================

import type { HTMLAttributes, ReactNode } from "react";

export type EmptyStateVariant = "history" | "table";

export interface EmptyStateProps extends HTMLAttributes<HTMLElement> {
  variant?: EmptyStateVariant;
  /** 图标节点（可选），34px 蓝色弱化图标 */
  icon?: ReactNode;
  /** table 形态下 td 跨列数（结果表多列时用于整行居中） */
  colSpan?: number;
  /** 空状态文案 */
  children?: ReactNode;
}

export function EmptyState({ variant = "history", icon, colSpan, className, children, ...rest }: EmptyStateProps) {
  const merged = (base: string) => (className ? `${base} ${className}` : base);
  if (variant === "table") {
    return (
      <tr className={merged("empty-row")} {...rest}>
        <td colSpan={colSpan}>
          {icon}
          {children}
        </td>
      </tr>
    );
  }
  return (
    <div className={merged("history-empty-state")} {...rest}>
      {icon}
      {children}
    </div>
  );
}
