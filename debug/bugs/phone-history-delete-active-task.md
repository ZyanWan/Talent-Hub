# [CLOSED] 删除当前电话记录后主区域未重置

## 目标

删除电话记录侧栏中当前正在主区域展示的任务后，主区域立即回到电话筛选初始页，不再请求已删除任务。

## 观察

- 删除请求成功后，侧栏列表刷新并移除该记录，说明后端删除与列表刷新有效。
- 主区域继续显示被删除任务，后续刷新类操作会请求该任务并提示“任务不存在”。
- `HistoryDrawer.confirmDelete()` 成功路径只关闭确认框、刷新列表并显示提示，没有使当前任务失效。
- 当前电话任务保存在 `state.currentCall`，恢复键保存在 `talentHub.lastCall`；电话工作区重置由 `App` 的 `phoneResetSignal` 驱动。

## 假设

### H1：删除成功路径没有通知应用层清除当前任务（根假设）

- 支持：成功路径没有删除回调，也没有修改 `state.currentCall`、`talentHub.lastCall` 或 `phoneResetSignal`。
- 冲突：暂无。
- 实验：删除当前电话任务后断言 `state.currentCall` 变为 `null`。

### H2：在途轮询响应在删除后重新写回当前任务

- 支持：电话页存在定时轮询，响应会写入 `state.currentCall`。
- 冲突：当前实现连首次清空动作都不存在，且终态任务不轮询也可复现主区域不变。
- 实验：用 `done` 任务执行删除，排除轮询参与。

### H3：侧栏刷新使用了过期列表

- 支持：删除后会异步刷新列表。
- 冲突：已观察到侧栏记录立即消失，但主区域仍保留。
- 实验：同时断言列表记录消失和当前任务引用是否保留。

## 实验

- 在电话删除单元测试中设置 `state.currentCall.id = "call-1"`，删除成功后断言其为 `null`。
- 结果：断言失败，实际值仍为 `{ id: "call-1" }`。H1 得到确认；H2、H3 与最小复现不符。

## 根因

历史侧栏删除成功后没有向应用层传递被删记录身份，因此当前电话任务、恢复键和工作区状态均未失效。

## 修复

- `HistoryDrawer` 在删除成功后提交包含类型与 ID 的 `HistoryMutation`。
- `App` 仅当被删 ID 等于当前电话任务 ID 时清除恢复状态并触发电话工作区重置。
- 删除非当前任务时 ID 校验不通过，主区域保持不变。

## 修复后验证

- `node node_modules/vitest/vitest.mjs run tests/unit/history-drawer.test.tsx tests/unit/phone-view.test.tsx`：32 项通过。
- `node node_modules/vitest/vitest.mjs run`：199 项通过。
- `node node_modules/vite/bin/vite.js build`：生产构建通过。
