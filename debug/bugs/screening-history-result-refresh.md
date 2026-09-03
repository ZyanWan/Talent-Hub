[CLOSED]

# Debug Session: screening-history-result-refresh

- Status: [CLOSED]
- Goal: 定位简历筛选结果页从任务记录切换到另一任务后，主内容未即时刷新的原因。
- Constraint: 仅修复历史筛选任务的打开链路，不调整全局状态结构、API 或电话筛选逻辑。

## Observations

- 已完成的筛选任务 A 和任务 B 都映射到 `results` 视图。
- 点击任务记录 B 时，抽屉先关闭，随后 `openJob()` 异步请求任务 B。
- 请求成功后，`openJob()` 将任务 B 直接写入普通全局对象 `state.currentJob`，再调用 `navigate("results")`。
- 当前视图已经是 `results` 时，React 会忽略值相同的 `setView("results")`，主内容区不会重新渲染。
- 抽屉关闭产生的渲染发生在任务 B 请求返回前；之后手动收起或展开侧边栏会触发新的渲染，此时主内容区才读取并显示任务 B。
- 电话筛选页通过 React state 中的 `callOpenRequest` 触发任务选择，并在任务请求成功后显式调用 `rerender()`，因此同一页面内切换任务不会依赖路由值变化。

## Hypotheses

1. 任务 B 接口返回了任务 A 的数据。
   - 支持证据：主内容区继续显示任务 A。
   - 冲突证据：侧边栏再次开合后能显示任务 B，说明 `state.currentJob` 已经包含任务 B。
2. 侧边栏遮罩或布局阻止结果内容绘制。
   - 支持证据：问题在侧边栏展开时触发。
   - 冲突证据：侧边栏关闭后结果仍不更新，只有后续新的 React 渲染才显示任务 B。
3. 同一结果视图内切换任务缺少 React 渲染通知。
   - 支持证据：`state.currentJob` 是普通全局对象；A、B 都调用 `navigate("results")`，相同的视图 state 不触发渲染；任意后续界面 state 变化都会显示任务 B。
   - 冲突证据：无。

## Root Cause

历史筛选任务打开链路依赖路由 state 变化带动 React 渲染。任务 A 和任务 B 都处于最终结果页时，`state.currentJob` 已更新，但路由值仍为 `results`，因此任务请求完成后没有新的渲染通知。抽屉关闭发生得更早，无法渲染尚未返回的任务 B。

## Fix

- `openJob()` 成功写入 `state.currentJob` 并完成状态路由后，显式触发一次 App 渲染。
- 保留现有 API、路由、轮询和全局状态结构。
- 增加回归测试，覆盖结果页显示任务 A 时从任务记录打开任务 B，并断言主内容立即显示 B、A 不再显示。

## Post-fix Verification

- `frontend/tests/unit/app-shell.test.tsx` 通过，共 13 项测试。
- 回归用例覆盖 `results` 到 `results` 的历史任务切换，不依赖再次收起或展开侧边栏。
- 未运行系统性测试或视觉测试。
