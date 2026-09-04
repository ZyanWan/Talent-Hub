# Debug 记录

本目录用于集中保存项目调试记录。

## 文件规范

- BUG 记录统一放在 `bugs/`，文件名使用简短、可检索的 kebab-case，例如 `bugs/wrong-server-501.md`。
- 同一类型的多个表现合并在一个文件，按问题类型命名。
- 调试记录包含状态、问题类型、表现、根因、修复和修复后验证。
- 状态统一使用 `[OPEN]` 或 `[CLOSED]`。

## 索引

| 状态 | 问题 | 目标 |
| --- | --- | --- |
| CLOSED | [history-workspace-state-consistency](./bugs/history-workspace-state-consistency.md) | 统一历史侧栏删除、归档、恢复与任务切换后的工作区状态 |
| CLOSED | [modal-backdrop-behavior](./bugs/modal-backdrop-behavior.md) | 统一公共遮罩的层叠覆盖与背景滚动锁定 |
| CLOSED | [async-concurrency-race](./bugs/async-concurrency-race.md) | 统一并发与轮询竞态导致的详情重绘与 PDF 渲染失败 |
| CLOSED | [call-audio-invalid-first-packet](./bugs/call-audio-invalid-first-packet.md) | 定位电话录音首个 AAC 包异常导致浏览器无法播放的问题 |
| CLOSED | [call-default-title-i18n](./bugs/call-default-title-i18n.md) | 定位电话任务默认标题不随语言切换的问题 |
| CLOSED | [phone-summary-judgment-regressions](./bugs/phone-summary-judgment-regressions.md) | 记录电话整理判断回归（语义/引用/视角/结构）的问题 |
| CLOSED | [wrong-server-501](./bugs/wrong-server-501.md) | 定位访问 127.0.0.1:8765 返回 Unsupported method GET 的原因 |