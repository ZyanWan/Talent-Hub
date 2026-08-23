# Debug 记录

本目录用于集中保存项目调试记录。

## 文件规范

- 文件名使用简短、可检索的 kebab-case，例如 `wrong-server-501.md`。
- 每个问题使用一个独立文件。
- 调试记录包含状态、目标、约束、假设、证据、结论和修复后验证。
- 状态统一使用 `[OPEN]` 或 `[CLOSED]`。

## 索引

| 状态 | 问题 | 目标 |
| --- | --- | --- |
| CLOSED | [phone-screening-poll-race](./phone-screening-poll-race.md) | 记录电话确认页处理中轮询重绘打断已完成录音详情的问题 |
| OPEN | [wrong-server-501](./wrong-server-501.md) | 定位访问 127.0.0.1:8765 返回 Unsupported method GET 的原因 |
