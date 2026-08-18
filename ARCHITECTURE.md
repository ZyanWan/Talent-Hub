# Talent Hub 项目架构与变更影响指南

> 本文面向维护者和 AI 编程助手，目标不是逐行解释代码，而是明确数据如何流动、状态如何变化、模块如何互相约束，以及修改某处时必须同步检查哪些位置。
>
> 维护原则：任何改动都先定位“数据来源 → 中间状态 → 持久化 → API 输出 → 前端消费 → 验证契约 → 发布产物”的完整链路，避免局部修改造成跨层失配。

## 1. 项目定位与边界

Talent Hub 是一个本机运行的 Python/FastAPI 招聘工作台，前端使用原生 HTML、CSS 和 JavaScript。它包含两条主要业务链路：

1. 简历筛选：JD、简历上传、标准生成与人工校准、候选人评估、证据校验、硬性门槛程序化过滤、A/B/C 分级、Excel 交付和候选人横向对比。
2. 电话确认：录音上传、火山引擎 ASR、AI 整理（含内部文本重建与结构化 Remark、软性 8 维度框架观察、四层整理记录 narrative）、事实与软性引用双重守卫、人工编辑和 Markdown 下载。

系统边界：

- HTTP 服务只监听 `127.0.0.1`。
- 所有 `/api/` 请求必须携带当前进程生成的本地会话令牌。
- 模型 API Key 和 ASR API Key 使用当前 Windows 用户的 DPAPI 加密。
- 简历、录音、解析文本和产物保存在本机数据目录，不写入源码目录。
- 模型输出不是直接真相；简历与电话链路均有原文证据校验和人工复核边界。
- Excel 是正式交付产物，必须符合固定五表契约并通过安全校验。

## 2. 代码地图

| 模块 | 核心职责 | 主要影响对象 |
| --- | --- | --- |
| `app/main.py` | 应用装配、路由、令牌中间件、上传限制、下载和预览、服务启动 | 前端全部 API、仓储、筛选引擎、电话处理器 |
| `app/config.py` | 数据目录、配置模型、DPAPI、配置迁移和公开配置 | 模型调用、ASR、前端设置、发布运行环境 |
| `app/models.py` | 筛选（含硬性门槛判定）、证据、电话摘要（动态章节/软性观察/快筛问答）的 Pydantic 契约 | Prompt 输出、持久化 JSON、Excel、前端字段 |
| `app/repository.py` | 岗位任务 JSON、文件目录、归档、删除、路径和文件名安全 | `main.py`、`pipeline.py`、任务恢复 |
| `app/call_repository.py` | 电话任务（含 soft_skill_focus、soft_skill_dimensions、job_id）、音频与条目持久化 | `main.py`、`phone_screening.py`、前端电话页 |
| `app/llm.py` | OpenAI 兼容接口、JSON 提取、重试、取消 | 筛选标准、候选人评估、横向对比、电话整理 |
| `app/pipeline.py` | 简历筛选主流程、证据守卫、续跑、Excel 载荷 | 任务状态、结果 JSON、工作簿、前端进度 |
| `app/artifact_preview.py` | Markdown 和 Excel 安全预览 | 产物预览 API、前端预览对话框 |
| `app/runtime/extract_resume_text.py` | PDF、DOCX、文本基础解析、清洗（去水印/修复断词/清控制字符）及质量判断 | `pipeline.py`、解析 CLI |
| `app/runtime/build_candidate_workbook.py` | 五表 Excel 构建和公式注入防护 | `pipeline.py`、Excel 验证 |
| `app/runtime/validate_workbook.py` | Excel 结构、跨表关系和安全校验 | `pipeline.py`、交付是否完成 |
| `app/runtime/workbook_contract.py` | 五表名称、表头、枚举和格式契约 | 构建器、校验器、验证、业务输出 |
| `app/runtime/call_state.py` | 电话条目状态机和中断收敛 | `phone_screening.py`、电话重试和取消 |
| `app/runtime/speech_to_text.py` | 火山 ASR 请求和转写渲染 | 电话处理器、ASR 验证 |
| `app/runtime/phone_screening.py` | 电话处理、事实与软性观察双重守卫、软性 8 维度框架注入、四层 narrative 渲染（客观记录/概述/观察/快筛详情）、Markdown | 电话任务状态、摘要文件、前端电话详情 |
| `app/static/index.html` | 页面结构、对话框和 DOM 锚点 | `js/` 模块、`styles.css`、首页验证 |
| `app/static/app.js` | 前端模块化入口：imports → 各模块 `init()` → `bootstrap()` | `js/` 模块、`shell.js` |
| `app/static/shell.js` | 顶栏、语言切换、新建菜单、退出、bootstrap | `js/` 模块 |
| `app/static/js/core/` | dom（`$`）、state（全局单对象）、api（token+fetch）、i18n（messages+t+语言广播）、router（视图路由与生命周期）、utils（格式化/标签/通用渲染、`measureSelectFlip`）、customSelect（自定义下拉公共组件 `createCustomSelect`） | 全部前端模块、契约验证 |
| `app/static/js/dialogs/` | settings、resume（简历工作台与预览）、preview（产物预览）、compare（横向对比） | 后端路由、JSON 字段、状态枚举 |
| `app/static/js/views/` | screening（筛选四视图）、phone（电话确认）、history（历史对话框，Job+Call 共用） | 后端路由、JSON 字段、状态枚举 |
| `app/static/styles.css` | 布局、响应式、状态样式 | HTML class、JS 动态 class |
| `launcher.py` | PyInstaller 薄启动入口 | `app.main.main`、打包配置 |
| `build_windows.ps1` | PyInstaller、许可证、烟测、安装器编排 | 版本、发布目录、packaging 脚本 |
| `verify_windows_release.ps1` | 发布 EXE 的启动和首页烟测 | `main.py` 参数、`/health`、首页结构 |

### 2.1 前端模块化约定

前端无框架、无构建步骤，使用原生 ES Modules（`index.html` 以 `type="module"` 加载 `app.js`）。模块边界与职责：

- `core/`：被所有模块共享的基座。`dom.js` 的 `$()` 在元素缺失时 `console.warn`；`i18n.js` 的 `t()` 在 key 缺失时 `console.warn`，两者让「漏元素 / 漏文案」在开发期暴露。
- 视图模块（`views/`）与对话框模块（`dialogs/`）各自负责本作用域 DOM 的事件绑定（`init()`）与渲染，只通过 `import` 显式依赖其他模块。
- 全局 `state` 保持单一对象（`core/state.js`），字段按归属约定读写，禁止跨模块写他人字段：

  | 归属 | state 字段 |
  | --- | --- |
  | shell | language、createMenuOpen |
  | settings | settings、clearAsrPending |
  | history | jobs、archivedJobs、historyScope、historyTotals、historyKind、historyLoading、storageStats、callTasks、callArchivedTasks、callScope、callTotals |
  | screening | currentJob、selectedResumes、resultFilter、liveResultKeys、criteriaBase、pendingDeleteJob、pollTimer |
  | resume | resumePreviewIndex、resumePreviewUrl、resumeRenderController、resumeRenderCache、resumePrefetchController、storedResumePreview |
  | phone | currentCall、callPollTimer、pendingCallFiles、pendingDeleteCall |
  | compare | compareSelection、compareCancelKey |
  | preview | previewKind、previewPayload、previewSheetIndex、previewRequest |

- `core/router.js` 集中视图切换与轮询生命周期：视图注册 `{ enter, exit }`，`show(name)` 负责「离开旧视图 → 隐藏全部 section → 进入新视图」。轮询互斥约定：**每个视图只在自己的 `exit` 里停止本视图的轮询字段**（screening 停 `state.pollTimer`、phone 停 `state.callPollTimer`，见上表归属），由「同一时刻仅一个视图激活」天然保证互斥，视图之间无需互相感知；新增视图只需在自己的 `exit` 停自己的轮询即可，无需改动既有视图。`enter` 仅在需要进入时启动轮询的场景使用。轮询回调通过 `currentView()` 判断是否丢弃过期结果，不再读取 `phoneView` 的 hidden 状态。
- `i18n.onChange()` 是语言切换广播：各模块在 `init()` 注册自己的重渲染监听，`setLanguage` 只写 `state.language` + 持久化 + 广播，不再直接调用各视图渲染函数。

新增页面（视图或对话框）的标准流程：① 在 `index.html` 加 `<section>`/`<dialog>` 及元素；② 新建模块文件，提供渲染函数 + `init()`（事件绑定）+ 双语 i18n key；③ 在 `app.js` 入口加一行 import + `init()` 调用；④ 不触碰其他模块，跨模块数据只走显式 import 的接口。

`views/screening` 与 `views/history`、`views/phone` 与 `views/history` 之间存在函数体级循环 import（history 需要 loadJob/selectCall 导航，screening/phone 需要 renderHistory/refreshCallHistoryData 刷新），ES Modules 允许且仅在函数体内使用，模块顶层不得使用对方绑定。

### 2.2 前端 UI 行为约定

以下为本项目稳定落地的 UI 行为约定，改动时应保持一致，避免风格分裂：

- **模态框动画收敛**：五个居中弹窗（settings/resume/preview/compare/confirm）的动画声明统一走「公共动效组」分组规则（淡入 + 上移 + 微缩放），各 dialog 类只保留尺寸/边框/圆角差异；`history-dialog` 抽屉（X 轴滑入）与 `confirm-dialog` 更暗遮罩（.44）是刻意差异，保留独立覆盖。JS 侧所有 dialog 统一 `showModal()` + 双 rAF 加 `is-visible` + `transitionend` 关闭。
- **遮罩点击关闭按误触成本分级**：编辑类（settings / resume / callItemDetail）只支持「关闭按钮 + ESC」退出（误触会丢未保存输入或打断录音播放）；查看类（preview / compare / history）保留点遮罩关闭；confirm 删除框本就不支持。新增编辑类 dialog 时应默认禁遮罩关闭。
- **下拉统一走 `createCustomSelect()`**（`core/customSelect.js`）：原生 `<select>` 弹层无法做 CSS 过渡动画，全站下拉统一改用该组件——隐藏原生 select 做值载体（`value` 读写与 `change` 监听零改动），JS 从 `select.options` 渲染菜单，带展开/收起过渡、键盘导航（方向键/Enter/Space/Tab/ESC）、方向自适应（内部 `measureSelectFlip` 按最近滚动容器判断向上/向下弹出，菜单限高 300px 内部滚动）、语言切换自动重建。新增下拉一律复用组件，禁止手写第二份逻辑。
- **页面滚动条 gutter 恒定**：`html` 使用 `scrollbar-gutter: stable`（`@supports` 包裹 + `overflow-y: scroll` 兜底），结果页 ↔ 新建页切换不因滚动条出现/消失产生内容区宽度突变。
- **视图切换过渡**：5 个 section 与结果页配套元素（`#resultActions`、`#appendResumesButton`）统一 `view-in` 纯淡入动画（出现侧，`prefers-reduced-motion` 豁免）；消失侧为瞬间隐藏（纯 CSS 边界，如需交叉淡化需 View Transition API）。

## 3. 运行时总拓扑

```text
浏览器 app/static/*
  │
  │ X-App-Token + JSON/二进制
  ▼
FastAPI app/main.py
  ├─ SettingsStore ─────────────── app/config.py ── DPAPI / settings.json
  ├─ JobRepository ─────────────── app/repository.py ── jobs/<job_id>/
  ├─ EvaluationEngine ──────────── app/pipeline.py
  │    ├─ extract_resume_text.py
  │    ├─ OpenAICompatibleClient ─ app/llm.py ── 外部模型 API
  │    ├─ build_candidate_workbook.py
  │    └─ validate_workbook.py
  ├─ CallRepository ────────────── app/call_repository.py ── calls/<call_id>/
  ├─ CallProcessor ─────────────── phone_screening.py
  │    ├─ speech_to_text.py ── 火山 ASR API
  │    └─ OpenAICompatibleClient ── 外部模型 API
  └─ artifact_preview.py ───────── Markdown / XLSX 限量预览
```

这里没有数据库。`job.json`、`record.json`、结果 JSON 和文件目录共同构成持久化状态，因此修改字段时不能只看 Pydantic 模型或 API；还要考虑旧 JSON 的加载、恢复逻辑和前端消费。

## 4. 启动与本地会话数据流

```text
launcher.py 或 python -m app.main
  → app.main.main()
  → 解析 --port / --no-browser / --data-dir
  → configure_app_logging()
  → existing_app_url() 探测指定端口是否已有本应用
     ├─ 是：打开已有实例并退出
     └─ 否：必要时选择新回环端口
  → 生成随机 app_token
  → create_app(data_dir, app_token)
  → 装配 SettingsStore / repositories / engines
  → Uvicorn 绑定 127.0.0.1
  → GET / 注入 app_token 到 HTML meta
  → app.js bootstrap()
  → GET /api/bootstrap，携带 X-App-Token
```

交叉影响：

- 修改 `main()` 参数会影响 `launcher.py`、`verify_windows_release.ps1` 和 PyInstaller 启动方式。
- 修改 `/health` 字段会影响重复实例探测及发布烟测。
- 修改首页 token 占位符、meta 名称或请求头名称，必须同步修改 `index.html`、前端 js/ 模块、中间件和 API 验证。
- 修改监听地址不能只改 Uvicorn；产品安全边界明确要求仅监听 `127.0.0.1`。

## 5. 配置与密钥数据流

```text
设置对话框 js/dialogs/settings.js
  → PUT /api/settings
  → main.py 将请求转换为 AppSettings
  → SettingsStore.save()
     ├─ 数值归一化
     ├─ API Key / ASR Key 使用 DPAPI 加密
     └─ 临时文件 + os.replace 写 settings.json
  → public_settings()
  → 前端只得到 is_ready / asr_configured 等公开状态
```

模型调用时：

```text
EvaluationEngine / CallProcessor / settings test / compare
  → SettingsStore.load()
  → DPAPI 解密或读取 TALENT_HUB_API_KEY
  → OpenAICompatibleClient(base_url, api_key, model, timeout)
```

关键约束：

- API 响应不得返回明文密钥。
- 前端设置框不会回填已保存密钥；空输入表示保留旧值。
- ASR 密钥有显式清除语义，不能与“留空保留”混淆。
- `schema_version` 迁移影响旧用户升级。
- 修改配置字段必须同步检查 `AppSettings`、设置请求模型、`PUT /api/settings`、`POST /api/settings/test`、`public_settings()`、前端表单、`settingsPayload()`、迁移验证。

## 6. 简历筛选端到端数据流

### 6.1 创建与上传

```text
js/views/screening.js startScreening()
  → POST /api/jobs {title}
  → JobRepository.create()
  → jobs/<job_id>/job.json

  → PUT /api/jobs/<id>/jd {text}
  → jobs/<job_id>/jd/岗位JD.txt
  → job.json: jd_file, stage

  → 逐份 PUT /api/jobs/<id>/resumes?filename=...
  → main.py 流式写临时文件并计算 SHA-256
  → JobRepository.reserve_upload() 处理文件名冲突
  → 内容哈希去重
  → jobs/<job_id>/resumes/<safe_name>
  → job.json: resume_files, resume_hashes, total
```

上传有三层身份，不能混用：

1. 浏览器 `File`：以 `name:size:lastModified` 做当前选择去重。
2. 服务端存储文件名：经清洗并可能因重名变为 `name (2).ext`。
3. 内容身份：SHA-256，用于识别不同文件名但内容相同的简历。

`source_file` 是后续结果、续跑、追加简历、简历预览和 AI 对比共同使用的稳定键。改变其语义会同时影响上述所有流程。

### 6.2 第一阶段：生成标准

```text
POST /api/jobs/<id>/start
  → EvaluationEngine.start()
  → 无标准或 criteria_jd_file != jd_file
  → job: queued / 生成岗位筛选标准
  → 后台 _prepare()
     → extract_document(JD)
     → 保存 parsed/jd.txt
     → criteria_prompt()
     → OpenAICompatibleClient.chat_json()
     → ScreeningCriteria.model_validate()
     → 筛选标准.json
     → <岗位名>-简历筛选标准.md
     → job: waiting / 等待校准筛选标准
```

这是强制两阶段流程。首次 `/start` 不评估简历。前端看到 `waiting` 后请求 `/criteria-json` 并进入校准页。

### 6.3 HR 校准

```text
GET /api/jobs/<id>/criteria-json
  → js/views/screening.js renderCriteriaEditor()
  → HR 修改
  → PUT /api/jobs/<id>/criteria-json
  → ScreeningCriteria.model_validate()
  → 同步覆盖 JSON 和 Markdown
  → 再次 POST /start
```

前端编辑器只展示标准中的主要字段，但提交时以 `criteriaBase` 为基础合并，因此未展示字段会被保留。增加或删除 `ScreeningCriteria` 字段时，必须明确它应当：

- 被前端编辑；
- 只由后端维护但往返保留；
- 进入 prompt；
- 进入 Markdown；
- 进入 Excel 的筛选标准表。

### 6.4 第二阶段：解析与评估

```text
POST /start（标准已就绪）
  → EvaluationEngine._run()
  → 读取筛选标准.json
  → _resumable_results() 查找可复用结果
  → 对未完成 resume_files 建立候选人线程池
  → 每份简历 _evaluate_one()
     → extract_document()
     → evaluation_prompt(criteria, resume_text)
     → CandidateEvaluation.model_validate()
     → apply_evidence_guard(resume_text, evaluation)
     → apply_hard_gate_guard(criteria, resume_text, evaluation)
     → 单次模型调用完成评估，不再二次复核
```

文档解析的交叉路径：

```text
pipeline.extract_document()
  ├─ PDF → extract_file(pypdf → pdfplumber) → 不足时 Tesseract OCR
  ├─ DOCX → ZIP 中 word/document.xml
  ├─ TXT/MD → 多编码读取
  └─ 图片 → Tesseract OCR
```

### 6.5 证据守卫与分级

模型输出的 `CandidateEvaluation` 不是最终结果。`apply_evidence_guard()` 将每个证据维度的 `quote` 与简历原文进行规范化连续子串比对。

```text
模型状态“匹配/不匹配”
  ├─ 无 quote → 待确认
  ├─ quote 不在原文 → 清空引用并降为待确认
  └─ quote 有效 → 保留
```

随后执行规则改判：

- A 缺核心证据、核心引用失效或总证据不足 → B。
- B 存在有原文支持的核心不匹配 → C。
- B 没有任何有原文支持的核心正向匹配 → C。
- B 没有电话问题 → 自动补一个通用问题。
- 非 B → 清空电话问题。

因此，修改以下任何内容都会互相影响：

- `CandidateEvidence` 的维度；
- `CORE_DIMENSIONS`；
- prompt 中对 A/B/C 的要求；
- `apply_evidence_guard()`；
- `evidence_strength()` 和排序；
- Excel 证据表；
- 前端展示字段；
- 证据降档验证。

硬性门槛守卫（`apply_hard_gate_guard`）：

- `hard_gate` 与候选人评估在同一次模型调用中输出：按 `ScreeningCriteria.hard_requirements` 逐条给出 `met / unmet / unknown`，`met` 与 `unmet` 必须携带能通过原文校验的逐字引文。
- 守卫校验：`met/unmet` 无引文或引文未通过校验 → 降为 `unknown`；criteria 中的硬性门槛未被模型判定 → 按 `unknown` 补齐并告警（防止模型漏判导致硬门槛失守）。
- 程序强制（先过滤语义，不再依赖模型自觉）：
  - 任一有效 `unmet` → 强制 `C`（覆盖模型结论）、清空电话问题；
  - 存在 `unknown` → A 不得成立（降为 B），并确保生成 `focus=硬性条件核实-{id}` 的高优先级电话问题。
- 修改硬性门槛结构时必须同步：criteria prompt、评估 prompt、`apply_hard_gate_guard()`、Excel 总表「硬性门槛判定」列、硬性门槛降档验证。

### 6.6 检查点、续跑和最终产物

每完成一份候选人，持久化顺序是：

```text
1. 原子写 评估结果.json
2. 原子写 解析清单.json
3. 更新 job.json 的 results / completed / progress / results_meta
```

这个顺序确保 `job.json` 不会领先于实际结果文件。不要随意交换顺序。

全部候选人完成后：

```text
结果排序
  → workbook_payload()
  → build_workbook()
  → 临时 XLSX + os.replace
  → validate_workbook_detailed()
     ├─ 结构错误/安全错误：任务失败
     └─ 非阻断 warning：写入 job.errors
  → job: completed / progress=100
```

恢复依据包括：

- 当前 JD 与生成标准时的 JD 一致；
- 已保存简历哈希与当前未冲突；
- `评估结果.json` 可用；
- 结果中的 `source_file` 对应已完成文件。

修改结果文件名、`results_meta`、`source_file` 或检查点格式时，必须为老任务恢复考虑兼容路径，并运行断点续跑与追加简历验证。

## 7. 简历任务状态机

```text
draft
  │ start（缺标准或 JD 已变化）
  ▼
queued ──后台启动──> running（生成标准）
                         │
                         ▼
                      waiting
                         │ HR 保存标准并再次 start
                         ▼
queued ──后台启动──> running（评估简历）
                         ├─> completed
                         ├─> failed
                         └─> cancelled

failed / cancelled / completed
  └─ start → queued → running（重试、续跑或追加简历）

非 queued/running
  └─ archive → archived_at 非空 → restore
```

跨层状态依赖：

| 状态 | 后端含义 | 前端行为 |
| --- | --- | --- |
| `draft` | 等待 JD、简历或首次启动 | 创建/历史视图 |
| `queued` | 后台任务已排队 | 显示进度并轮询 |
| `running` | 生成标准或评估中 | 显示取消并轮询 |
| `waiting` | 等待 HR 校准标准 | 打开标准编辑器，停止轮询 |
| `completed` | Excel 和结果已完成 | 结果页、追加简历、预览、下载 |
| `failed` | 阶段失败或上次运行中断 | 显示错误和重试 |
| `cancelled` | 用户取消并完成收敛 | 显示重试 |

新增或重命名状态时，必须同步：引擎状态转换、仓储归档限制、路由冲突判断、前端 `schedulePoll()`、进度按钮、历史菜单、验证。

## 8. Excel 数据流与跨表契约

`workbook_contract.py` 是 Excel 结构的单一核心契约，规定五张表、表头、结论枚举、证据等级、电话优先级、冻结窗格和筛选标准模块。

```text
CandidateEvaluation[] + ScreeningCriteria
  → pipeline.workbook_payload()
     ├─ 候选人总表（含「硬性门槛判定」列：满足 / 不满足（引文）/ 待确认）
     ├─ 证据匹配表
     ├─ 电话确认问题
     ├─ 筛选标准
     └─ 推荐名单（仅A类）
  → build_candidate_workbook.py
  → validate_workbook.py
  → artifact_preview.py / 下载 API / js/dialogs/preview.js 预览
```

跨表关系：

- 总表是候选人全集。
- 证据表必须与总表候选人一致。
- B 类必须在电话确认问题表中有问题。
- 推荐名单只能包含 A 类，并且不能遗漏任何 A 类。
- 联系电话、邮箱来自简历原文证据，缺失时输出“无”。

修改工作簿时的同步清单：

1. `workbook_contract.py` 的工作表名、表头和核心字段。
2. `pipeline.workbook_payload()` 的数据映射。
3. `build_candidate_workbook.py` 的写入与样式逻辑。
4. `validate_workbook.py` 的结构、安全和跨表校验。
5. `artifact_preview.py` 是否仍能正确读取。
6. 前端工作簿预览是否依赖表头位置。
7. 端到端验证：生成一份含 A/B/C 的样例评估并确认工作簿可打开、可预览。

不要通过放宽校验器来让不完整的工作簿“通过”。应修正数据源或构建逻辑。

## 9. 电话确认端到端数据流

电话链路保持单次模型调用：模型一次生成完整 `CallSummary`；程序事实守卫与软性观察守卫负责核验引用并降级无依据内容；人工编辑是最终校正边界。不存在二次模型复核。

### 9.1 创建和上传

```text
js/views/phone.js startCallProcess()
  → POST /api/calls {title, job_title, job_id, soft_skill_focus, soft_skill_dimensions}
  → CallRepository.create()
  → calls/<call_id>/record.json
  → 创建 audio/ transcripts/ summaries/

  → PUT /api/calls/<id>/audio?filename=...
  → 校验后缀和 100 MB 上限
  → reserve_audio() 处理重名
  → add_item()
  → record.json.items[] 新增 queued 条目
```

创建表单的软性关注项有两层：8 个预设维度 chips（key 存 `soft_skill_dimensions`，后端映射为中文规范名）与自定义文本（`soft_skill_focus`）。「关联筛选岗位」下拉选项来自 `/api/jobs?scope=recent&limit=100`（最近 100 个未归档岗位）；选中岗位后 `importCallJobFocus()` 请求 `/api/jobs/<id>/criteria-json`，把该岗位 `bonus_signals` 填入自定义文本，并按 `SOFT_SKILL_KEYWORD_MAP` 关键词映射勾选预设维度（零额外模型调用）。`job_id` 仅用于溯源，不参与处理逻辑。

岗位联动的约束：

- 完全替换语义：勾选与自定义文本只反映当前岗位；切回「不关联岗位」时一并清空，不累积历史岗位的导入结果。
- 竞态防护：导入请求带递增序号，快速切换岗位时仅最后一次响应生效，乱序响应被丢弃。
- 标准未就绪：岗位筛选标准尚未生成（criteria-json 404）时精确提示，不覆盖已有勾选与文本。
- draft 恢复一致性：编辑 draft 时若已关联岗位不在最近 100 条内，前端补拉 `/api/jobs/<id>` 恢复该选项，保证下拉显示与持久化 `job_id` 一致。

音频文件名、条目 ID 和候选人名是不同概念：文件名经清洗并可能因重名变化；条目 ID 从文件 stem 生成并保证任务内唯一；候选人名初始取文件 stem，后续可由模型或 HR 修正。

### 9.2 单条录音的处理阶段

```text
POST /api/calls/<id>/process
  → CallProcessor.start()
  → failed 条目重置为 queued（清除旧 summary，重试即重新生成），done 保留
  → 后台 _run() 以固定 5 路并发（ITEM_CONCURRENCY）处理 queued 条目
  → _process_item()
     1. queued → transcribing
     2. speech_to_text.transcribe_audio()
     3. render_transcript() → transcripts/<item_id>.txt
     4. transcribing → summarizing
     5. AI 单次调用完成信息整理（CallSummary）：system prompt 注入软性 8 维度框架（soft-skill-framework.md），user prompt 携带选中的维度与自定义关注项；输出四层整理结构（客观记录章节/软性概述/软性观察三要素/快筛问答）；快筛问答（qa_records）按设置开关 `call_qa_records` 决定是否要求生成（默认关闭，关闭可大幅减少模型输出、显著提速）
     6. validate_call_structure() 检查动态章节和字段完整性
     7. apply_call_guard() 校验事实引用并降级无依据字段
     8. apply_soft_skill_guard() 校验软性观察原文并剔除无依据项
     9. render_remark_narrative() 渲染统一 narrative
    10. attach_fact_timestamps() 按 fact.ref 在转写文本/原始转写中定位录音时间区间，写入 facts[].start_time/end_time（程序计算，不依赖模型输出 timestamp）
    11. summaries/<item_id>.json 和 .md
    12. record.json 中对应条目写入 summary
    13. summarizing → done
```

录音回放定位：`GET /api/calls/{call_id}/items/{item_id}/audio` 按 token 校验后返回录音文件流（前端 fetch 为 Blob 播放，不新增存储）；事实时间戳由 `attach_fact_timestamps()` 在落盘前计算并持久化到 `facts[].start_time/end_time`，旧任务无时间戳时前端降级为不可点击。

每条录音只发生一次模型调用：

| 阶段 | 模型输入 | 模型输出 | 程序责任 |
| --- | --- | --- | --- |
| 整理 | ASR 转写、可选软性关注项 | 结构化 `CallSummary`（不含 narrative；qa_records 按开关生成） | 校验结构完整性并执行两类守卫，渲染 narrative |

### 9.3 首轮摘要是稳定基线

`CallSummary` 是最终持久化和前端展示的数据结构，包括：

```text
candidate_name, call_date,
remark_sections[]     动态业务章节（title, bullets，条数不设上限、宁多勿漏）
soft_skill_summary    软性概述（来自通过守卫的详细观察）
soft_skill_summary_title  概述章节标题（可选）
soft_skill_observations[] 详细观察（name, dimension, signal, question, observation, quote, confidence, fact_id）
qa_records[]          快筛详情通篇问答（question, answer；按设置开关生成，默认关闭；关闭时程序侧解析后强制清空，模型自行输出也不保留）
narrative             由上述结构渲染的统一可编辑文本，用于展示和 Markdown 下载
fields[], facts[], extra_info[], doubts[],
guard_warnings[], transcript（转写原文，守卫与时间戳的核对基准）
```

结构化源数据是程序校验的事实来源；`narrative` 由 `render_remark_narrative()` 渲染**四层结构，每层独立可取舍**：① 客观记录章节 → ② 软性表现概述 → ③ 软性素质观察（我的问题 → 候选人回答 → 观察结论）→ ④ 快筛详情（通篇问答原文，仅开关开启且有内容时渲染）。人工编辑 `narrative` 后不反向解析回结构化字段。

首轮整理必须至少满足：

- `remark_sections` 至少一项，且每项标题与要点非空；
- `fields` 非空；
- 渲染后的 `narrative` 非空。

软性观察与快筛详情（`qa_records`）不是必填项：没有可靠原文证据时可以为空，模型不得强行凑项。`dimension` 必须使用框架规范名（热爱/自驱/韧性/逻辑/学习能力/开放性/务实/协作），不属于预设维度时才用自定义名称；`signal` 只取「积极信号」或「风险信号」。软性观察每项必须包含**触发问题 `question`（HR 提问原文）+ 候选人回答 `quote` + 观察结论 `observation` 三要素**；观察结论须客观——不只报喜，能推导性格与未来工作表现，并明确指出风险信号。

首轮若返回空壳，视为结构失败并携带错误重试一次；连续失败则该条目进入 failed，不得以空摘要标记 done。

### 9.4 事实守卫和复核触发

客观事实守卫规则（`apply_call_guard`，核对基准为**输入转写原文**（ASR 渲染文本），宽松归一 `_loose_normalize`：去空白/小写/全半角标点统一/中文数字转阿拉伯）：

- `CallFact.ref` 语义是「**转写原文原句短线索**」——prompt 强制逐字引用输入转写文本的连续原句（**含 ASR 错字原样，不得修正、不得改写、不得概括**）；因此 ref 与核对基准同源，宽松匹配容忍去口语词、标点与数字读法差异，但处理不了错字替换——这是 ref 必须与核对基准同源的根本原因。模型擅自修正错字（如「家挺」→「家庭」）会导致 ref 在原文失配，被守卫判 doubt 并降级为含糊（防编造）。
- “已确认”字段如果没有事实 ID，或引用事实未通过核验，则降为“含糊”。
- 守卫只降级依据不足的状态并记录 `guard_warnings`，不凭空补充事实。

软性观察守卫规则（`apply_soft_skill_guard`）：

- 每项观察的 `name`、`observation`、`quote`、`confidence` 必须非空；`question` 不核对（仅作展示）。
- `quote` 必须在输入转写原文中逐字回查，且 `fact_id` 指向 `speaker=候选人` 的有效事实。
- 未通过守卫的观察被剔除并写入 `guard_warnings`，不得进入软性概述。
- 全部观察被剔除时清空 `soft_skill_summary` 并告警；单项失败不清空完整 Remark。

`qa_records`（快筛详情）与软性观察的 `question` **不参与守卫**——它们是 HR 按需取舍的整理材料而非程序断言，这是刻意设计。

### 9.5 多录音并发与隔离

同一电话任务中的录音以固定 5 路并发处理（`ITEM_CONCURRENCY`）：每条录音各自独立完成“转写 → 整理 → 守卫 → 落盘”，互不阻塞。每个条目创建独立模型客户端，摘要文件使用独立 `item_id`，仓储通过 `update_item()` 在锁内读取最新 `record.json` 并只更新目标条目。

因此批量处理必须保持以下隔离：

- 条目 A 的结果不能引用或修改条目 B 的字段、事实或正文；
- 单条失败不删除其他条目的成功产物；
- `done` 条目重试时不重新处理；
- 任务最终只要存在 failed 条目即为 failed，但成功条目仍保留。

### 9.6 人工编辑

```text
电话详情页编辑 candidate_name / narrative / fields[].value
  → PUT /api/calls/<call_id>/items/<item_id>
  → 后端读取已持久化 CallSummary
  → 完整覆盖允许人工编辑的值
  → 同步覆盖 summaries/<item_id>.json 和 .md
  → CallRepository.update_item()
  → 前端重新 GET 完整任务
```

人工编辑发生在 AI 整理与程序守卫完成之后，是最终人工校正边界。修改 `CallSummary`、`CallField`、`CallFact` 时，必须同步检查：整理 prompt、完整性校验、事实守卫、Markdown、编辑 API、前端字段渲染与保存、电话回归验证。

## 10. 电话状态机与取消语义

任务状态：

```text
draft → running → done
                    ├─> failed
                    └─> cancelled
failed/cancelled → process → running
```

条目状态：

```text
queued → transcribing → summarizing → done
   │          │              │
   └──────────┴──────────────┴──> failed
failed → queued
transcribing/summarizing --取消或进程中断→ queued
```

重要区别：

- `CallProcessor` 最多并行处理两个电话任务，同一任务内的录音以固定 5 路并发处理。
- 取消会中止活跃 LLM 客户端。
- ASR 请求在线程中执行，不能真正强制终止底层 HTTP；主流程通过轮询取消事件停止等待并丢弃迟到结果。
- 取消后 done 条目保留，中间态条目回 queued，便于再次处理。
- 单条失败不抹掉其他已完成条目的产物，但任务总体状态为 failed。

状态改动必须同步 `call_state.py`、`phone_screening.py`、仓储归档/删除限制、电话 API、前端状态标签和轮询、电话验证。

## 11. 前后端 API 契约

### 11.1 通用约束

- 所有 `/api/` 请求必须带 `X-App-Token`。
- JSON 请求使用 `application/json`。
- 错误响应优先返回 `{"detail": "可展示说明"}`。
- 文件下载使用非 JSON 响应；中文文件名优先采用 RFC 5987 `filename*=utf-8''...`。
- 前端 `api()` 会根据响应 Content-Type 决定返回 JSON 还是原始 `Response`。

### 11.2 Job 前端依赖字段

```text
id, title, status, stage, progress, completed, total,
results, errors, elapsed_seconds,
evaluation_started_at, updated_at, archived_at
```

候选人结果依赖字段：

```text
candidate_name, source_file, conclusion,
one_line, blockers, next_action
```

`conclusion` 当前是中文业务枚举，不是展示文案：

```text
A优先约面
B电话确认
C不推进
```

前端统计和筛选使用精确匹配。若改为代码枚举或英文值，必须同步后端模型、证据守卫、排序、Excel、前端、对比逻辑和验证。

### 11.3 Call 前端依赖字段

任务：

```text
id, title, job_title, job_id, soft_skill_focus, soft_skill_dimensions,
status, stage, updated_at, archived_at, errors, items
```

条目：

```text
id, audio_file, candidate_name, stage, status,
progress, error, summary
```

摘要（服务端持久化并由前端读取）：

```text
candidate_name, call_date, narrative,
soft_skill_summary, soft_skill_observations[].{name,dimension,signal,question,observation,quote,confidence,fact_id},
qa_records[].{question,answer},
fields[].{key,label,value,status,fact_ids,note},
facts[].{id,content,speaker,timestamp,ref,start_time,end_time},
extra_info, doubts, guard_warnings, transcript
```

`fields[].key` 是人工编辑的稳定身份；`facts[].id` 是事实引用（字段 `fact_ids`）的稳定身份。修改它们会影响事实守卫、人工编辑和旧摘要兼容。

### 11.4 前端轮询

- Job：每 1200 ms 请求一次 `/api/jobs/<id>`。
- Call：每 2500 ms 请求一次 `/api/calls/<id>`。
- 网络错误不会停止轮询。
- 切换当前任务后，响应必须再次检查 ID，防止旧请求污染新视图。

修改详情 API 的负载大小或字段时，要考虑高频轮询成本。Bootstrap 和历史列表应继续返回摘要，不要无条件携带完整结果。

## 12. 并发与持久化交叉影响

### 12.1 并发层级

```text
FastAPI 异步请求
  ├─ 每个岗位任务上传：asyncio.Lock 串行
  ├─ EvaluationEngine：最多 2 个岗位任务并行
  │    └─ 每个岗位内部：1–12 个候选人线程并行
  ├─ CallProcessor：最多 2 个电话任务并行
  │    └─ 每个电话任务内部：录音以固定 5 路并发处理
  └─ JsonStore：RLock 保护同进程 JSON 读写
```

电话条目并发数由 `phone_screening.py` 的 `ITEM_CONCURRENCY` 常量固定为 5，对应火山「大模型录音文件识别（极速版）」正式版默认并发上限。

### 12.2 不可破坏的并发保证

- `CallRepository.update_item()` 必须在锁内重新读取最新任务，只更新目标条目，避免并发覆盖其他条目。
- 同任务简历上传锁保护 `resume_files` 和 `resume_hashes` 的读改写。
- 原子文件替换保护 JSON 和 Excel 不出现半写入状态。
- 候选人失败隔离：单份失败不能丢失其他结果。
- 任务级取消隔离：取消任务 A 不能中止任务 B 的模型客户端。
- 对比缓存必须包含任务 ID 和结果文件哈希，避免跨任务污染或结果变化后返回旧排序。

涉及线程池、锁、保存顺序、future 或取消事件的修改，必须运行并发、取消、上传竞争、断点恢复和对比缓存相关验证。

## 13. 安全边界及其交叉依赖

| 安全边界 | 实现位置 | 修改时同步检查 |
| --- | --- | --- |
| 仅监听回环地址 | `main.py` Uvicorn 配置 | 启动、烟测、产品约束 |
| API 本地令牌 | `main.py` 中间件、HTML meta、`js/core/api.js api()` | 首页注入、所有 API 验证 |
| DPAPI 密钥保护 | `config.py` | 设置 API、迁移、公开设置、验证 |
| 文件名清洗 | `repository.py` | 上传、下载、预览、结果 `source_file` |
| 路径边界 | 仓储、`artifact_preview.py` | 下载、预览、删除、路径逃逸验证 |
| 上传大小限制 | `main.py`、`speech_to_text.py` | 前端提示、错误码、验证 |
| Prompt 注入防护 | `pipeline.py`、`phone_screening.py` | Prompt、结构验证、证据守卫 |
| 原文证据校验 | `pipeline.py`、`phone_screening.py` | 分级、人工展示、验证 |
| Excel 公式和外链防护 | 构建器、校验器 | 工作簿契约、预览、验证 |
| XSS 防护 | 前端 js/ 模块以 DOM/textContent 渲染 | Markdown、模型输出、表格预览 |

不要为了修复表面失败而绕过令牌、路径校验、证据守卫或工作簿校验。

## 14. 变更影响矩阵

| 如果修改 | 必须同步检查 |
| --- | --- |
| `AppSettings` 字段或默认值 | `config.py` 迁移和公开设置、`main.py` 请求模型及设置路由、`js/dialogs/settings.js` 表单和 payload、设置验证 |
| API 路径、方法或响应字段 | `main.py`、前端 js/ 模块所有调用和渲染、API 验证、必要时发布烟测 |
| Job 状态或 stage 语义 | `pipeline.py`、仓储归档限制、`main.py` 冲突处理、前端轮询/按钮/历史、状态验证 |
| Call 状态或条目状态 | `call_state.py`、`phone_screening.py`、仓储、路由、前端状态标签和轮询、电话验证 |
| `ScreeningCriteria` | 标准 prompt、校准 API、前端编辑器、Markdown、Excel 标准表、验证 |
| `CandidateEvaluation` | 评估 prompt、证据守卫（含硬性门槛 `apply_hard_gate_guard`）、排序、持久化结果、Excel（含「硬性门槛判定」列）、前端结果、对比 |
| 证据维度或核心维度 | `models.py`、prompt、guard、evidence strength、Excel 证据表 |
| 硬性门槛 `hard_gate` / `HardGateVerdict` | criteria prompt、评估 prompt、`apply_hard_gate_guard()`、Excel 总表列、硬性门槛验证 |
| 软性素质维度 / `SoftSkillObservation`（dimension、signal、question） | `soft-skill-framework.md`、整理 prompt、四层 narrative 渲染、前端维度 chips、前端岗位联动关键词映射 `SOFT_SKILL_KEYWORD_MAP`、电话验证 |
| A/B/C 枚举 | 模型、guard、排序、工作簿契约、校验器、前端精确匹配、AI 对比、验证 |
| `source_file` 语义 | 上传命名、续跑、追加简历、结果预览、AI 对比、缓存、前端选择键、验证 |
| 简历解析策略 | `extract_resume_text.py`、`pipeline.extract_document()`、OCR 状态、上传类型、预览支持、解析验证 |
| Excel 表名或表头 | `workbook_contract.py`、payload、构建器、校验器、预览、验证、业务使用方 |
| 结果/产物文件名 | `pipeline.py`、下载/预览路由、续跑、对比缓存、历史老任务兼容 |
| 检查点保存顺序 | 原子写逻辑、恢复逻辑、取消、并发和中断验证 |
| 模型调用或重试策略 | `llm.py`、取消语义、设置 timeout、筛选/电话/对比调用、错误验证 |
| `CallSummary` / `CallField` / `CallFact` / `CallQA` | 整理 prompt、完整性校验、事实守卫、四层 narrative 渲染、持久化 JSON/Markdown、编辑 API、前端展示、旧摘要兼容、回放定位（`start_time`/`end_time` 与音频访问 API）、电话验证 |
| ASR 请求参数或响应结构 | `speech_to_text.py`、电话处理器、设置的 ASR 状态、STT 验证 |
| 首页 DOM ID 或 class | 前端 js/ 模块的节点查询和事件、`styles.css`、首页验证、发布烟测 |
| 前端本地存储键 | 初始化恢复、切换工具、新建任务、历史恢复 |
| 版本号 | 仅 `app/__init__.py` 的 `__version__`；`build_windows.ps1` 自动同步到生成的 `version_info.txt` 与 `.iss`（`/DMyAppVersion`） |
| 启动参数或 `/health` | `main.py`、`launcher.py`、`verify_windows_release.ps1`、重复实例探测 |
| 清理目录规则 | `.gitignore`（`release/`、`build/`、`dist/`、`.workbuddy/` 已忽略）、`build_windows.ps1` 拒绝覆盖已存在 release 目录 |

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
9. 修改 `field.key` 或 `fact.id`：会破坏事实引用和既有摘要兼容。
10. 修改公开配置：可能意外泄露明文密钥或让前端错误判断“已配置”。
11. 修改发布版本或手动清理 release：可能误删可交付 release，或让构建、安装器和 release 目录版本不一致。

## 17. 设计上的单一事实来源

维护时应尽量维持以下“单一事实来源”：

- 配置结构：`AppSettings`。
- 应用版本号：`app/__init__.py` 的 `__version__`（`version_info.txt` 与 `.iss` 为构建时派生）。
- 简历和电话业务结构：`app/models.py`。
- 电话最终摘要：首轮守卫后的 `CallSummary`；人工编辑以 `PUT /api/calls/<id>/items/<item_id>` 覆盖，编辑后的值仍持久化到同一 `summaries/*.json`。
- 电话事实引用身份：`CallFact.id`。
- Excel 结构：`workbook_contract.py`。
- Job 真实持久化状态：每个任务的 `job.json`，结果详情由 `评估结果.json` 补充。
- Call 真实持久化状态：每个任务的 `record.json`，摘要详情由 `summaries/*.json` 补充。
- 状态转换：简历由 `EvaluationEngine` 控制，电话条目由 `call_state.py` 和 `CallProcessor` 控制。
- 前端当前视图：`js/core/state.js` 的 `state`，但服务端任务对象才是跨重启事实来源。
- 正式筛选交付：通过 `validate_workbook_detailed()` 的 Excel 文件。

如果同一规则在多处出现，不要只改其中一处；先判断哪一处是事实来源，其余位置是映射、校验还是展示。

## 18. 当前刻意保留的人工边界

这些不是未完成自动化，而是产品安全设计：

- AI 生成筛选标准后必须由 HR 校准。
- 模型候选人评估必须经过原文证据守卫。
- 硬性门槛判定由程序强制：任一明确不满足直接 C，模型不得放宽；存在 unknown 一律降 B 转电话确认。
- 电话摘要必须经过转写原文事实守卫（`ref` 与核对基准同源于输入转写原文，含 ASR 错字原样）。
- 快筛详情（`qa_records`）与软性观察的 `question` 不经程序核对——它们是 HR 按需取舍的整理材料，不是程序断言。
- 电话整理结果允许 HR 修改。
- Excel 校验只保证结构、安全和跨表一致性，不宣称业务判断必然正确。

修复“通过率低”“A 类减少”“字段变成待确认”等问题时，应先检查模型引用是否真实、Prompt 和解析是否正确，不得直接放宽这些边界来制造表面成功。

## 19. 文档维护要求

出现下列变更时应同步更新本文：

- 新增核心模块、业务链路或外部服务；
- 修改 Job/Call 状态机；
- 修改核心模型或持久化格式；
- 修改 API 字段、结论枚举或工作簿契约；
- 修改并发、取消、恢复或检查点机制；
- 修改密钥、文件、证据或 Excel 安全边界；
- 修改 Windows 构建、安装或清理流程。

本文应描述当前代码事实，不记录临时调试过程。具体故障证据放入 `debug/`，修复完成后只将稳定的架构约束回写到本文。
