# 变更影响指南

> 影响矩阵、修改检查流程、高风险改动、人工边界和文档维护要求。
>
> 返回 [SOURCE_MAP.md](../SOURCE_MAP.md) 选择其他主题。

## 14. 变更影响矩阵

| 如果修改 | 必须同步检查 |
| --- | --- |
| `AppSettings` 字段或默认值 | `config.py` 迁移和公开设置、`main.py` 请求模型及设置路由、`frontend/src/ui/SettingsDialog.tsx` 表单和 payload、设置验证（含飞书三字段） |
| 飞书推送逻辑（`app/feishu.py`、`push_with_status`、消息构建、脱敏、签名、重试与频控） | `main.py` 的 `feishu-test` / 两个 `retry-notification` API、`pipeline.py` / `phone_screening.py` 挂点、通知状态与历史基线、消息大小保护、前端测试按钮与文案、推送失败不改变业务状态的验证 |
| 飞书密钥或 Webhook 字段 | `config.py` DPAPI、`merged_settings` exclude 集合、`public_dict` 公开字段、前端回显、清除语义 |
| API 路径、方法或响应字段 | `main.py`、前端 React 组件所有调用和渲染、API 验证、必要时发布烟测 |
| Job 状态或 stage 语义 | `pipeline.py`、仓储归档限制、`main.py` 冲突处理、前端轮询/按钮/历史、状态验证 |
| Call 状态或条目状态 | `call_state.py`、`phone_screening.py`、仓储、路由、前端状态标签和轮询、电话验证 |
| `ScreeningCriteria` | 标准 prompt、校准 API、前端编辑器、Markdown、Excel 标准表、验证 |
| `CandidateEvaluation` | 评估 prompt、证据守卫（含硬性门槛 `apply_hard_gate_guard` 与 `bonus_signal_hits`）、排序、持久化结果、Excel（含「硬性门槛判定」列）、前端结果、对比 |
| 证据维度或核心维度 | `models.py`、prompt、guard、evidence strength、Excel 证据表 |
| 硬性门槛 `hard_gate` / `HardGateVerdict` | criteria prompt、评估 prompt、`apply_hard_gate_guard()`、Excel 总表列、硬性门槛验证 |
| 综合招聘判断 / `soft_skill_summary` | `soft-skill-framework.md`、整理 prompt、narrative 渲染、前端维度 chips、前端岗位联动关键词映射 `SOFT_SKILL_KEYWORD_MAP`、电话验证 |
| 电话字段确定性 / `fields[].status` | 整理 prompt、`CallField`、电话详情字段徽标、API 契约、电话验证 |
| A/B/C 枚举 | 模型、guard、排序、工作簿契约、校验器、前端精确匹配、AI 对比、验证 |
| `source_file` 语义 | 上传命名、续跑、追加简历、结果预览、AI 对比、缓存、前端选择键、验证 |
| 简历解析策略 | `extract_resume_text.py`、`pipeline.extract_document()`、OCR 状态、上传类型、预览支持、解析验证 |
| Excel 表名或表头 | `workbook_contract.py`、payload、构建器、校验器、预览、验证、业务使用方 |
| 结果/产物文件名 | `pipeline.py`、下载/预览路由、续跑、对比缓存、历史老任务兼容 |
| 检查点保存顺序 | 原子写逻辑、恢复逻辑、取消、并发和中断验证 |
| 模型调用或重试策略 | `llm.py`、取消语义、设置 timeout、筛选/电话/对比调用、错误验证 |
| `CallSummary` / `CallField` / `CallFact` / `CallQA` | 整理 prompt、基础结构校验、narrative 渲染、持久化 JSON/Markdown、编辑 API、前端展示、旧摘要兼容、回放定位（`start_time`/`end_time` 与音频访问 API）、电话验证 |
| ASR 请求参数或响应结构 | `speech_to_text.py`、电话处理器、设置的 ASR 状态、STT 验证 |
| 首页 DOM ID 或 class | 前端 js/ 模块的节点查询和事件、`styles.css`、首页验证、发布烟测 |
| 前端本地存储键 | 初始化恢复、切换工具、新建任务、历史恢复 |
| 历史记录删除、归档、恢复或任务打开 | `HistoryMutation` 事件、`App` 当前任务提交与工作区重置、`lastJob` / `lastCall`、筛选与电话请求序号、归档操作显隐、历史集成验证 |
| 版本号 | 仅 `app/__init__.py` 的 `__version__`；`scripts/build_windows.ps1` 自动生成 `packaging/version_info.txt`，并通过 Inno Setup `/DMyAppVersion` 参数把版本传给静态 `.iss` |
| 启动参数或 `/health` | `main.py`、`launcher.py`、`scripts/verify_windows_release.ps1`、重复实例探测 |
| 清理目录规则 | `.gitignore`（`release/`、`build/`、`dist/`、`.workbuddy/`、`packaging/version_info.txt` 已忽略）、`scripts/build_windows.ps1` 拒绝覆盖已存在的版本 portable/build 子目录 |

## 15. 修改前的强制检查流程

维护者或 AI 在修改代码前，应按以下顺序完成影响分析：

1. 定位入口：前端事件、API 路由、后台任务或 CLI。
2. 定位数据模型：请求模型、Pydantic 模型、任务 JSON 字段、文件格式。
3. 画出写路径：数据在哪里创建、转换、校验和落盘。
4. 画出读路径：哪些路由、恢复流程、前端和验证读取这些数据。
5. 检查状态机：当前改动是否改变合法状态或重试/取消行为。
6. 检查并发：是否处于锁、线程池、future 或取消事件控制范围。
7. 检查旧任务：已有 `job.json`、`record.json`、结果 JSON 是否还能加载和恢复。
8. 检查安全边界：令牌、密钥、路径、大小、证据、Excel、XSS 是否受影响。
9. 检查前后端契约：字段、枚举、HTTP 方法、Content-Type 和下载文件名是否同步。
10. 按变更影响矩阵核对关联模块，并执行语法检查（`compileall`）与启动冒烟验证。

## 16. 高风险“看似局部”改动

以下改动最容易牵一发而动全身：

1. 修改结论字符串：它同时是模型输出、业务枚举、排序条件、Excel 值、前端过滤值和验证断言。
2. 修改 `source_file`：它同时是文件身份、恢复键、追加简历判断、预览路径和对比选择键。
3. 修改任务状态：它同时控制后台转换、归档/删除许可、前端视图、轮询和重试按钮。
4. 修改筛选标准字段：它跨越模型 prompt、人工校准、Markdown、Excel 和旧任务 JSON。
5. 修改证据维度：它会改变 guard、排序、证据表和 A/B/C 改判。
6. 修改 Excel 表头或表名：构建可以成功，但校验、预览、验证或业务导入方可能失败。
7. 修改保存顺序：可能造成崩溃后元数据与结果文件不一致，破坏续跑。
8. 修改取消实现：可能误停其他任务，或让迟到的模型/ASR 结果覆盖取消状态。
9. 修改 `field.key` 或事实定位字段：会破坏人工编辑或录音定位兼容。
10. 修改公开配置：可能意外泄露明文密钥或让前端错误判断“已配置”。
11. 修改发布版本或手动清理 release：可能误删可交付 release，或让构建、安装器和 release 目录版本不一致。

## 18. 当前刻意保留的人工边界

这些不是未完成自动化，而是产品安全设计：

- AI 生成筛选标准后必须由 HR 校准。
- 模型候选人评估必须经过原文证据守卫。
- 硬性门槛判定由程序强制：任一明确不满足直接 C，模型不得放宽；存在 unknown 一律降 B 转电话确认。
- 电话摘要只经过 JSON 和必填结构校验，程序完整保留模型返回的客观记录、综合招聘判断与快筛详情。
- 电话事实 `ref` 只用于尝试定位录音时间，不参与正文、招聘判断和字段状态裁决。
- 电话整理结果允许 HR 修改。
- Excel 校验只保证结构、安全和跨表一致性，不宣称业务判断必然正确。

修复简历筛选的“通过率低”“A 类减少”“字段变成待确认”等问题时，应先检查模型引用是否真实、Prompt 和解析是否正确，不得直接放宽证据边界来制造表面成功。电话整理质量问题通过提示词和模型输出评测处理，不新增删除或改写模型业务内容的后处理逻辑。

## 19. 文档维护要求

出现下列变更时应同步更新 `docs/SOURCE_MAP.md` 入口及对应专题文档：

- 新增核心模块、业务链路或外部服务；
- 修改 Job/Call 状态机；
- 修改核心模型或持久化格式；
- 修改 API 字段、结论枚举或工作簿契约；
- 修改并发、取消、恢复或检查点机制；
- 修改密钥、文件、证据或 Excel 安全边界；
- 修改 Windows 或 macOS 构建、安装或清理流程。

源码地图文档组应描述当前代码事实，不记录临时调试过程。具体故障证据放入 `debug/`，修复完成后只将稳定的架构约束回写到对应专题文档。
