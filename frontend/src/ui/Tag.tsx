// 结论标签：grade 映射等级修饰类（A→a、B→b、其余→c），由调用方换算后传入。

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
