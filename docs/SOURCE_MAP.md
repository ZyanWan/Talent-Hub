# Talent Hub 源码地图与变更影响指南

> 本组文档是对当前源码实现的事实映射，不是预设架构蓝图。它面向维护者和 AI 编程助手，用于定位数据流、状态、模块约束和变更联查范围。
>
> 维护原则：任何改动都先定位“数据来源 -> 中间状态 -> 持久化 -> API 输出 -> 前端消费 -> 验证契约 -> 发布产物”的完整链路，避免局部修改造成跨层失配。

## 阅读方式

根据修改目标直接选择下表中的主题；涉及字段、状态、并发、安全或持久化时，同时读取变更影响指南。主题名称前的显式锚点用于保持现有深链可用。

| 主题 | 事实文档 | 必须联查 |
| --- | --- | --- |
| <a id="1-项目定位与边界"></a>1. 项目定位与边界 | [架构与运行](source-map/01-architecture.md#1-项目定位与边界) | [变更影响指南](source-map/07-change-guide.md) |
| <a id="2-代码地图"></a>2. 代码地图 | [代码地图](source-map/02-code-map.md#2-代码地图) | 对应业务专题 |
| <a id="3-运行时总拓扑"></a>3. 运行时总拓扑 | [架构与运行](source-map/01-architecture.md#3-运行时总拓扑) | [变更影响指南](source-map/07-change-guide.md) |
| <a id="4-启动与本地会话数据流"></a>4. 启动与本地会话数据流 | [架构与运行](source-map/01-architecture.md#4-启动与本地会话数据流) | [API 与运行时约束](source-map/06-api-runtime.md) |
| <a id="5-配置与密钥数据流"></a>5. 配置与密钥数据流 | [配置、密钥与安全边界](source-map/03-configuration-security.md#5-配置与密钥数据流) | [API 与运行时约束](source-map/06-api-runtime.md) |
| <a id="6-简历筛选端到端数据流"></a>6. 简历筛选端到端数据流 | [简历筛选链路](source-map/04-resume-screening.md#6-简历筛选端到端数据流) | [变更影响指南](source-map/07-change-guide.md) |
| <a id="7-简历任务状态机"></a>7. 简历任务状态机 | [简历筛选链路](source-map/04-resume-screening.md#7-简历任务状态机) | [API 与运行时约束](source-map/06-api-runtime.md) |
| <a id="8-excel-数据流与跨表契约"></a>8. Excel 数据流与跨表契约 | [简历筛选链路](source-map/04-resume-screening.md#8-excel-数据流与跨表契约) | [变更影响指南](source-map/07-change-guide.md) |
| <a id="9-电话确认端到端数据流"></a>9. 电话确认端到端数据流 | [电话确认链路](source-map/05-phone-screening.md#9-电话确认端到端数据流) | [API 与运行时约束](source-map/06-api-runtime.md) |
| <a id="10-电话状态机与取消语义"></a>10. 电话状态机与取消语义 | [电话确认链路](source-map/05-phone-screening.md#10-电话状态机与取消语义) | [API 与运行时约束](source-map/06-api-runtime.md) |
| <a id="11-前后端-api-契约"></a>11. 前后端 API 契约 | [API 与运行时约束](source-map/06-api-runtime.md#11-前后端-api-契约) | 对应业务专题 |
| <a id="12-并发与持久化交叉影响"></a>12. 并发与持久化交叉影响 | [API 与运行时约束](source-map/06-api-runtime.md#12-并发与持久化交叉影响) | 对应业务专题 |
| <a id="13-安全边界及其交叉依赖"></a>13. 安全边界及其交叉依赖 | [配置、密钥与安全边界](source-map/03-configuration-security.md#13-安全边界及其交叉依赖) | [变更影响指南](source-map/07-change-guide.md) |
| <a id="14-变更影响矩阵"></a>14. 变更影响矩阵 | [变更影响指南](source-map/07-change-guide.md#14-变更影响矩阵) | 对应业务专题 |
| <a id="15-修改前的强制检查流程"></a>15. 修改前的强制检查流程 | [变更影响指南](source-map/07-change-guide.md#15-修改前的强制检查流程) | 对应业务专题 |
| <a id="16-高风险看似局部改动"></a>16. 高风险“看似局部”改动 | [变更影响指南](source-map/07-change-guide.md#16-高风险看似局部改动) | 对应业务专题 |
| <a id="17-设计上的单一事实来源"></a>17. 设计上的单一事实来源 | [架构与运行](source-map/01-architecture.md#17-设计上的单一事实来源) | [变更影响指南](source-map/07-change-guide.md) |
| <a id="18-当前刻意保留的人工边界"></a>18. 当前刻意保留的人工边界 | [变更影响指南](source-map/07-change-guide.md#18-当前刻意保留的人工边界) | 简历与电话业务专题 |
| <a id="19-文档维护要求"></a>19. 文档维护要求 | [变更影响指南](source-map/07-change-guide.md#19-文档维护要求) | 本入口与对应专题 |

电话链路中的事实引用只用于尝试定位录音时间，不裁决正文、软性素质评价或字段状态；具体契约见[电话确认链路](source-map/05-phone-screening.md)与[配置、密钥与安全边界](source-map/03-configuration-security.md)。
