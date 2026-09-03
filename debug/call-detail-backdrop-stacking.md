[CLOSED]

# Debug Session: call-detail-backdrop-stacking

- Status: [CLOSED]
- Goal: 定位电话条目详情打开后顶栏语言按钮未被遮罩覆盖且仍可点击的问题。
- Constraint: 仅修复电话条目详情的挂载层级，不改变其他弹窗的全局层级。

## Observations

- `CallItemDetail` 在 `PhoneView` 的 `.phone-view` 节点内部渲染遮罩。
- `.phone-view` 使用带 `both` 填充模式的 `view-in` 透明度动画，形成独立层叠上下文。
- `.preview-backdrop` 使用 `position: fixed; inset: 0; z-index: 200`，但该层级只能在 `.phone-view` 的层叠上下文内参与排序。
- 顶栏语言按钮位于电话视图之外，并通过自身定位层级参与页面根层叠上下文排序。
- 现有详情测试覆盖关闭方式和内容，没有约束遮罩的挂载位置。

## Hypotheses

1. 详情遮罩被电话视图的动画层叠上下文限制。
   - 支持证据：遮罩是 `.phone-view` 后代，电话视图动画包含透明度并保留动画结果。
   - 冲突证据：无。
2. 遮罩本身的 `z-index` 数值过低。
   - 支持证据：提高层级通常能覆盖普通兄弟节点。
   - 冲突证据：遮罩层级为 200，语言按钮局部层级为 1；跨层叠上下文时继续提高子节点层级不能解决根因。
3. 遮罩尺寸没有覆盖顶栏。
   - 支持证据：视觉现象集中在页面右上角。
   - 冲突证据：遮罩使用固定定位和 `inset: 0`，尺寸定义覆盖完整视口。

## Root Cause

电话条目详情遮罩作为 `.phone-view` 的后代，被视图淡入动画形成的层叠上下文限制，无法覆盖处于页面根层叠上下文中的顶栏语言按钮。

## Fix

- `CallItemDetail` 通过 React Portal 将遮罩直接挂到 `document.body`。
- 保留现有 `z-index`、动画、ESC 和点击遮罩不关闭的编辑弹窗行为。
- 回归测试断言遮罩的直接父节点为 `document.body`。

## Post-fix Verification

- 电话条目详情单元测试通过。
- 前端完整单元测试和生产构建通过。
- 实际页面中遮罩的直接父节点为 `BODY`；语言切换按钮中心坐标命中详情遮罩内部元素，不命中语言按钮。
