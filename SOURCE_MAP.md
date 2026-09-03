# Talent Hub 源码地图与变更影响指南

> 本文是对当前源码实现的事实映射，不是预设架构蓝图。它面向维护者和 AI 编程助手，目标不是逐行解释代码，而是明确数据如何流动、状态如何变化、模块如何互相约束，以及修改某处时必须同步检查哪些位置。
>
> 维护原则：任何改动都先定位“数据来源 → 中间状态 → 持久化 → API 输出 → 前端消费 → 验证契约 → 发布产物”的完整链路，避免局部修改造成跨层失配。

## 1. 项目定位与边界

Talent Hub 是一个本机运行的 Python/FastAPI 招聘工作台，前端为 React + TypeScript（Vite 构建，构建产物 `frontend/dist` 由 FastAPI 托管）。它包含两条主要业务链路：

1. 简历筛选：JD、简历上传、标准生成与人工校准、候选人评估、证据校验、硬性门槛程序化过滤、A/B/C 分级、Excel 交付和候选人横向对比。
2. 电话确认：录音上传、火山引擎 ASR、AI 单次结构化整理（含动态 Remark、软性 8 维度框架概述和可选快筛问答）、三层整理记录 narrative、事实引用守卫、人工编辑和 Markdown 下载。软性概述由 Prompt 约束并由 HR 人工复核，不经过独立的程序化引用守卫。

系统边界：

- HTTP 服务只监听 `127.0.0.1`。
- 所有 `/api/` 请求必须携带当前进程生成的本地会话令牌。
- Windows 上模型 API Key、ASR API Key 和飞书签名密钥使用当前用户的 DPAPI 加密；macOS 上通过环境变量提供敏感密钥。
- 简历、录音、解析文本和产物保存在本机数据目录，不写入源码目录。
- 模型输出不是直接真相；简历与电话链路均有原文证据校验和人工复核边界。
- Excel 是正式交付产物，必须符合固定五表契约并通过安全校验。

## 2. 代码地图

| 模块 | 核心职责 | 主要影响对象 |
| --- | --- | --- |
| `app/main.py` | 应用装配、路由、令牌中间件、上传限制、下载和预览、服务启动；PDFium 预览渲染在进程内串行执行 | 前端全部 API、仓储、筛选引擎、电话处理器 |
| `app/config.py` | 数据目录、配置模型、Windows DPAPI、macOS 环境变量 fallback、配置迁移和公开配置 | 模型调用、ASR、飞书推送、前端设置、发布运行环境 |
| `app/feishu.py` | 飞书 Webhook 推送：签名、统一脱敏、筛选/电话消息构建、20KB 大小保护、有限重试、频控及带成功状态的 `push_with_status` | `main.py`（feishu-test）、`pipeline.py`、`phone_screening.py`、设置配置 |
| `app/models.py` | 筛选（含硬性门槛判定）、证据、电话摘要（动态章节/软性观察/快筛问答）的 Pydantic 契约 | Prompt 输出、持久化 JSON、Excel、前端字段 |
| `app/repository.py` | `JsonStore` 通用 JSON 仓储、岗位任务 JSON、文件目录、归档、删除、路径和文件名安全 | `main.py`、`pipeline.py`、`call_repository.py`、任务恢复 |
| `app/call_repository.py` | 电话任务（含 soft_skill_focus、soft_skill_dimensions、job_id）、音频与条目持久化 | `main.py`、`phone_screening.py`、前端电话页 |
| `app/llm.py` | OpenAI 兼容接口、JSON 提取、重试、取消 | 筛选标准、候选人评估、横向对比、电话整理 |
| `app/pipeline.py` | 简历筛选主流程、证据守卫、续跑、Excel 载荷 | 任务状态、结果 JSON、工作簿、前端进度 |
| `app/artifact_preview.py` | Markdown 和 Excel 安全预览 | 产物预览 API、前端预览对话框 |
| `app/runtime/extract_resume_text.py` | PDF、DOCX、文本基础解析、清洗（去水印/修复断词/清控制字符）及质量判断 | `pipeline.py`、解析 CLI |
| `app/runtime/build_candidate_workbook.py` | 五表 Excel 构建和公式注入防护 | `pipeline.py`、Excel 验证 |
| `app/runtime/validate_workbook.py` | Excel 结构、跨表关系和安全校验 | `pipeline.py`、交付是否完成 |
| `app/runtime/workbook_contract.py` | 五表名称、表头、枚举和格式契约 | 构建器、校验器、验证、业务输出 |
| `app/runtime/call_state.py` | 电话条目状态机和中断收敛 | `phone_screening.py`、电话重试和取消 |
| `app/runtime/speech_to_text.py` | 火山 ASR 请求、音频输入校验、请求参数和转写渲染 | 电话处理器、ASR 验证 |
| `app/runtime/phone_screening.py` | 电话处理、事实引用守卫、软性 8 维度框架注入、三层 narrative 渲染（客观记录/软性表现概述/可选快筛详情）、Markdown | 电话任务状态、摘要文件、前端电话详情 |
| `app/resources/references/` | 运行时参考规则库：证据规则、Excel/PDF 规则、易错点和软性素质框架 | `pipeline.py`、`phone_screening.py`、Prompt 与守卫规则 |
| `frontend/src/**` | React+TS 前端：App.tsx（外壳/顶栏/启动）、views/（筛选/电话/简历工作台）、ui/（弹窗与基础组件）、api/client.ts（唯一 API client）、i18n/（messages.ts 唯一消息源）、router/、state/、customSelect.ts | 后端路由、JSON 字段、状态枚举、契约与单元测试 |
| `launcher.py` | PyInstaller 薄启动入口 | `app.main.main`、打包配置 |
| `start-app.bat` | Windows 一键启动：后端（launcher.py）+ 前端监听（`vite build --watch` 自动重建 dist） | `launcher.py`、`frontend/` 构建 |
| `scripts/build_windows.ps1` | Windows PyInstaller、图标生成、许可证、烟测、安装器编排（可跳过烟测/安装器） | 版本、发布目录、packaging 文件 |
| `scripts/verify_windows_release.ps1` | 发布 EXE 的启动、临时数据目录和首页烟测 | `main.py` 参数、`/health`、首页结构 |
| `packaging/talent_hub_macos.spec` | macOS PyInstaller `.app` bundle 配置 | macOS 发布产物、资源收集、启动入口 |
| `scripts/build_macos.sh` | macOS PyInstaller 构建、许可证、烟测和版本化 zip 输出 | 版本、发布目录、macOS packaging 文件 |
| `scripts/verify_macos_release.sh` | macOS 可执行文件启动、临时数据目录和首页烟测 | `main.py` 参数、`/health`、首页结构 |
| `tests/test_resume_preview.py` | PDF 预览并发串行化与失败清理回归验证 | `app/main.py` 的 PDFium 渲染边界 |
| `debug/` | 非生产链路的调试和实验辅助目录 | Prompt 对比、问题复现、维护记录 |

### 2.1 前端模块化约定

前端为 React + TypeScript（Vite 构建，构建产物 `frontend/dist` 由 FastAPI 托管）。模块边界与职责约定：

- 组件以 `frontend/src/views/`（页面视图）与 `frontend/src/ui/`（弹窗与基础组件）划分，各自负责本作用域 DOM 的渲染与事件绑定，只通过显式 import / props 依赖其他模块。
- 全局 `state` 保持单一对象（`frontend/src/state/index.ts`），字段按归属约定读写，禁止跨模块写他人字段：

  | 归属 | state 字段 |
  | --- | --- |
  | shell | language、toolStripOpen |
  | settings | settings、clearAsrPending、clearFeishuSignPending |
  | history | jobs、archivedJobs、historyScope、historyTotals、historyKind、historyLoading、storageStats、callTasks、callArchivedTasks、callScope、callTotals |
  | screening | currentJob、selectedResumes、resultFilter、liveResultKeys、criteriaBase、pendingDeleteJob、pollTimer |
  | resume | resumePreviewIndex、resumePreviewUrl、resumeRenderController、resumeRenderCache、resumePrefetchController、storedResumePreview |
  | phone | currentCall、callPollTimer、pendingCallFiles、pendingDeleteCall |
  | compare | compareSelection、compareCancelKey |
  | preview | previewKind、previewPayload、previewSheetIndex、previewRequest |

- `frontend/src/router/index.ts` 集中视图切换与轮询生命周期：视图注册 `{ enter, exit }`，`show(name)` 负责「离开旧视图 → 隐藏全部 section → 进入新视图」。轮询互斥约定：**每个视图主要在自己的 `exit` 里停止本视图的轮询字段**（screening 停 `state.pollTimer`、phone 停 `state.callPollTimer`，见上表归属），由「同一时刻仅一个视图激活」天然保证互斥；退出应用流程存在防御性跨轮询清理。新增视图只需在自己的 `exit` 停自己的轮询即可，不应新增常规跨视图感知。轮询回调通过 `currentView()` 判断是否丢弃过期结果。模块局部 UI 状态（如电话软性维度选择、岗位导入序号、音频 Blob 缓存）不进入全局 `state` 表。
- `frontend/src/i18n/index.ts` 的 `onChange()` 是语言切换广播：各组件订阅后重渲染，`setLanguage` 只写 `state.language` + 持久化 + 广播，不直接调用各视图渲染函数。

新增页面（视图或对话框）的标准流程：① 在 `frontend/src/views/` 或 `frontend/src/ui/` 新建 React 组件，提供受控 props 与交互逻辑；② 需要的双语文案在 `frontend/src/i18n/messages.ts` 中 zh/en 同步新增 key；③ 在 `App.tsx` 中接线渲染与显隐；④ 不触碰其他模块，跨模块数据只走显式 import / props / 全局 state 归属字段。

历史任务抽屉（`HistoryDrawer`）与筛选/电话视图之间不互相 import：通过外层 `App` 传入的 `onOpenJob` / `onOpenCall` props 回调完成「从历史打开任务」的导航。

#### React 生产前端实现约定

`frontend/` 是生产前端实现（React + TypeScript，Vite 构建；构建产物 `frontend/dist` 由 FastAPI 托管，`GET /` 注入 token、根路径挂载静态资源）：

- `frontend/src/api/client.ts`：唯一 API client，实现 `X-App-Token` 注入、string body JSON Content-Type、错误 `detail` 透传三态、content-type JSON/非 JSON 判定；行为由契约测试 `api-client.test.ts` 锁定。
- `frontend/src/i18n/`：`messages.ts` 为手工维护的唯一消息源（zh/en 各 255 key，勿手改）；`index.ts` 提供 `t` / `getLanguage` / `setLanguage` / `onChange`，语言状态以 `src/state` 的 `state.language` 为唯一事实来源，`setLanguage` 写 `state.language` + 持久化并广播；key 全集由 `i18n.test.ts` 锁定。
- `frontend/src/state/index.ts`：全局状态单对象（`compareSelection` 为 `Set`、`resumeRenderCache` 为 `Map`、`pollTimer`/`callPollTimer` 为定时器句柄），字段按 §2.1 归属表以注释分组标注；`state.language` 为前端语言唯一事实来源，被 `frontend/src/i18n/` 消费（`getLanguage` / `setLanguage` / `t` 均读写 `state.language`），行为由 `frontend/tests/unit/state.test.ts` 锁定。
- `frontend/src/router/index.ts`：视图路由（`registerView(name, {enter, exit})` / `show(name)` / `showSection(sectionId)` / `currentView()`）；`show` 顺序固定为 exit 旧视图 → 更新 current → hideAll（5 个 section 与 `resultActions`/`appendResumesButton`/`appendCallAudioButton` 隐藏、`viewTitle` 可见）→ enter 新视图，同一视图重复 show 直接返回；不依赖全局 state，DOM 查找内联 `document.getElementById`（元素缺失时 `console.warn`），行为由 `router.test.ts` 锁定。
- `frontend/src/ui/customSelect.ts`：自定义下拉组件（隐藏的原生 `select` 做值载体，`value` 读写与 `change` 事件语义不变；菜单从 `select.options` 渲染，动态 option 变化后调用 `sync()` 重建；展开/收起过渡与键盘导航（方向键/Enter/Space/Tab/Escape）；方向自适应按最近滚动容器/视口底部判断向上/向下弹出，菜单限高 300px 内部滚动；订阅 `src/i18n` 的 `onChange`，语言切换自动重建菜单——option 文案由 React 异步提交 DOM，故 `onChange` 回调经双 `requestAnimationFrame` 延迟到提交完成后执行 `sync()`，避免重建时读到切换前旧文案），对外仅暴露 `createCustomSelect({ wrap, select })` → `{ sync, close }`，行为由 `frontend/tests/unit/customSelect.test.ts` 锁定。
- `frontend/src/ui/`：基础 UI 组件（React + TSX），class 名 / ARIA / 状态语义对齐 `frontend/public/styles.css` 的 shell 与状态样式体系，样式 token 直接引用现有 CSS 变量（`--ink`/`--paper`/`--surface-muted`/`--red`/`--blue-soft` 等），不引入新设计。各组件：
  - `Button.tsx`：`Button({ variant: "primary"|"secondary"|"danger"|"icon"|"send", busy, ... })`，variant 映射 `.primary-button`（黑底白字）/`.secondary-button`（白底描边）/`.danger-button`（红底）/`.icon-button`（圆形 36px）/`.send-button`（黑色主 CTA）；`busy` 时加 `.is-busy`（13px spinner 由 CSS `::before` 绘制）、置 `disabled`、写 `aria-busy="true"`，非 busy 时不携带 `aria-busy`；默认 `type="button"`。
  - `StatusDot.tsx`：`.status-dot`（默认金色未就绪态）/`.status-dot.ready`（蓝色就绪态）；无独立 error 样式类，`status="error"` 只渲染基类。
  - `Tag.tsx`：`.conclusion` + 等级修饰类（`grade="a"|"b"|"c"` → `.a` 浅蓝 / `.b` 浅金 / `.c` 浅红），等级换算：A→a、B→b、其余→c，由调用方换算后传入。
  - `Progress.tsx`：`.progress-track`（高 4px、圆角、`--surface-muted` 底）内嵌填充 `span`，宽度经内联 style 控制并收敛到 0-100；电话视图结构相同的 `.call-progress-track` 通过 `trackClassName` 复用。
  - `Toast.tsx`：`.toast` + `role="status"` + `hidden` 显隐控制（`open` prop）；自动隐藏定时属调用方应用逻辑，不在组件内。
  - `EmptyState.tsx`：两种 DOM 形态——`variant="history"` → `.history-empty-state`（flex 列居中，可选图标 + 文案）；`variant="table"` → `tr.empty-row > td`（结果表空行）。
  - 渲染级断言由 `frontend/tests/unit/ui-components.test.tsx` 锁定（jsdom，不截图）。
  - `PreviewDialog.tsx`：产物预览弹窗（查看类：关闭按钮 + ESC + 点遮罩关闭，无未保存输入）。受控 props `{ open, jobId, kind: "criteria" | "workbook", onClose }`；预览数据与请求句柄为组件本地状态，不写全局 state。打开时经 `api()` 请求 `GET /api/jobs/{id}/preview/{kind}` 并用 AbortController 中止上一次未完成请求，卸载/关闭时中止当前请求；markdown 安全渲染仅 h1-h3/ul/p（文本节点输出防 HTML 注入），空内容显示 emptyPreview；workbook sheet tabs 支持点击与左右/Home/End 键盘切换、空表显示 emptyWorksheet；`truncated` 显示截断提示；下载走 `GET /api/jobs/{id}/criteria` 与 `/download`（Blob + `content-disposition` 文件名，zh 优先服务端文件名）。交互与渲染由 `frontend/tests/unit/preview-dialog.test.tsx` 锁定（jsdom，不截图）。
  - `SettingsDialog.tsx`：设置弹窗（编辑类：仅关闭按钮 + ESC 退出，点遮罩不关闭）。受控 props `{ open, onClose }`；每次打开从全局 `state.settings` 回填非密钥字段（默认值：base_url `https://api.openai.com/v1`、max_parallel 6、request_timeout 180），密钥输入框（api_key / asr_api_key / feishu_sign_secret）恒为空、不回填明文密钥。密钥保留/清除语义：三个密钥输入框留空提交空串表示保留已存值（服务端仅覆盖非空字段）；「清除 ASR」「清除飞书签名」置 `clear_asr` / `clear_feishu_sign=true` 并提交表单（`requestSubmit` 走原生表单校验，对应密钥字段同时提交空串），`clear_*` 为一次性瞬态标志、提交后复位。保存 `PUT /api/settings`（成功后写回 `state.settings`）、测试模型连接 `POST /api/settings/test`（zh 优先展示服务端 `result.message`，en 固定通用文案）、测试飞书 `POST /api/settings/feishu-test`，请求负载键名与端点稳定；保存/两个测试按钮独立 busy（is-busy + 文案切换）；OCR 状态按 `state.settings.ocr` 渲染 ready/error 文案；结果提示区 `.dialog-message`（error 追加 `.error`）；订阅 `src/i18n` 的 `onChange`，语言切换重渲染并清空结果提示。交互与渲染由 `frontend/tests/unit/settings-dialog.test.tsx` 锁定（jsdom，不截图）。
  - `CompareDialog.tsx`：AI 横向对比弹窗（查看类：关闭按钮 + ESC + 点遮罩关闭，对比进行中关闭 = 触发取消）。受控 props `{ open, jobId, candidates, onClose }`，`candidates` 为结果页数据行（`source_file` / `candidate_name` / `conclusion`）。候选人勾选在结果页完成（仅 A/B 结论可参与、C 类复选框禁用并带 compareExcludeC 提示，≥2 人启用发起按钮、不足时带 compareButtonTitle 提示，勾选集合走全局 `state.compareSelection`）；**弹窗打开即用传入 `candidates` 的 `source_file` 自动发起对比**（"点击即运行"，无弹窗内二次勾选），候选人不足 2 人时不发起并显示空态兜底。发起 `POST /api/jobs/{id}/compare?cancel_key=<crypto.randomUUID()>`，body `{files: [...candidates]}`（服务端再排序去重）；`cancel_key` 由组件生成并以 `cancelKeyRef` 持有，完成/失败/取消后置空。取消走 `POST /api/jobs/{id}/compare/cancel`（body `{cancel_key}`），请求失败可忽略，成功后关闭 + 「已取消对比」toast；用户取消后对比请求晚到的结果与 499 被静默丢弃。后端取消对比返回 499 时前端展示 compareFail 文案；400（少于 2 人 / C 类参与 / 文件不在结果 / 模型未配置）/404（评估结果未生成）/500 错误经 `api()` detail 透传后同样以 compareFail 展示。缓存命中时后端直接返回 `{ranking}`，前端直出结果；结果渲染 ranking 列表（序号补零、候选人名、结论徽章按 A/B/C 着色、理由），meta 显示 compareMetaCount。订阅 `src/i18n` 的 `onChange`，语言切换重渲染徽章与文案。Toast（取消/失败提示）经 `createPortal` 渲染到 body，避免随遮罩淡出动画截断。交互与渲染由 `frontend/tests/unit/compare-dialog.test.tsx` 锁定（jsdom，不截图）。
  - `HistoryDrawer.tsx`：历史任务抽屉（查看类：关闭按钮 + ESC + 点遮罩关闭）。受控 props `{ open, initialKind, onClose, onOpenJob, onOpenCall }`；点击行触发 `onOpenJob(jobId)` / `onOpenCall(callId)` props 回调通知外层打开对应视图，组件不依赖 screening/phone 模块；删除当前任务后的工作区重置同样交由外层视图容器处理，组件只负责请求、刷新列表与 toast。active 行按全局 `state.currentJob` / `state.currentCall` 的 id 判断。顶部 kind 切换（job | call，label 复用 taskHistory / phoneRecord），各自独立 recent/archived tab 与计数；分页 `limit=50` + `offset` 追加「加载更多」（`items.length < total` 时显示）。数据经 `api()` 走 `GET /api/jobs?scope=&limit=&offset=` → `{jobs, total}`、`GET /api/calls?scope=...` → `{calls, total}`；存储占用 `GET /api/storage`（`job_count` / `jobs_bytes`，仅 job 列表展示，格式化 `formatStorageSize`）。行操作：归档/恢复 `POST /api/{jobs|calls}/{id}/archive|restore`，永久删除 `DELETE /api/{jobs|calls}/{id}`（确认框，删除中按钮禁用 + deleting 文案 + toast；queued/running 任务禁用归档与删除；ESC 先关确认框）。空状态区分 recent/archived 与 job/call 文案，加载中显示读取文案，请求错误经 toast 展示；订阅 `src/i18n` 的 `onChange`，语言切换重渲染（标题 / tab / 日期格式 / 文案）。交互与渲染由 `frontend/tests/unit/history-drawer.test.tsx` 锁定（jsdom，不截图）。
  - `src/App.tsx`：应用根组件（应用外壳 / 顶栏 / 启动流程 / 视图容器），class 名对齐 `frontend/public/styles.css` 的 shell 体系（`app-shell` / `topbar` / `brand-group` / `tool-strip` / `language-switch` / `connection-state` / `topbar-actions`），900/660/420px 断点行为由样式表直接接管（顶栏两列、隐藏 wordmark / view-context / 连接状态文案等）。顶栏构成：品牌区（wordmark + 历史按钮打开 `HistoryDrawer` + 新建按钮展开 `toolStrip` 工具切换 screening|phone，点击外部或 ESC 关闭，document 级监听）；语言切换（zh-CN/EN，写 `src/i18n` 的 `state.language` + 持久化，并同步 `document.title` 与 `html lang`，切换经 `onChange` 广播重渲染；页面级过渡：支持 View Transition 时 `document.startViewTransition(() => flushSync(() => setLanguage(lang)))` 整页交叉淡化——React 异步渲染需 `flushSync` 在过渡回调内同步提交，否则新快照读到旧文案；`prefers-reduced-motion` 或浏览器无该 API 时直接切换，不支持 View Transition 时直接切换）；连接状态（`configDot` / `configStatus`，按 bootstrap `settings.is_ready` + `settings.model` 渲染 `modelConnected` / `modelPending` / `configLoading` 三态）；设置按钮（打开 `SettingsDialog`）；退出按钮（`window.confirm(t("exitConfirm"))` → `POST /api/shutdown` → 渲染 `.shutdown-message` 退出页，失败经 toast 提示）。启动流程 `bootstrap()`：`GET /api/bootstrap` → 写 `state.settings` / `state.jobs` / `state.historyTotals.recent` → 按 `localStorage.talentHub.activeTool` 分流（phone → 电话视图；screening 且有 `talentHub.lastJob` → `GET /api/jobs/{id}` 按任务状态路由 results（completed 或含结果的 failed）/ criteriaReview（waiting）/ progress（其余），失败清 lastJob 回落 setup；无 lastJob → 写 activeTool=screening 并进入 setup）→ `!settings.is_ready` 自动打开设置弹窗 → 隐藏 startup-loading。**视图切换 `navigate(name)` 对筛选子视图统一 `routerShow("screening")`**（setup / progress / criteriaReview / results 归一到 "screening" 路由视图，phone 独立），随后 `showSection` 显隐对应 section 并同步 `document.body.dataset.view`（criteriaReview 对应 review）；离开筛选视图（切到 phone）时经 router 触发 "screening" 视图 exit 清理筛选轮询定时器；`viewTitle` 在电话视图隐藏，筛选视图按任务标题显示（`displayJobTitle`）。筛选四视图（setup / progress / criteriaReview / results）由 `ScreeningView` 渲染；`resultActions`（下载筛选标准 / 评估表格）与追加 FAB 仍由 shell 渲染，其显隐由 ScreeningView 在每次渲染后同步（results 视图 + completed 任务显示，追加 FAB 额外要求未归档），点击事件亦由 ScreeningView 接线（下载打开 `PreviewDialog`、追加 FAB 触发隐藏文件输入）。`frontend/src/main.tsx` 为 Vite 构建入口（`createRoot` 挂载 `#root`，渲染 `<App/>`）。渲染与交互由 `frontend/tests/unit/app-shell.test.tsx` 锁定（12 例，jsdom，不截图；视觉回归由 `frontend/tests/visual/baseline.spec.ts` 覆盖）。
  - `src/views/ScreeningView.tsx`：简历筛选任务流视图，由 App 以 props `{ view, onNavigate, onToast, onRequireSettings, resetSignal }` 驱动（`view` 为当前 section 名，`onNavigate` 复用 App.navigate，`resetSignal` 递增时重置工作区 state 清理）。**setup**：JD textarea（`#jdText`）+ 简历拖拽区（accept 为 `.pdf,.docx,.txt,.md,.markdown,.png,.jpg,.jpeg,.webp,.tif,.tiff,.bmp`，dragenter/dragover/drop 带 `.dragging` 态）+ 文件输入选择，去重键 `${name}:${size}:${lastModified}`（写全局 `state.selectedResumes`）；「候选人简历」摘要按钮（`#openResumeWorkspaceButton`）为查看/增添/移除简历的唯一入口，点击打开 `ResumeWorkspace` 本地模式，不渲染内联已选列表；开始按钮按 `hasJd && count>0` 启停。**任务创建**：`POST /api/jobs`（body `{title:"岗位候选人筛选"}`）→ `PUT /api/jobs/{id}/jd`（body `{text}`）→ 逐份 `PUT /api/jobs/{id}/resumes?filename=`（body 为 File，`upload.accepted===false` 计重复）→ `POST /api/jobs/{id}/start` → 进入 progress 并轮询；上传期间 progress 阶段文案为「保存岗位说明 / 上传简历 {current}/{total}」（progress 的瞬态 stage），完成后重复数经 `duplicateResumesSkipped` toast 提示。**progress**：1200ms 轮询 `GET /api/jobs/{id}`，定时器存全局 `state.pollTimer`，组件挂载时 `registerView("screening", { exit: 清 pollTimer })`（视图切换离开筛选视图即停轮询，router 保证互斥）；回调先校验任务 id 未变（排期时捕获）再发请求，响应后校验 `currentView() === "screening"` 且 id 未变（防跨任务/跨视图串扰），网络错误不停止轮询（toast 后重排）；按状态分流：completed → results + `completedToast`，failed/cancelled → 有结果的 failed 进 results、否则 progress + 对应 toast，waiting → criteriaReview，其余 → progress 并续排。视图内展示阶段文案（`stageLabel`）/百分比（带 bump 动画）/`Progress` 进度条/`resumeProgress` 计数/速率（`jobElapsed`+`speed`/`elapsed`）/实时结果（`liveResults` 最多 8 条倒序，结论徽章按 A/B/C 着色）/错误列表；取消 `POST /api/jobs/{id}/cancel`（按钮禁用 + 「正在停止任务」文案）后继续轮询至终态；重试 `POST /api/jobs/{id}/start`（清空对比勾选）。**criteriaReview**：进入时 `GET /api/jobs/{id}/criteria-json` 拉取标准渲染编辑器（essence textarea + 8 个列表字段 + 5 个规则字段，行内可增删，规则行含 rule/verification 输入），失败 toast 后回退到任务状态视图；「保存并开始/重新筛选」`PUT /api/jobs/{id}/criteria-json`（收集编辑后标准，空行过滤、规则保留 `id`）→ `POST start` → progress 并轮询；返回按钮按任务状态回退（completed → results，其余 → progress）；编辑标准入口（results 工具栏）带 `confirmAndRestart` 文案。**results**：汇总统计（候选人总数 + A/B/C 计数，结论精确匹配 `A优先约面`/`B电话确认`/`C不推进`）、A/B/C 分段过滤（`state.resultFilter`）、8 列表格（对比勾选 / 顺序 / 候选人 / 简历预览入口（眼睛按钮，点击打开 `ResumeWorkspace` stored 模式）/ 结论徽章 / 一句话判定 / 关键风险 / 下一步，数组值按语言分隔符连接、空值 `missingValue`）、错误列表；工具栏按钮显隐规则（completed 才显示通知重试/编辑标准/对比/下载，归档任务隐藏追加与结果动作）；对比勾选走全局 `state.compareSelection`，C 类禁用，≥2 人启用 `CompareDialog`；重试 / 飞书通知重试（`POST /api/jobs/{id}/retry-notification`，`{job, errors, sent}`）；下载筛选标准 / 评估表格经 `PreviewDialog`（workbook / criteria 预览 + Blob 下载）。**追加简历**：仅 completed 且未归档任务（FAB 显隐由 results 视图控制），逐份上传后按 `upload.accepted` 区分：重复且 `duplicate_of` 未在已评估结果中计 pendingDuplicateCount；全部重复且无 pending → 回读任务 + `noNewResumes` 提示并回 results；否则 `POST start` 重新筛选；归档任务直接忽略。`resultActions` / 追加 FAB 为 shell 渲染的非受控元素，其显隐在每次渲染后同步（读取 `document.getElementById`，不参与 React reconcile，与 router 的 DOM 显隐管理一致）。交互与渲染由 `frontend/tests/unit/screening-view.test.tsx` 锁定（10 例，jsdom，不截图：setup 去重、候选人简历卡片打开本地工作台并渲染 PDF、创建任务上传含 duplicate_of、progress 轮询与取消至终态、criteriaReview 表单、results 汇总过滤与对比、简历列眼睛按钮打开已存预览、归档禁用追加、追加简历 noNewResumes / 重新 start、下载触发 Blob）。
  - `src/views/ResumeWorkspace.tsx`：简历工作台弹窗（编辑类：仅「关闭按钮 + ESC」退出，点遮罩不关闭）。受控 props `{ open, stored?, onClose, onFilesChanged? }`；本地模式文件列表读全局 `state.selectedResumes`（弹窗内新增按 `name:size:lastModified` 去重追加、移除与预览索引调整，增删后经 `onFilesChanged` 通知外层同步），stored 模式由 `{ jobId, filename, candidateName }` 进入（results 视图入口），单文件预览并隐藏导航与添加按钮。预览接口：本地 PDF `POST /api/resumes/preview?scale=`（multipart 字段 `file`，页面按 `name:size:lastModified` 缓存到 `state.resumeRenderCache`，命中不重复请求），已存 PDF `GET /api/jobs/{id}/resumes/{filename}/preview?scale=`（不缓存）；图片预览本地 `URL.createObjectURL(file)`、已存 `GET /api/jobs/{id}/resumes/{filename}`（Blob → `createObjectURL`），切换/关闭时 `revokeObjectURL`。前端渲染与预取可并行发起请求，后端以进程内互斥锁串行执行 PDFium 调用；前端的渲染与预取各持 AbortController（切换/关闭中止旧请求；预取跳过当前文件与已缓存项，逐份写入缓存）。非 PDF/非图片本地文件显示 `previewUnavailable`；后端 415/413/422/503 等异常显示 `previewFailed`，并通过 `api()` 透传具体 `detail`。上一个/下一个导航（位置计数 + 端点禁用态）、移除、ESC/按钮关闭、订阅 `src/i18n` 的 `onChange` 语言切换重渲染。前端交互与渲染由 `frontend/tests/unit/resume-workspace.test.tsx` 锁定（13 例，jsdom，不截图：本地 PDF multipart 与页面 img、缓存命中不重复请求、切换中止旧请求、已存 PDF 不缓存、本地/已存图片 Blob 与 revoke、错误态（非 PDF 拦截/415/503）、导航、移除、禁遮罩关闭、添加去重）；后端并发边界由 `tests/test_resume_preview.py` 锁定。
  - `src/views/PhoneView.tsx`：电话确认任务流视图，由 App 以 props `{ view, callOpenRequest, onToast, onRequireSettings, onHistoryChanged, resetSignal }` 驱动（`view === "phone"` 时激活；`callOpenRequest={id, seq}` 为历史抽屉打开任务的请求，seq 递增保证重复打开同一条目也触发加载；`resetSignal` 递增时重置工作区；`onHistoryChanged` 在任务状态变化后通知外层，历史抽屉每次打开时重新拉取列表，故无需缓存失效动作）。**进入电话视图**：按 `callOpenRequest.id` 或 `localStorage.talentHub.lastCall` 经 `GET /api/calls/{id}` 恢复任务（queued/running 自动续轮询），无 lastCall 时展示新建表单；工具切换重置由 `resetSignal` 效果完成。**新建表单**：标题 / 岗位名 / 关联岗位下拉（`GET /api/jobs?scope=recent&limit=100`，复用 `createCustomSelect`，草稿关联岗位不在最近 100 条时补拉 `GET /api/jobs/{id}`）+ 岗位联动导入（`GET /api/jobs/{id}/criteria-json` 的 `bonus_signals` 关键词匹配预设维度，seq 防乱序覆盖，完全替换语义，失败按「筛选标准尚未生成」/「导入失败」toast）+ 软性维度勾选（`soft_skill_dimensions`）+ 录音选择（拖拽/点击，accept `.m4a,.wav,.mp3,.ogg,.opus`，`name:size:lastModified` 去重，后缀/100MB 校验经 `callInvalidAudio` toast）。**任务创建**：`POST /api/calls`（body `{title, job_title, job_id, soft_skill_focus, soft_skill_dimensions}`，标题默认日期）→ 逐份 `PUT /api/calls/{id}/audio?filename=`（body 为 File，`upload.accepted===false` 计重复）→ 全部重复则 `noNewAudio` 提示、不触发整理且表单保留草稿关联信息（软性维度/关联岗位回填）→ 否则 `POST /api/calls/{id}/process` → 详情视图并轮询；重复计数经 `duplicateAudioSkipped` toast。**追加录音**：仅 call done 且未归档（shell 渲染的 `appendCallAudioButton` FAB 显隐每次渲染后同步），追加后自动 `POST process`；全部重复 → `noNewAudio`；追加中忽略重复触发。**详情视图**：标题 / meta（岗位名 · 候选人计数 · stageLabel · 更新时间）/ 错误列表 / 条目卡片（音频名或候选人名 / 状态徽章 `call-badge` / 非 done 条目显示进度条与错误，`transcribing|summarizing` 加活动态；done 卡片头部点击打开条目详情浮层，浮层与音频播放由 `src/views/CallItemDetail.tsx` 承载）。操作按钮显隐：取消按钮仅 queued/running（`POST /api/calls/{id}/cancel`，中间态回滚由服务端收敛），重试按钮仅 failed/cancelled 且未归档（`POST /api/calls/{id}/process`）。**轮询**：2500ms `GET /api/calls/{id}`，定时器存全局 `state.callPollTimer`，组件挂载时 `registerView("phone", { exit: 清 callPollTimer })`（视图切换离开即停轮询，router 保证互斥）；回调先校验任务 id 未变（排期时捕获）再发请求，响应后校验 `currentView() === "phone"` 且 id 未变（防跨任务/跨视图串扰），网络错误不停止轮询（toast 后重排）；queued/running 续排，打开/process/追加/重试后经 `[state.currentCall]` 效果统一启动轮询。**详情浮层接线**：done 卡片点击置 `detailItemId` 渲染 `CallItemDetail`（props `{call, itemId, onSelectItem, onClose, onToast, onSaved}`，上/下一个切换同组件内完成）；切换任务（`selectCall`）与工具重置（`resetSignal`）时调用 `releaseAudioBlobs()` 释放音频 Blob 并关闭浮层；轮询更新后条目消失时经效果兜底关闭浮层。**状态机**：draft（新建表单）/ queued / running / done / failed / cancelled。交互与渲染由 `frontend/tests/unit/phone-view.test.tsx` 锁定（8 例，jsdom，不截图：新建表单渲染与提交含岗位联动导入与 body 断言、录音上传直传 File、全部重复 noNewAudio 与草稿回填、轮询渲染条目状态/进度与取消至终态、追加录音 process 与 FAB 显隐、追加全部重复、归档任务忽略追加、failed 重试、上传失败 toast）。
  - `src/views/CallItemDetail.tsx`：电话条目详情浮层。受控 props `{ call, itemId, onSelectItem, onClose, onToast, onSaved }`（`onSelectItem` 供上/下一个按已完成条目顺序切换，`onSaved` 在保存回读后通知外层刷新历史并同步界面）；遮罩通过 React Portal 直接挂到 `document.body`，不受 `.phone-view` 淡入动画层叠上下文限制。**弹窗类别**：编辑类，仅「关闭按钮 + ESC」退出，点遮罩不关闭（防止误触打断录音/丢未保存输入）；尺寸由 `.call-item-detail` 独立控制（最大 1400×900px，桌面端打开后高度不随折叠面板开合变化，660px 及以下铺满视口），不改变其他 `.preview-dialog`；1080px 及以上将候选人/播放器/narrative 与折叠结果面板分为左右两栏，左栏在详情内容滚动时吸顶，窄屏保持单栏；narrative 禁止拖拽调整尺寸，桌面端固定高度 500px、660px 及以下固定为 240px；详情内容区为纵向滚动容器并始终预留滚动条槽位，折叠面板开合不会改变内容宽度。**详情内容**：候选人名输入框 / `<audio class="call-audio">` 播放器 / narrative textarea / 可折叠面板（`<details class="call-panel">`：fields 字段速览（label + value 多行表单，自动换行并随内容增高，不显示字段内部滚动条）、facts 事实清单（content/speaker/ref/start_time，无时间点置禁用态）、doubts 疑点清单、transcript 转写原文 `pre`、guard_warnings 证据校验提示）；标题 meta 为 stageLabel + 状态文案。**音频**：`GET /api/calls/{id}/items/{item_id}/audio`（Blob → `createObjectURL`），模块级 `Map` 缓存 `audioBlobUrls`（key `callId:itemId`）复用 + `audioBlobPending` 合并并发下载（重复打开同一条目共用同一请求）；缓存跨浮层开关复用，仅切换任务/重置时经 `releaseAudioBlobs()` 整体 revoke（PhoneView 切换任务/重置时调用）；加载失败隐藏播放器并 toast `callAudioLoadFail`（已隐藏不重复提示）；媒体元素仅在 `0s` 发生解码错误时将同一 Blob URL 改为 `#t=0.064` 并重新加载一次，跳过不完整的 AAC 首包且避免循环重试。**播放恢复**：对同一 `itemKey` 复用 `<audio>` DOM 节点，轮询重绘不销毁元素，播放位置与播放状态天然保持；元素被重建（条目状态往返重挂载）时经 ref 回调在卸载瞬间捕获快照（currentTime/paused/ended + capturedAt）并暂停（防双音），加载完成后按快照补偿「捕获→恢复」已播时长（L1）后 seek+play，恢复前一次性监听 play/pause/seeked，用户已操作播放器则不覆盖（M2）；条目切换不跨条目恢复。**编辑保存**：`PUT /api/calls/{id}/items/{item_id}`，body `{narrative, candidate_name, fields:[{key,label,value,status,fact_ids,note}]}`（完整覆盖语义、字段值可清空，status 缺省回退「已确认」），成功后回读 `GET /api/calls/{id}` 写回 `state.currentCall` 并经 `onSaved` 通知外层；**facts 跳转**：点击事实行 → `currentTime = start_time` 并播放（音频未就绪时先加载，readyState/loadedmetadata 后执行）；**Markdown 下载**：`GET .../items/{item_id}/download`（Blob，文件名解析 `filename*` → `filename` → 回退 `{itemId}.md`）。**非 done 条目**：转写中/整理中/failed 在详情内展示进度（`transcribing|summarizing` 加活动条纹）与错误文案，不加载音频（本实现保留浮层展示状态）。语言切换经 `src/i18n` `onChange` 重渲染。交互与渲染由 `frontend/tests/unit/call-item-detail.test.tsx` 锁定（15 例，jsdom，不截图：详情渲染、音频 Blob 加载/缓存复用/并发合并/releaseAudioBlobs revoke/失败隐藏与 toast/异常首包单次恢复、轮询重绘播放保持与状态往返快照恢复、保存 PUT body 与回读、facts 跳转、Markdown 下载文件名解析与回退、上/下一个、Portal 挂载与禁遮罩关闭、非 done 进度/错误、语言切换）。

### 2.2 前端 UI 行为约定

以下为本项目稳定落地的 UI 行为约定，改动时应保持一致，避免风格分裂：

- **模态框动画收敛**：居中弹窗（settings/resume/preview/compare/callItemDetail/confirm）的动画声明统一走「公共动效组」分组规则（淡入 + 上移 + 微缩放），各 dialog 类只保留尺寸/边框/圆角差异；`callItemDetail` 复用 `preview-dialog` 样式但属于编辑类；`history-dialog` 抽屉（X 轴滑入）与 `confirm-dialog` 更暗遮罩（.44）是刻意差异，保留独立覆盖。弹窗统一经 preview-backdrop 遮罩开合（useDialogAnimation 双 rAF 加 .is-visible）；删除确认框的遮罩嵌套在抽屉遮罩内部，其 .44 背景覆盖必须用 :has(> .confirm-dialog) 直接子代选择器限定——若用后代选择器会同时命中祖先抽屉遮罩，两层都变 .44、叠加过深。
- **遮罩点击关闭按误触成本分级**：编辑类（settings / resume / callItemDetail）只支持「关闭按钮 + ESC」退出（误触会丢未保存输入或打断录音播放）；查看类（preview / compare / history）保留点遮罩关闭；confirm 删除框本就不支持。新增编辑类 dialog 时应默认禁遮罩关闭。
- **下拉统一走 `createCustomSelect()`**（`frontend/src/ui/customSelect.ts`）：原生 `<select>` 弹层无法做 CSS 过渡动画，全站下拉统一改用该组件——隐藏原生 select 做值载体（`value` 读写与 `change` 监听零改动），JS 从 `select.options` 渲染菜单，带展开/收起过渡、键盘导航（方向键/Enter/Space/Tab/ESC）、方向自适应（内部 `measureSelectFlip` 按最近滚动容器判断向上/向下弹出，菜单限高 300px 内部滚动）、语言切换自动重建。新增下拉一律复用组件，禁止手写第二份逻辑。
- **页面滚动条 gutter 恒定**：`html` 使用 `scrollbar-gutter: stable`（`@supports` 包裹 + `overflow-y: scroll` 兜底），结果页 ↔ 新建页切换不因滚动条出现/消失产生内容区宽度突变。
- **动态内部滚动区 gutter 恒定**：横向对比、设置弹窗、历史任务列表、自定义下拉菜单、简历库、PDF 简历页、下载预览正文与工作表预览统一使用 `scrollbar-gutter: stable`；加载完成、标签切换、文件增删或内容长度变化不会因纵向滚动条出现/消失改变内部可用宽度。电话条目详情内容区遵循同一约束。
- **视图切换过渡**：5 个 section 与结果页配套元素（`#resultActions`、`#appendResumesButton`、`#appendCallAudioButton`）统一 `view-in` 纯淡入动画（出现侧，`prefers-reduced-motion` 豁免）；消失侧为瞬间隐藏（纯 CSS 边界，如需交叉淡化需 View Transition API）。

## 3. 运行时总拓扑

```text
浏览器 frontend/dist/*（FastAPI 托管，GET / 注入 token）
  │
  │ X-App-Token + JSON/二进制
  ▼
FastAPI app/main.py
  ├─ SettingsStore ─────────────── app/config.py ── Windows DPAPI / macOS env fallback / settings.json
  ├─ JobRepository ─────────────── app/repository.py ── jobs/<job_id>/
  ├─ EvaluationEngine ──────────── app/pipeline.py
  │    ├─ extract_resume_text.py
  │    ├─ OpenAICompatibleClient ─ app/llm.py ── 外部模型 API
  │    ├─ build_candidate_workbook.py
  │    ├─ validate_workbook.py
  │    └─ push_with_status ─────── app/feishu.py ── 飞书 Webhook（筛选总览）
  ├─ CallRepository ────────────── app/call_repository.py ── calls/<call_id>/
  ├─ CallProcessor ─────────────── phone_screening.py
  │    ├─ speech_to_text.py ── 火山 ASR API
  │    ├─ OpenAICompatibleClient ── 外部模型 API
  │    └─ push_with_status ─────── app/feishu.py ── 飞书 Webhook（逐条电话记录）
  └─ artifact_preview.py ───────── Markdown / XLSX 限量预览
```

这里没有数据库。`job.json`、`record.json`、结果 JSON 和文件目录共同构成持久化状态，因此修改字段时不能只看 Pydantic 模型或 API；还要考虑旧 JSON 的加载、恢复逻辑和前端消费。

## 4. 启动与本地会话数据流

```text
Windows 一键启动：双击 start-app.bat 并行启动后端与前端监听（vite build --watch，源码改动自动重建 dist）

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
  → 前端 main.tsx 挂载 React App → bootstrap()
  → GET /api/bootstrap，携带 X-App-Token
```

交叉影响：

- 修改 `main()` 参数会影响 `launcher.py`、`verify_windows_release.ps1` 和 PyInstaller 启动方式。
- 修改 `/health` 字段会影响重复实例探测及发布烟测。
- 修改首页 token 占位符、meta 名称或请求头名称，必须同步修改 `frontend/index.html`、前端 `api/client.ts`、中间件和 API 验证。
- 修改监听地址不能只改 Uvicorn；产品安全边界明确要求仅监听 `127.0.0.1`。

## 5. 配置与密钥数据流

```text
设置对话框 frontend/src/ui/SettingsDialog.tsx
  → PUT /api/settings
  → main.py merged_settings() 将请求合并到 AppSettings
     ├─ 明文密钥/清除标记不回传：exclude api_key/asr_api_key/asr_enabled/clear_asr/feishu_sign_secret/clear_feishu_sign
     ├─ api_key、asr_api_key：留空回退已存值，clear_* 置空
     └─ feishu_sign_secret：留空回退已存值，clear_feishu_sign 置空
  → SettingsStore.save()
     ├─ 数值归一化
     ├─ Windows：API Key / ASR Key / 飞书签名密钥使用 DPAPI 加密
     ├─ macOS：敏感密钥不写入 settings.json，通过环境变量提供
     └─ 临时文件 + os.replace 写 settings.json
  → public_settings()
  → 前端只得到 is_ready / asr_configured / feishu_push_enabled / feishu_webhook_url / feishu_sign_configured 等公开状态
```

模型调用时：

```text
EvaluationEngine / CallProcessor / settings test / feishu-test / compare
  → SettingsStore.load()
  → Windows：DPAPI 解密，未保存模型 Key 时回退 TALENT_HUB_API_KEY
  → macOS：读取 TALENT_HUB_API_KEY / TALENT_HUB_ASR_API_KEY / TALENT_HUB_FEISHU_SIGN_SECRET
  → OpenAICompatibleClient(base_url, effective_api_key, model, timeout)
```

飞书推送时（`push_with_status`）：

```text
pipeline._run / phone_screening._run（置业务终态前）或独立通知重试 API
  → 按通知状态筛出未成功、且不属于历史基线的结果
  → push_with_status(settings_store, build_fn, *args)
  → SettingsStore.load() 读最新配置（推送偏好即时生效，不沿用任务快照）
  → 开关关闭或 webhook 为空 → 返回 (False, None)，不发起请求
  → 构建 post 消息 → 统一隐藏手机号/座机/邮箱 → 检查大小 → send_message()
  → 连接/超时、HTTP 429/5xx 最多 3 次总尝试；电话逐条发送与重试共用 5 次/秒、100 次/分钟频控
  → 仅飞书业务码 code=0 返回成功；成功后立即原子推进对应通知状态
  → 独立重试响应 sent 仅表示本次至少一条真实发送成功；无待发结果或配置关闭时为 false
  → 任何异常转为脱敏错误，绝不改变业务终态
```

关键约束：

- API 响应不得返回明文密钥（含飞书签名密钥，仅暴露 `feishu_sign_configured` 布尔）。
- 前端设置框不会回填已保存密钥；空输入表示保留旧值。
- ASR 与飞书签名密钥都有显式清除语义（`clear_asr` / `clear_feishu_sign`），不能与"留空保留"混淆。
- 推送挂点位于任务置终态（completed/done）**之前**：前端轮询看到终态即停止，推送失败提示必须并入同一次终态 update 才会被用户看到。
- 电话条目以 `feishu_push_status` / `feishu_pushed_at` 记录逐条成功；简历任务以 `feishu_criteria_fingerprint`、`feishu_notified_resume_hashes`、`feishu_notified_at` 和 `feishu_rescreen_pending` 记录标准版本与已通知内容指纹。
- 升级前终态任务首次读取时建立独立历史基线：电话使用 `feishu_baseline_item_ids`，简历使用 `feishu_baseline_resume_hashes`；电话终态包括 `done`、`failed`、`cancelled`。基线只防止旧结果在追加任务时被重推，不代表历史上已发送成功，也不写入成功时间；该过程幂等且不发送消息，迁移写回保留原 `updated_at`，不改变历史排序。
- 同一任务的自动通知与手动重试共用任务级互斥锁；后进入者须在前一次完成并推进通知状态后重新读取，避免并发重复发送。
- `schema_version` 迁移影响旧用户升级。
- 修改配置字段必须同步检查 `AppSettings`、设置请求模型、`PUT /api/settings`、`POST /api/settings/test`、`POST /api/settings/feishu-test`、`public_settings()`、前端表单、`settingsPayload()`、迁移验证。

## 6. 简历筛选端到端数据流

### 6.1 创建与上传

```text
frontend/src/views/ScreeningView.tsx 创建任务
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
  → frontend/src/views/ScreeningView.tsx criteriaReview 视图
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
     → chat_json(attempts=2)：单次候选人请求按配置超时，传输错误最多尝试 2 次
     → CandidateEvaluation.model_validate()
     → apply_evidence_guard(resume_text, evaluation)
     → apply_hard_gate_guard(criteria, resume_text, evaluation)
     → 单次模型调用完成评估，不再二次复核
```

文档解析的交叉路径：

```text
pipeline.extract_document()
  ├─ PDF → pypdfium2 页数上限检查（MAX_PDF_PAGES=100）→ extract_file(pypdf → pdfplumber) → 不足时 Tesseract OCR
  ├─ DOCX → ZIP 中 word/document.xml（XML 内容上限 20 MB）
  ├─ TXT/MD → 多编码读取
  └─ 图片 → Tesseract OCR
```

### 6.5 证据守卫与分级

模型输出的 `CandidateEvaluation` 不是最终结果。`apply_evidence_guard()` 检查每个证据维度的“事实锚点”：`quote` 通过原文规范化连续子串比对，或 `summary` 含可命中原文的具体片段（≥4 字符连续片段 / 4 位以上数字 / 与原文共享含汉字二元组，允许基于完整经历的合理推断）。维度判定的转述容忍下限为 6 个二元组（拦截仅凭简历通用词转述、无具体名词的判定），硬性门槛注记保留 4 个二元组的宽松档（其推断以教育时间线等常规路径为主）。

```text
模型状态“匹配/不匹配”
  ├─ quote 有效 → 保留（计入支持证据）
  ├─ quote 无效但 summary 有事实锚点 → 清空引文、保留判定（推断，计入支持证据）
  └─ quote 与 summary 均无事实锚点 → 待确认（完全编造或泛化空话被拦截）
```

随后执行规则改判：

- A 缺核心证据、核心维度无支撑或总证据不足 → B。
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

- `hard_gate` 与候选人评估在同一次模型调用中输出：按 `ScreeningCriteria.hard_requirements` 逐条给出 `met / unmet / unknown`，`met` 与 `unmet` 必须有原文事实支撑：`quote` 通过原文校验，或 `note` 含事实锚点（允许基于教育时间线、连续工作经历等做高概率推断，如“学制连续完整的本科可推断全日制”）。
- 守卫校验：`met/unmet` 引文与 note 均无事实锚点 → 降为 `unknown`；criteria 中的硬性门槛未被模型判定 → 按 `unknown` 补齐并告警（防止模型漏判导致硬门槛失守）。
- 程序强制（先过滤语义，不再依赖模型自觉）：
  - 任一有效 `unmet` → 强制 `C`（覆盖模型结论）、清空电话问题；
  - 存在 `unknown` → A 不得成立（降为 B）；仅 B 类为未知门槛生成高优先级电话问题（合并为至多 2 个：第一条单独、其余合并），C 类不生成核实问题（C 不进入电话确认流程）。
- 修改硬性门槛结构时必须同步：criteria prompt、评估 prompt、`apply_hard_gate_guard()`、Excel 总表「硬性门槛判定」列、硬性门槛降档验证。

### 6.6 检查点、续跑和最终产物

每完成一份候选人，持久化顺序是：

```text
1. 原子写 评估结果.json
2. 原子写 解析清单.json
3. 更新 job.json 的 results / completed / progress / results_meta
```

这个顺序确保 `job.json` 不会领先于实际结果文件。不要随意交换顺序。Excel 校验通过后的最终 `评估结果.json` 与 `解析清单.json` 也使用同一原子写入函数，避免收尾中断破坏可续跑检查点。

单份解析失败或模型异常只追加到 `job.errors`，不会终止其他候选人；只有没有任何成功评估，或 Excel 构建/阻断校验等批次级步骤失败，任务才进入 `failed`。

全部候选人完成后：

```text
结果排序
  → workbook_payload()
  → build_workbook()
  → 临时 XLSX + os.replace
  → validate_workbook_detailed()
     ├─ 结构错误/安全错误：任务失败
     └─ 非阻断 warning：写入 job.errors
  → stage=推送飞书通知 → 按标准版本和简历内容指纹筛出未通知结果
  → push_with_status() 发送 initial / incremental / rescreen 总览
  → code=0 后合并 feishu_notified_resume_hashes 并记录通知时间
  → job: completed / progress=100（推送错误并入本次 update 的 errors）
```

恢复依据包括：

- 当前 JD 与生成标准时的 JD 一致；
- 已保存简历哈希与当前未冲突；
- `评估结果.json` 可用；
- 结果中的 `source_file` 用于跳过同名已完成简历；当前实现不额外过滤已从任务中移除的旧结果。

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
| `completed` | Excel 和结果已完成 | 结果页、追加简历、预览、下载；单份失败信息仍在结果页展示 |
| `failed` | 阶段失败或上次运行中断 | 有 `results` 时展示已保留候选人和重新开始入口，并隐藏下载、追加、改标准和通知；无结果时显示普通错误页 |
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
  → artifact_preview.py / 下载 API / frontend/src/ui/PreviewDialog.tsx 预览
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

电话链路保持单次模型调用：模型一次生成完整 `CallSummary`；程序事实守卫负责核验 `facts[].ref`，并将缺少有效事实依据的已确认字段降级为含糊。`soft_skill_summary` 是由 Prompt 约束的文本数组，不保存独立引用，也不经过程序化软性引用守卫，由 HR 人工复核；人工编辑是最终校正边界。不存在二次模型复核。`CallRepository` 复用 `repository.py` 的 `JsonStore`，因此电话任务的 JSON 保存、归档、恢复、删除和锁语义与岗位任务共享同一底层仓储规则。

### 9.1 创建和上传

```text
frontend/src/views/PhoneView.tsx 处理任务
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
     5. AI 单次调用完成信息整理（CallSummary）：system prompt 注入软性 8 维度框架（soft-skill-framework.md），user prompt 携带选中的维度与自定义关注项；输出三层整理结构（客观记录章节/分点式软性概述/快筛问答）；快筛问答（qa_records）按设置开关 `call_qa_records` 决定是否要求生成（默认关闭，关闭可大幅减少模型输出、显著提速）
     6. validate_call_structure() 检查动态章节和字段完整性
     7. apply_call_guard() 校验事实引用并降级无依据字段
     8. render_remark_narrative() 渲染统一 narrative
     9. attach_fact_timestamps() 按 fact.ref 在转写文本/原始转写中定位录音时间区间，写入 facts[].start_time/end_time（程序计算，不依赖模型输出 timestamp）
    10. summaries/<item_id>.json 和 .md
    11. record.json 中对应条目写入 summary
    12. summarizing → done
```

录音回放定位：`GET /api/calls/{call_id}/items/{item_id}/audio` 按 token 校验后返回录音文件流（前端 fetch 为 Blob 播放，不新增存储）；事实时间戳由 `attach_fact_timestamps()` 在落盘前计算并持久化到 `facts[].start_time/end_time`，旧任务无时间戳时前端降级为不可点击。

每条录音只发生一次模型调用：

| 阶段 | 模型输入 | 模型输出 | 程序责任 |
| --- | --- | --- | --- |
| 整理 | ASR 转写、可选软性关注项 | 结构化 `CallSummary`（不含 narrative；qa_records 按开关生成） | 校验结构完整性并执行事实守卫，渲染 narrative |

### 9.3 首轮摘要是稳定基线

`CallSummary` 是最终持久化和前端展示的数据结构，包括：

```text
candidate_name, call_date,
remark_sections[]     动态业务章节（title, bullets，条数不设上限、宁多勿漏）
soft_skill_summary[]  分点式软性表现概述
soft_skill_summary_title  概述章节标题（可选）
qa_records[]          快筛详情通篇问答（question, answer；按设置开关生成，默认关闭；关闭时程序侧解析后强制清空，模型自行输出也不保留）
narrative             由上述结构渲染的统一可编辑文本，用于展示和 Markdown 下载
fields[], facts[], extra_info[], doubts[],
guard_warnings[], transcript（转写原文，守卫与时间戳的核对基准）
```

结构化源数据是程序校验的事实来源；`narrative` 由 `render_remark_narrative()` 渲染三层结构：① 客观记录章节 → ② 分点式软性表现概述 → ③ 快筛详情（通篇问答原文，仅开关开启且有内容时渲染）。人工编辑 `narrative` 后不反向解析回结构化字段。

首轮整理必须至少满足：

- `remark_sections` 至少一项，且每项标题与要点非空；
- `fields` 非空；
- 渲染后的 `narrative` 非空。

软性表现概述与快筛详情（`qa_records`）不是必填项：没有可靠原文证据时可以为空，模型不得强行凑项。`soft_skill_summary` 只保存分点数组，不保存问题、回答、引用、置信度或逐条观察明细；概述须客观克制，既可指出积极表现，也可指出证据支持的局限或风险。

首轮若返回空壳，视为结构失败并携带错误重试一次；连续失败则该条目进入 failed，不得以空摘要标记 done。

### 9.4 事实守卫和复核触发

客观事实守卫规则（`apply_call_guard`，核对基准为**输入转写原文**（ASR 渲染文本），宽松归一 `_loose_normalize`：去空白/小写/全半角标点统一/中文数字转阿拉伯）：

- `CallFact.ref` 语义是「**转写原文原句短线索**」——prompt 强制逐字引用输入转写文本的连续原句（**含 ASR 错字原样，不得修正、不得改写、不得概括**）；因此 ref 与核对基准同源，宽松匹配容忍去口语词、标点与数字读法差异，但处理不了错字替换——这是 ref 必须与核对基准同源的根本原因。模型擅自修正错字（如「家挺」→「家庭」）会导致 ref 在原文失配，被守卫判 doubt 并降级为含糊（防编造）。
- “已确认”字段如果没有事实 ID，或引用事实未通过核验，则降为“含糊”。
- 守卫只降级依据不足的状态并记录 `guard_warnings`，不凭空补充事实。

`qa_records`（快筛详情）不参与事实守卫——它是 HR 按需取舍的整理材料而非程序断言，这是刻意设计。

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

`call_state.py` 还定义了任务级 `queued`，并将其纳入运行态集合；当前 `CallProcessor.start()` 直接把任务置为 `running`，没有单独排队阶段。

电话业务处理结束、写入任务终态前，`_push_notifications()` 会按条目稳定顺序筛出 `done`、有 `summary.narrative`、不在历史基线且未成功推送的条目，并逐条调用 `push_with_status()`。每条仅在飞书返回 `code=0` 后原子写入 `feishu_push_status=succeeded` 与 `feishu_pushed_at`；失败条目保持 `pending`，后续条目继续发送。即使部分条目业务失败，已完成条目仍会尝试通知，任务最终业务状态仍由条目处理结果决定。

条目状态：

```text
queued → transcribing → summarizing → done
   │          │              │
   └──────────┴──────────────┴──> failed
failed → queued
transcribing/summarizing --取消或进程中断→ queued
```

`call_state.py` 还定义了条目级 `cancelled` 终态；当前处理器取消收敛时把中间态条目回滚为 `queued`，通常不写入该状态。

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
- 唯一 API client：`frontend/src/api/client.ts`；行为由契约测试 `api-client.test.ts` 锁定。
- 设置相关端点：`PUT /api/settings`（保存）、`POST /api/settings/test`（模型连接测试）、`POST /api/settings/feishu-test`（飞书测试消息，成功 `{"ok": true}`，失败 400 + 含飞书 code/msg 的 detail）。

### 11.2 Job 前端依赖字段

```text
id, title, status, stage, progress, completed, total,
results, errors, elapsed_seconds,
evaluation_started_at, updated_at, archived_at
```

`reviewed` 是后端任务摘要和持久化字段，当前前端不直接依赖；如果未来前端展示复核/查看统计，再纳入前端依赖字段清单。

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
status, stage, progress, created_at, updated_at,
archived_at, errors, items
```

条目：

```text
id, audio_file, candidate_name, stage, status,
progress, error, summary
```

摘要（服务端持久化并由前端读取）：

```text
candidate_name, call_date, narrative,
remark_sections[].{title,bullets}, soft_skill_summary_title,
soft_skill_summary[],
qa_records[].{question,answer},
fields[].{key,label,value,status,fact_ids,note},
facts[].{id,content,speaker,timestamp,ref,start_time,end_time},
extra_info, doubts, guard_warnings, transcript
```

`fields[].key` 是人工编辑的稳定身份；`facts[].id` 是事实引用（字段 `fact_ids`）的稳定身份。修改它们会影响事实守卫、人工编辑和旧摘要兼容。

前端实际直接消费的子集：任务字段中仅 `progress`、`created_at` 不被前端直接读取（电话任务结构不存在 `completed`/`total`，二者是 Job 任务专有字段）；摘要直接渲染 `narrative`、`fields[].{key,label,value}`、`facts[].{content,speaker,ref,start_time}`、`doubts`、`guard_warnings`、`transcript`；`remark_sections`、`soft_skill_summary`、`soft_skill_summary_title`、`qa_records` 由后端 `render_remark_narrative()` 渲染进 `narrative` 后间接消费；`call_date`、`extra_info`、`facts[].timestamp` 及 `fields[].{status,fact_ids,note}`（渲染路径）前端不直接读取，后者仅在编辑保存时透传。

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
- `JsonStore` 与逐份候选人检查点使用原子 JSON 写入，Excel 使用临时文件替换；最终完成阶段仍有少量结果/解析清单普通写入路径，修改时不要扩大非原子写范围。
- 候选人失败隔离：单份失败不能丢失其他结果。
- 任务级取消隔离：取消任务 A 不能中止任务 B 的模型客户端。
- 对比缓存必须包含任务 ID 和结果文件哈希，避免跨任务污染或结果变化后返回旧排序。

涉及线程池、锁、保存顺序、future 或取消事件的修改，必须运行并发、取消、上传竞争、断点恢复和对比缓存相关验证。

## 13. 安全边界及其交叉依赖

| 安全边界 | 实现位置 | 修改时同步检查 |
| --- | --- | --- |
| 仅监听回环地址 | `main.py` Uvicorn 配置 | 启动、烟测、产品约束 |
| API 本地令牌 | `main.py` 中间件、HTML meta、`frontend/src/api/client.ts` | 首页注入、所有 API 验证 |
| 密钥保护 / 环境变量 fallback | `config.py` | 设置 API、迁移、公开设置、模型/ASR/飞书签名密钥、验证 |
| 文件名清洗 | `repository.py` | 上传、下载、预览、结果 `source_file` |
| 路径边界 | 仓储、`artifact_preview.py` | 下载、预览、删除、路径逃逸验证 |
| 上传大小限制 | `main.py`、`speech_to_text.py` | 前端提示、错误码、验证 |
| Prompt 注入防护 | `pipeline.py`、`phone_screening.py` | Prompt、结构验证、证据守卫 |
| 原文证据校验 | `pipeline.py`、`phone_screening.py` | 分级、人工展示、验证 |
| Excel 公式和外链防护 | 构建器、校验器 | 工作簿契约、预览、验证 |
| XSS 防护 | 前端 React 组件默认转义文本渲染 | Markdown、模型输出、表格预览 |

不要为了修复表面失败而绕过令牌、路径校验、证据守卫或工作簿校验。

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
| `CandidateEvaluation` | 评估 prompt、证据守卫（含硬性门槛 `apply_hard_gate_guard`）、排序、持久化结果、Excel（含「硬性门槛判定」列）、前端结果、对比 |
| 证据维度或核心维度 | `models.py`、prompt、guard、evidence strength、Excel 证据表 |
| 硬性门槛 `hard_gate` / `HardGateVerdict` | criteria prompt、评估 prompt、`apply_hard_gate_guard()`、Excel 总表列、硬性门槛验证 |
| 软性素质维度 / `soft_skill_summary` | `soft-skill-framework.md`、整理 prompt、narrative 渲染、前端维度 chips、前端岗位联动关键词映射 `SOFT_SKILL_KEYWORD_MAP`、电话验证 |
| A/B/C 枚举 | 模型、guard、排序、工作簿契约、校验器、前端精确匹配、AI 对比、验证 |
| `source_file` 语义 | 上传命名、续跑、追加简历、结果预览、AI 对比、缓存、前端选择键、验证 |
| 简历解析策略 | `extract_resume_text.py`、`pipeline.extract_document()`、OCR 状态、上传类型、预览支持、解析验证 |
| Excel 表名或表头 | `workbook_contract.py`、payload、构建器、校验器、预览、验证、业务使用方 |
| 结果/产物文件名 | `pipeline.py`、下载/预览路由、续跑、对比缓存、历史老任务兼容 |
| 检查点保存顺序 | 原子写逻辑、恢复逻辑、取消、并发和中断验证 |
| 模型调用或重试策略 | `llm.py`、取消语义、设置 timeout、筛选/电话/对比调用、错误验证 |
| `CallSummary` / `CallField` / `CallFact` / `CallQA` | 整理 prompt、完整性校验、事实守卫、narrative 渲染、持久化 JSON/Markdown、编辑 API、前端展示、旧摘要兼容、回放定位（`start_time`/`end_time` 与音频访问 API）、电话验证 |
| ASR 请求参数或响应结构 | `speech_to_text.py`、电话处理器、设置的 ASR 状态、STT 验证 |
| 首页 DOM ID 或 class | 前端 js/ 模块的节点查询和事件、`styles.css`、首页验证、发布烟测 |
| 前端本地存储键 | 初始化恢复、切换工具、新建任务、历史恢复 |
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
9. 修改 `field.key` 或 `fact.id`：会破坏事实引用和既有摘要兼容。
10. 修改公开配置：可能意外泄露明文密钥或让前端错误判断“已配置”。
11. 修改发布版本或手动清理 release：可能误删可交付 release，或让构建、安装器和 release 目录版本不一致。

## 17. 设计上的单一事实来源

维护时应尽量维持以下“单一事实来源”：

- 配置结构：`AppSettings`。
- 应用版本号：`app/__init__.py` 的 `__version__`（`packaging/version_info.txt` 为构建时派生，`packaging/talent-hub.iss` 通过构建参数接收版本）。
- 简历和电话业务结构：`app/models.py`。
- 电话最终摘要：首轮守卫后的 `CallSummary`；人工编辑以 `PUT /api/calls/<id>/items/<item_id>` 覆盖，编辑后的值仍持久化到同一 `summaries/*.json`。
- 电话事实引用身份：`CallFact.id`。
- Excel 结构：`workbook_contract.py`。
- Job 真实持久化状态：每个任务的 `job.json`，结果详情由 `评估结果.json` 补充。
- Call 真实持久化状态：每个任务的 `record.json`，摘要详情由 `summaries/*.json` 补充。
- 状态转换：简历由 `EvaluationEngine` 控制，电话条目由 `call_state.py` 和 `CallProcessor` 控制。
- 前端当前视图：`frontend/src/state/index.ts` 的 `state`，但服务端任务对象才是跨重启事实来源。
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

修复“通过率低”“A 类减少”“字段变成待确认”等问题时，应先检查模型引用是否真实、Prompt 和解析是否正确，不得直接放宽这些边界来制造表面成功。已按产品决策有意放宽的除外：2026-08 起允许基于完整经历的推断锚点与硬性门槛推断满足（见 6.5），用于压缩 B 类，其下限仍是“不得编造原文中不存在的事实”。

## 19. 文档维护要求

出现下列变更时应同步更新本文：

- 新增核心模块、业务链路或外部服务；
- 修改 Job/Call 状态机；
- 修改核心模型或持久化格式；
- 修改 API 字段、结论枚举或工作簿契约；
- 修改并发、取消、恢复或检查点机制；
- 修改密钥、文件、证据或 Excel 安全边界；
- 修改 Windows 或 macOS 构建、安装或清理流程。

本文应描述当前代码事实，不记录临时调试过程。具体故障证据放入 `debug/`，修复完成后只将稳定的架构约束回写到本文。
