// =====================================================================
// 结论标签：对齐 .conclusion + 等级修饰类（.a 浅蓝 / .b 浅金 / .c 浅红）。
// 等级映射：A→a、B→b、其余→c，由调用方换算后传入 grade。
// =====================================================================

import type { HTMLAttributes, ReactNode } from "react";

export type ConclusionGrade = "a" | "b" | "c";

export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  grade: ConclusionGrade;
  children?: ReactNode;
}

export function Tag({ grade, className, children, ...rest }: TagProps) {
  const classes = ["conclusion", grade];
  if (className) classes.push(className);
  return (
    <span className={classes.join(" ")} {...rest}>
      {children}
    </span>
  );
}
