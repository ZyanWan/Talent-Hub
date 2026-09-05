# 代码地图

> 后端、前端、运行脚本和 UI 组件的职责与依赖。
>
> 返回 [SOURCE_MAP.md](../SOURCE_MAP.md) 选择其他主题。

## 2. 代码地图

| 模块 | 核心职责 | 主要影响对象 |
| --- | --- | --- |
| `app/main.py` | 应用装配、路由、令牌中间件、上传限制、下载和预览、服务启动；PDFium 预览在进程内串行执行 | 前端 API、仓储、筛选引擎、电话处理器 |
| `app/config.py` | 数据目录、`AppSettings`、Windows DPAPI、macOS 环境变量、持久化配置兼容和公开配置 | 模型、ASR、飞书、设置界面、发布运行环境 |
| `app/feishu.py` | 飞书签名、脱敏、消息构建、大小保护、有限重试、频控和 `push_with_status` | 设置测试、筛选与电话通知 |
| `app/models.py` | 筛选、证据、硬性门槛和电话摘要的 Pydantic 契约 | Prompt 输出、持久化 JSON、Excel、前端字段 |
| `app/repository.py` | `JsonStore` 通用仓储、岗位任务目录、归档、删除、文件名与路径安全 | `main.py`、`pipeline.py`、`call_repository.py` |
| `app/call_repository.py` | 电话任务、音频身份、条目状态和通知字段持久化 | `main.py`、`phone_screening.py`、电话前端 |
| `app/llm.py` | OpenAI Chat Completions 兼容请求、动态输入序列化、JSON 提取、重试、终止原因和取消 | 筛选标准、候选人评估、横向对比、电话整理 |
| `app/pipeline.py` | 简历筛选主流程、证据与硬门槛守卫、检查点续跑、Excel 载荷和通知挂点 | Job 状态、结果 JSON、工作簿、前端进度 |
| `app/artifact_preview.py` | Markdown 和 Excel 的限量安全预览 | 产物预览 API、`PreviewDialog` |
| `app/runtime/extract_resume_text.py` | PDF、DOCX、文本与图片解析、清洗、OCR 和质量判断 | `pipeline.py`、解析 CLI 与验证 |
| `app/runtime/build_candidate_workbook.py` | 五表 Excel 构建、格式和公式注入防护 | `pipeline.py`、工作簿校验 |
| `app/runtime/validate_workbook.py` | Excel 结构、跨表关系和安全校验 | 正式交付状态、工作簿验证 |
| `app/runtime/workbook_contract.py` | 表名、表头、枚举和跨表契约 | 构建器、校验器、业务输出 |
| `app/runtime/call_state.py` | 电话任务与条目状态转换、中断收敛 | 电话处理、重试和取消 |
| `app/runtime/speech_to_text.py` | 火山 ASR 请求、音频校验和转写渲染 | 电话处理、ASR 配置与验证 |
| `app/runtime/phone_screening.py` | 电话转写编排、结构化整理、必填结构校验、narrative/Markdown 渲染和事实引用录音定位 | Call 状态、摘要文件、电话详情 |
| `frontend/src/` | React + TypeScript 前端；`App.tsx` 负责外壳和协调，`views/` 负责业务视图，`ui/` 负责对话框与基础组件 | 后端路由、字段、状态枚举和前端验证 |
| `launcher.py` | PyInstaller 启动入口 | `app.main.main()`、打包配置 |
| `start-app.bat` | 启动后端和 `vite build --watch`；前端依赖需已安装 | 本地开发启动 |
| `scripts/build_windows.ps1`、`scripts/verify_windows_release.ps1` | Windows 构建、版本资源、许可证、安装器和发布烟测 | `packaging/`、`release/`、启动参数与 `/health` |
| `packaging/talent_hub_macos.spec`、`scripts/build_macos.sh`、`scripts/verify_macos_release.sh` | macOS 应用包、资源收集、版本化 zip 和发布烟测 | macOS 发布产物 |
| `scripts/extract_model_texts.py` | 从生产 Prompt 构造函数生成生产模型输入清单 | `docs/MODEL_INPUT_TEXTS.md` |
| `docs/MODEL_INPUT_TEXTS.md` | 生产模型调用的静态文本、动态边界、重试指令和请求信封 | Prompt 审阅与变更核对 |

### 运行时与背景参考分类

- `app/resources/references/evidence-rules.md` 由 `app/pipeline.py` 注入筛选标准 Prompt；`soft-skill-framework.md` 由 `app/runtime/phone_screening.py` 注入电话整理 system Prompt。两者会进入生产模型上下文。
- `app/resources/references/excel-output.md` 与 `pdf-parsing.md` 是工程参考，生产代码没有读取它们，不进入模型上下文。
- `docs/references/` 是外部背景材料，不参与运行，也不是实现事实来源。

### 2.1 前端模块化约定

前端通过 Vite 构建到 `frontend/dist`，由 FastAPI 托管。模块间优先使用显式 import、props 和 API 契约；需要跨视图共享的少量运行态放在 `frontend/src/state/index.ts`。

当前实际参与生产行为的全局字段如下：

| 使用范围 | 字段 |
| --- | --- |
| 应用协调与公共状态 | `language`、`settings`、`jobs` |
| 简历筛选 | `currentJob`、`selectedResumes`、`resultFilter`、`pollTimer` |
| 简历预览与对比 | `resumeRenderCache`、`compareSelection` |
| 电话确认 | `currentCall`、`callPollTimer`、`pendingCallFiles` |

`App.tsx` 在启动、导航和任务记录变更时会协调写入 `settings`、`jobs`、`currentJob` 与 `currentCall`；这些写入不是业务视图越权。`GlobalState` 中未列入上表的声明当前不作为行为输入，不能仅因字段存在就把它们视为有效前端契约。组件内的表单、弹窗、请求序号和音频缓存保持局部状态。

- `frontend/src/api/client.ts` 是唯一 API client，负责 `X-App-Token`、JSON Content-Type、非 JSON 响应和 `detail` 错误透传。
- `frontend/src/i18n/messages.ts` 是手工维护的双语消息源；新增或修改 key 时同步维护 `zh-CN` 与 `en`。`frontend/src/i18n/index.ts` 读写 `state.language`、持久化语言并广播变化。
- `frontend/src/router/index.ts` 管理 screening/phone 视图生命周期；`currentView()` 是轮询丢弃跨视图响应的判断来源。各视图在自己的 `exit` 停止所属轮询。
- `frontend/src/App.tsx` 渲染外壳、顶栏、语言、设置、任务记录与业务视图；启动 effect 请求 `GET /api/bootstrap`。筛选子页面使用 React `view` 状态和 `showSection()` 切换，router 将它们归为同一个 screening 生命周期。
- `frontend/src/ui/SettingsDialog.tsx` 使用同一个 `buildPayload()` 构造保存、模型测试和飞书测试请求；密钥框不回填明文，空值表示保留，清除按钮提交一次性 `clear_*` 标志。
- `frontend/src/ui/HistoryDrawer.tsx` 负责 Job/Call 最近与归档列表、分页、归档、恢复和删除；打开任务通过 props 交给 `App.tsx`，不直接依赖业务视图。
- `frontend/src/ui/PreviewDialog.tsx` 预览筛选标准与工作簿；`CompareDialog.tsx` 发起和取消 A/B 候选人横向对比；基础组件集中在 `frontend/src/ui/`。
- `frontend/src/views/ScreeningView.tsx` 负责 Job 创建、JD/简历上传、标准校准、轮询、结果筛选、通知重试、追加简历和下载/对比接线。关键端点为 `/api/jobs`、`/jd`、`/resumes`、`/start`、`/cancel`、`/criteria-json` 与 `/retry-notification`。
- `frontend/src/views/ResumeWorkspace.tsx` 负责本地与已存简历预览；PDF 通过后端预览端点渲染，图片使用 Blob URL，本地 PDF 页面缓存于 `state.resumeRenderCache`。
- `frontend/src/views/PhoneView.tsx` 负责 Call 创建、关联岗位关注项导入、录音上传、处理/取消/重试、轮询和条目列表。任务创建提交 `title_mode`，追加录音仅允许 `done` 且未归档任务。
- `frontend/src/views/CallItemDetail.tsx` 负责录音播放、事实时间跳转、字段与 narrative 编辑、任务回读和 Markdown 下载。事实引用仅用于尝试定位录音，不裁决正文或字段状态。

前端单元与契约测试位于 `frontend/tests/`；后端契约、状态、并发和发布验证位于 `tests/` 与 `scripts/verify_*`。文档只描述测试锁定的行为范围，不固定用例数量。

### 2.2 前端 UI 行为约定

- 编辑类对话框（设置、简历工作台、电话条目）通过关闭按钮或 ESC 退出，不响应遮罩点击；查看类对话框（预览、对比、任务记录）允许遮罩关闭；删除确认框必须显式选择操作。
- 下拉菜单统一复用 `frontend/src/ui/customSelect.ts`，保持原生 `select` 的值和 `change` 语义，并提供键盘导航、方向自适应和语言更新。
- 页面和动态滚动区使用稳定的滚动条槽位，避免内容长度变化造成横向跳动。
- UI 文案来自 i18n 消息源，模型输出和 Markdown 以文本方式渲染；不得绕过 React 默认转义插入不可信 HTML。
