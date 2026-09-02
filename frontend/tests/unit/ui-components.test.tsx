// =====================================================================
// 基础 UI 组件（src/ui/*）渲染级测试（jsdom）。
// 覆盖：按钮五种变体 class / busy（is-busy + disabled + aria-busy）/ 常规 disabled /
// 状态点 ready/error class、结论标签 a/b/c class、进度条宽度与收敛、toast 显隐、
// 空状态两种形态与文案。
// 仅做渲染级断言，不含截图验证（视觉回归由 tests/visual/baseline.spec.ts 覆盖）。
// =====================================================================

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "../../src/ui/Button";
import { EmptyState } from "../../src/ui/EmptyState";
import { Progress } from "../../src/ui/Progress";
import { StatusDot } from "../../src/ui/StatusDot";
import { Tag } from "../../src/ui/Tag";
import { Toast } from "../../src/ui/Toast";

describe("Button 按钮", () => {
  it("默认 primary 变体：primary-button class + children", () => {
    render(<Button>开始筛选</Button>);
    const button = screen.getByRole("button", { name: "开始筛选" });
    expect(button).toHaveClass("primary-button");
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute("aria-busy");
    expect(button).toHaveAttribute("type", "button");
  });

  it("五种变体映射到对应 class", () => {
    const { rerender } = render(<Button variant="primary">a</Button>);
    expect(screen.getByRole("button")).toHaveClass("primary-button");
    rerender(<Button variant="secondary">a</Button>);
    expect(screen.getByRole("button")).toHaveClass("secondary-button");
    rerender(<Button variant="danger">a</Button>);
    expect(screen.getByRole("button")).toHaveClass("danger-button");
    rerender(<Button variant="icon">a</Button>);
    expect(screen.getByRole("button")).toHaveClass("icon-button");
    rerender(<Button variant="send">a</Button>);
    expect(screen.getByRole("button")).toHaveClass("send-button");
  });

  it("busy 时加 .is-busy、disabled 且 aria-busy=true", () => {
    render(<Button busy>提交中</Button>);
    const button = screen.getByRole("button");
    expect(button).toHaveClass("is-busy");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("非 busy 时不携带 aria-busy 且可点", () => {
    render(<Button>普通</Button>);
    const button = screen.getByRole("button");
    expect(button).not.toHaveClass("is-busy");
    expect(button).not.toHaveAttribute("aria-busy");
    expect(button).toBeEnabled();
  });

  it("disabled prop 单独生效，busy 不依赖外部 disabled", () => {
    render(<Button disabled>禁用</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("icon 变体可追加额外 class（如 close-button）", () => {
    render(<Button variant="icon" className="close-button">×</Button>);
    expect(screen.getByRole("button")).toHaveClass("icon-button", "close-button");
  });
});

describe("StatusDot 状态点", () => {
  it("默认 error 语义：仅基类 status-dot，不带 ready", () => {
    render(<StatusDot />);
    const dot = document.querySelector(".status-dot");
    expect(dot).not.toBeNull();
    expect(dot).toHaveClass("status-dot");
    expect(dot).not.toHaveClass("ready");
  });

  it("ready 时追加 .ready", () => {
    render(<StatusDot status="ready" />);
    expect(document.querySelector(".status-dot")).toHaveClass("status-dot", "ready");
  });

  it("error 时仅渲染基类（无独立 error 样式类）", () => {
    render(<StatusDot status="error" />);
    expect(document.querySelector(".status-dot")).toHaveClass("status-dot");
    expect(document.querySelector(".status-dot")).not.toHaveClass("ready");
  });
});

describe("Tag 结论标签", () => {
  it("grade=a 渲染 conclusion a", () => {
    render(<Tag grade="a">优先约面</Tag>);
    const tag = screen.getByText("优先约面");
    expect(tag).toHaveClass("conclusion", "a");
  });

  it("grade=b / grade=c 渲染对应修饰类", () => {
    const { rerender } = render(<Tag grade="b">电话确认</Tag>);
    expect(screen.getByText("电话确认")).toHaveClass("conclusion", "b");
    rerender(<Tag grade="c">不推进</Tag>);
    expect(screen.getByText("不推进")).toHaveClass("conclusion", "c");
  });
});

describe("Progress 进度条", () => {
  it("内嵌填充 span 宽度等于 value%", () => {
    render(<Progress value={42} />);
    const track = document.querySelector(".progress-track");
    expect(track).not.toBeNull();
    const fill = track!.querySelector("span");
    expect(fill).toHaveStyle({ width: "42%" });
  });

  it("越界值收敛到 0-100", () => {
    const { rerender } = render(<Progress value={150} />);
    expect(document.querySelector(".progress-track span")).toHaveStyle({ width: "100%" });
    rerender(<Progress value={-10} />);
    expect(document.querySelector(".progress-track span")).toHaveStyle({ width: "0%" });
  });

  it("trackClassName 可复用电话进度条类名", () => {
    render(<Progress value={60} trackClassName="call-progress-track" />);
    expect(document.querySelector(".call-progress-track")).not.toBeNull();
    expect(document.querySelector(".progress-track")).toBeNull();
  });
});

describe("Toast 提示", () => {
  it("默认显示：toast class + role=status + children", () => {
    render(<Toast>保存成功</Toast>);
    const toast = screen.getByRole("status");
    expect(toast).toHaveClass("toast");
    expect(toast).toHaveTextContent("保存成功");
    expect(toast).not.toHaveAttribute("hidden");
  });

  it("open=false 时置 hidden", () => {
    render(<Toast open={false}>隐藏提示</Toast>);
    expect(screen.getByRole("status", { hidden: true })).toHaveAttribute("hidden");
  });
});

describe("EmptyState 空状态", () => {
  it("默认 history 形态：.history-empty-state + 文案", () => {
    render(<EmptyState>暂无任务记录</EmptyState>);
    const state = document.querySelector(".history-empty-state");
    expect(state).not.toBeNull();
    expect(state).toHaveTextContent("暂无任务记录");
  });

  it("icon 节点随文案一起渲染", () => {
    render(<EmptyState icon={<svg data-testid="empty-icon" />}>没有匹配的候选人</EmptyState>);
    expect(document.querySelector(".history-empty-state svg")).toBeInTheDocument();
    expect(document.querySelector(".history-empty-state")).toHaveTextContent("没有匹配的候选人");
  });

  it("table 形态：tr.empty-row > td 承载文案", () => {
    render(<EmptyState variant="table">本批次暂无结果</EmptyState>);
    const row = document.querySelector("tr.empty-row");
    expect(row).not.toBeNull();
    expect(row!.querySelector("td")).toHaveTextContent("本批次暂无结果");
  });
});
