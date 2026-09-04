# Talent Hub 源码地图与变更影响指南

> 本组文档是对当前源码实现的事实映射，不是预设架构蓝图。它面向维护者和 AI 编程助手，目标不是逐行解释代码，而是明确数据如何流动、状态如何变化、模块如何互相约束，以及修改某处时必须同步检查哪些位置。
>
> 维护原则：任何改动都先定位“数据来源 → 中间状态 → 持久化 → API 输出 → 前端消费 → 验证契约 → 发布产物”的完整链路，避免局部修改造成跨层失配。

## 阅读方式

本文件是源码地图入口。先根据修改目标选择专题文档，只读取与任务有关的链路；涉及字段、状态、并发、安全或持久化时，再读取变更影响指南完成联查。

| 修改目标 | 首先读取 | 必须联查 |
| --- | --- | --- |
| 项目边界、启动方式、运行拓扑 | [架构与运行](source-map/01-architecture.md) | [变更影响指南](source-map/07-change-guide.md) |
| 后端模块、前端组件、模块职责 | [代码地图](source-map/02-code-map.md) | 对应业务专题 |
| 设置、密钥、飞书或安全边界 | [配置、密钥与安全边界](source-map/03-configuration-security.md) | [API 与运行时约束](source-map/06-api-runtime.md) |
| 简历筛选、证据、分级或 Excel | [简历筛选链路](source-map/04-resume-screening.md) | [变更影响指南](source-map/07-change-guide.md) |
| 电话整理、ASR、招聘判断、多语言任务标题、录音定位或人工编辑 | [电话确认链路](source-map/05-phone-screening.md) | [API 与运行时约束](source-map/06-api-runtime.md) |
| API 字段、轮询、并发、取消或持久化 | [API 与运行时约束](source-map/06-api-runtime.md) | 对应业务专题 |
| 任意跨模块改动或修改前影响分析 | [变更影响指南](source-map/07-change-guide.md) | 对应业务专题 |

## 专题文档

| 文档 | 内容范围 |
| --- | --- |
| [架构与运行](source-map/01-architecture.md) | 第 1、3、4、17 节 |
| [代码地图](source-map/02-code-map.md) | 第 2 节 |
| [配置、密钥与安全边界](source-map/03-configuration-security.md) | 第 5、13 节 |
| [简历筛选链路](source-map/04-resume-screening.md) | 第 6–8 节 |
| [电话确认链路](source-map/05-phone-screening.md) | 第 9–10 节 |
| [API 与运行时约束](source-map/06-api-runtime.md) | 第 11–12 节 |
| [变更影响指南](source-map/07-change-guide.md) | 第 14–16、18–19 节 |

## 1. 项目定位与边界

项目定位、本地运行边界与两条主要业务链路见[架构与运行](source-map/01-architecture.md#1-项目定位与边界)。

## 2. 代码地图

模块职责、前端模块化约定和 UI 行为约定见[代码地图](source-map/02-code-map.md#2-代码地图)。

## 3. 运行时总拓扑

进程、存储、外部服务和发布形态见[架构与运行](source-map/01-architecture.md#3-运行时总拓扑)。

## 4. 启动与本地会话数据流

启动、令牌注入、Bootstrap 和本地会话流程见[架构与运行](source-map/01-architecture.md#4-启动与本地会话数据流)。

## 5. 配置与密钥数据流

设置保存、密钥保护、公开配置和外部服务消费见[配置、密钥与安全边界](source-map/03-configuration-security.md#5-配置与密钥数据流)。

## 6. 简历筛选端到端数据流

上传、标准生成、HR 校准、统一分级状态机、证据守卫、同级比较和最终产物见[简历筛选链路](source-map/04-resume-screening.md#6-简历筛选端到端数据流)。

## 7. 简历任务状态机

Job 状态、阶段、恢复和取消语义见[简历筛选链路](source-map/04-resume-screening.md#7-简历任务状态机)。

## 8. Excel 数据流与跨表契约

五表结构、构建、校验和交付约束见[简历筛选链路](source-map/04-resume-screening.md#8-excel-数据流与跨表契约)。

## 9. 电话确认端到端数据流

录音上传、转写、结构化事实引用守卫、状态展示和人工编辑见[电话确认链路](source-map/05-phone-screening.md#9-电话确认端到端数据流)。

## 10. 电话状态机与取消语义

任务和条目状态、失败隔离、取消及推送时机见[电话确认链路](source-map/05-phone-screening.md#10-电话状态机与取消语义)。

## 11. 前后端 API 契约

通用请求约束、Job/Call 字段和前端轮询契约见[API 与运行时约束](source-map/06-api-runtime.md#11-前后端-api-契约)。

## 12. 并发与持久化交叉影响

任务并发层级、锁、原子写入和隔离保证见[API 与运行时约束](source-map/06-api-runtime.md#12-并发与持久化交叉影响)。

## 13. 安全边界及其交叉依赖

令牌、密钥、路径、上传、证据、Excel 和 XSS 边界见[配置、密钥与安全边界](source-map/03-configuration-security.md#13-安全边界及其交叉依赖)。

## 14. 变更影响矩阵

各类修改必须同步检查的位置见[变更影响指南](source-map/07-change-guide.md#14-变更影响矩阵)。

## 15. 修改前的强制检查流程

入口、模型、读写路径、状态、并发、安全和契约检查顺序见[变更影响指南](source-map/07-change-guide.md#15-修改前的强制检查流程)。

## 16. 高风险“看似局部”改动

容易产生跨层失配的局部改动清单见[变更影响指南](source-map/07-change-guide.md#16-高风险看似局部改动)。

## 17. 设计上的单一事实来源

配置、模型、状态、工作簿和持久化的事实来源见[架构与运行](source-map/01-architecture.md#17-设计上的单一事实来源)。

## 18. 当前刻意保留的人工边界

HR 校准、证据复核、人工编辑和业务判断边界见[变更影响指南](source-map/07-change-guide.md#18-当前刻意保留的人工边界)。

## 19. 文档维护要求

需要同步更新源码地图的变更类型见[变更影响指南](source-map/07-change-guide.md#19-文档维护要求)。
