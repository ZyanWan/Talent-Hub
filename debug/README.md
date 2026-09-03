# Debug 记录

本目录用于集中保存项目调试记录。

## 文件规范

- 独立 BUG 记录统一放在 `bugs/`，文件名使用简短、可检索的 kebab-case，例如 `bugs/wrong-server-501.md`。
- 每个问题使用一个独立文件。
- 调试记录包含状态、目标、约束、假设、证据、结论和修复后验证。
- 状态统一使用 `[OPEN]` 或 `[CLOSED]`。

## 索引

| 状态 | 问题 | 目标 |
| --- | --- | --- |
| CLOSED | [history-workspace-state-consistency](./bugs/history-workspace-state-consistency.md) | 统一历史记录变更、任务切换与当前工作区状态 |
| CLOSED | [phone-history-delete-active-task](./bugs/phone-history-delete-active-task.md) | 定位删除当前电话记录后主区域未立即重置的问题 |
| CLOSED | [modal-scroll-through](./bugs/modal-scroll-through.md) | 定位模态框打开后滚轮仍能滚动背景页面的问题 |
| CLOSED | [screening-history-result-refresh](./bugs/screening-history-result-refresh.md) | 定位简历筛选结果页切换历史任务后主内容未即时刷新的问题 |
| CLOSED | [call-detail-backdrop-stacking](./bugs/call-detail-backdrop-stacking.md) | 定位电话条目详情遮罩无法覆盖顶栏语言按钮的问题 |
| CLOSED | [resume-preview-pdfium-race](./bugs/resume-preview-pdfium-race.md) | 定位有效 PDF 简历因 PDFium 并发访问而无法预览的问题 |
| CLOSED | [phone-screening-poll-race](./bugs/phone-screening-poll-race.md) | 记录电话确认页处理中轮询重绘打断已完成录音详情的问题 |
| CLOSED | [call-audio-invalid-first-packet](./bugs/call-audio-invalid-first-packet.md) | 定位电话录音首个 AAC 包异常导致浏览器无法播放的问题 |
| CLOSED | [wrong-server-501](./bugs/wrong-server-501.md) | 定位访问 127.0.0.1:8765 返回 Unsupported method GET 的原因 |
