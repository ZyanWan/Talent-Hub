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

## 分析脚本

`analysis/analyze.py` 是任务数据分析工具（内部开发工具，不属于 bug 记录），按子命令运行：

- `python debug/analysis/analyze.py summary`：各任务结论分布与失败记录
- `python debug/analysis/analyze.py criteria`：筛选标准详情（硬门槛、A/B/C 条件、负向与加分信号）
- `python debug/analysis/analyze.py detail --conclusion A --candidate 姓名`：候选人评估详情（可按结论与姓名过滤）
- `python debug/analysis/analyze.py replay [--baseline] [--unsatisfied 姓名:0,3]`：A 类条件守卫回放，模拟补填判定后重跑守卫，验证收紧逻辑

`--job <任务ID前缀>` 可按任务过滤；脚本读取 `%LOCALAPPDATA%\TalentHub\jobs` 下的任务数据。