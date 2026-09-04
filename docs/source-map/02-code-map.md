# 代码地图

> 后端、前端、运行脚本和 UI 组件的职责与依赖。
>
> 返回 [SOURCE_MAP.md](../SOURCE_MAP.md) 选择其他主题。

## 2. 代码地图

| 模块 | 核心职责 | 主要影响对象 |
| --- | --- | --- |
| `app/main.py` | 应用装配、路由、令牌中间件、上传限制、下载和预览、服务启动；PDFium 预览渲染在进程内串行执行 | 前端全部 API、仓储、筛选引擎、电话处理器 |
| `app/config.py` | 数据目录、配置模型、Windows DPAPI、macOS 环境变量 fallback、配置迁移和公开配置 | 模型调用、ASR、飞书推送、前端设置、发布运行环境 |
| `app/feishu.py` | 飞书 Webhook 推送：签名、统一脱敏、筛选/电话消息构建、20KB 大小保护、有限重试、频控及带成功状态的 `push_with_status` | `main.py`（feishu-test）、`pipeline.py`、`phone_screening.py`、设置配置 |
| `app/models.py` | 筛选（含硬性门槛判定）、证据、电话摘要（动态章节/软性观察/快筛问答）的 Pydantic 契约 | Prompt 输出、持久化 JSON、Excel、前端字段 |
| `app/repository.py` | `JsonStore` 通用 JSON 仓储、岗位任务 JSON、文件目录、归档、删除、路径和文件名安全 | `main.py`、`pipeline.py`、`call_repository.py`、任务恢复 |
| `app/call_repository.py` | 电话任务（含 soft_skill_focus、soft_skill_dimensions、job_id）、音频与条目持久化 | `main.py`、`phone_screening.py`、前端电话页 |
| `app/llm.py` | OpenAI 兼容接口、动态输入安全序列化、JSON 提取、传输重试、截断/过滤终止识别、取消 | 筛选标准、候选人评估、横向对比、电话整理 |
| `app/pipeline.py` | 简历筛选主流程、证据守卫、续跑、Excel 载荷 | 任务状态、结果 JSON、工作簿、前端进度 |
| `app/artifact_preview.py` | Markdown 和 Excel 安全预览 | 产物预览 API、前端预览对话框 |
| `app/runtime/extract_resume_text.py` | PDF、DOCX、文本基础解析、清洗（去水印/修复断词/清控制字符）及质量判断 | `pipeline.py`、解析 CLI |
| `app/runtime/build_candidate_workbook.py` | 五表 Excel 构建和公式注入防护 | `pipeline.py`、Excel 验证 |
| `app/runtime/validate_workbook.py` | Excel 结构、跨表关系和安全校验 | `pipeline.py`、交付是否完成 |
| `app/runtime/workbook_contract.py` | 五表名称、表头、枚举和格式契约 | 构建器、校验器、验证、业务输出 |
| `app/runtime/call_state.py` | 电话条目状态机和中断收敛 | `phone_screening.py`、电话重试和取消 |
| `app/runtime/speech_to_text.py` | 火山 ASR 请求、音频输入校验、请求参数和转写渲染 | 电话处理器、ASR 验证 |
| `app/runtime/phone_screening.py` | 电话处理、高级招聘专员 prompt、基础结构校验、三层 narrative 渲染（客观记录/软性素质评价/可选快筛详情）、事实录音定位与 Markdown | 电话任务状态、摘要文件、前端电话详情 |
| `app/resources/references/` | 运行时参考规则库：证据规则、Excel/PDF 规则和招聘判断参考 | `pipeline.py`、`phone_screening.py`、Prompt |
| `frontend/src/**` | React+TS 前端：App.tsx（外壳/顶栏/启动）、views/（筛选/电话/简历工作台）、ui/（弹窗与基础组件）、api/client.ts（唯一 API client）、i18n/（messages.ts 唯一消息源）、router/、state/、customSelect.ts | 后端路由、JSON 字段、状态枚举、契约与单元测试 |
| `launcher.py` | PyInstaller 薄启动入口 | `app.main.main`、打包配置 |
| `start-app.bat` | Windows 一键启动：后端（launcher.py）+ 前端监听（`vite build --watch` 自动重建 dist） | `launcher.py`、`frontend/` 构建 |
| `scripts/build_windows.ps1` | Windows PyInstaller、图标生成、许可证、烟测、安装器编排（可跳过烟测/安装器） | 版本、发布目录、packaging 文件 |
| `scripts/verify_windows_release.ps1` | 发布 EXE 的启动、临时数据目录和首页烟测 | `main.py` 参数、`/health`、首页结构 |
| `packaging/talent_hub_macos.spec` | macOS PyInstaller `.app` bundle 配置 | macOS 发布产物、资源收集、启动入口 |
| `scripts/build_macos.sh` | macOS PyInstaller 构建、许可证、烟测和版本化 zip 输出 | 版本、发布目录、macOS packaging 文件 |
| `scripts/verify_macos_release.sh` | macOS 可执行文件启动、临时数据目录和首页烟测 | `main.py` 参数、`/health`、首页结构 |
| `scripts/extract_model_texts.py` | 从实际 Prompt 构造函数生成完整模型输入文本清单 | `docs/MODEL_INPUT_TEXTS.md`、Prompt 工程审阅 |
| `docs/MODEL_INPUT_TEXTS.md` | 生产与调试链路发送给模型的静态文本、动态边界、重试指令和请求信封快照 | Prompt 工程审阅、变更核对 |
| `tests/test_resume_preview.py` | PDF 预览并发串行化与失败清理回归验证 | `app/main.py` 的 PDFium 渲染边界 |
| `tests/test_prompt_contracts.py` | 分级状态机、事实引用、动态边界、横向对比和模型终止原因回归验证 | `models.py`、`pipeline.py`、`phone_screening.py`、`main.py`、`llm.py` |
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

- `frontend/src/router/index.ts` 集中视图切换与轮询生命周期：视图注册 `{ enter, exit }`，`show(name)` 负责「离开旧视图 → 隐藏全部 section → 进入新视图」。
  轮询互斥约定：**每个视图主要在自己的 `exit` 里停止本视图的轮询字段**（screening 停 `state.pollTimer`、phone 停 `state.callPollTimer`，见上表归属），由「同一时刻仅一个视图激活」天然保证互斥；
  退出应用流程存在防御性跨轮询清理。新增视图只需在自己的 `exit` 停自己的轮询即可，不应新增常规跨视图感知。轮询回调通过 `currentView()` 判断是否丢弃过期结果。模块局部 UI 状态（如电话软性维度选择、岗位导入序号、音频 Blob 缓存）不进入全局 `state` 表。
- `frontend/src/i18n/index.ts` 的 `onChange()` 是语言切换广播：各组件订阅后重渲染，`setLanguage` 只写 `state.language` + 持久化 + 广播，不直接调用各视图渲染函数。

新增页面（视图或对话框）的标准流程：① 在 `frontend/src/views/` 或 `frontend/src/ui/` 新建 React 组件，提供受控 props 与交互逻辑；② 需要的双语文案在 `frontend/src/i18n/messages.ts` 中 zh/en 同步新增 key；
③ 在 `App.tsx` 中接线渲染与显隐；④ 不触碰其他模块，跨模块数据只走显式 import / props / 全局 state 归属字段。

历史任务抽屉（`HistoryDrawer`）与筛选/电话视图之间不互相 import：通过外层 `App` 传入的 `onOpenJob` / `onOpenCall` props 回调完成「从历史打开任务」的导航。

#### React 生产前端实现约定

`frontend/` 是生产前端实现（React + TypeScript，Vite 构建；构建产物 `frontend/dist` 由 FastAPI 托管，`GET /` 注入 token、根路径挂载静态资源）：

- `frontend/src/api/client.ts`：唯一 API client，实现 `X-App-Token` 注入、string body JSON Content-Type、错误 `detail` 透传三态、content-type JSON/非 JSON 判定；行为由契约测试 `api-client.test.ts` 锁定。
- `frontend/src/i18n/`：`messages.ts` 为手工维护的唯一消息源（zh/en 各 262 key，勿手改）；`index.ts` 提供 `t` / `getLanguage` / `setLanguage` / `onChange`，语言状态以 `src/state` 的 `state.language` 为唯一事实来源，`setLanguage` 写 `state.language` + 持久化并广播；
  key 全集由 `i18n.test.ts` 锁定。
- `frontend/src/state/index.ts`：全局状态单对象（`compareSelection` 为 `Set`、`resumeRenderCache` 为 `Map`、`pollTimer`/`callPollTimer` 为定时器句柄），字段按 §2.1 归属表以注释分组标注；
  `state.language` 为前端语言唯一事实来源，被 `frontend/src/i18n/` 消费（`getLanguage` / `setLanguage` / `t` 均读写 `state.language`）。
- `frontend/src/router/index.ts`：视图路由（`registerView(name, {enter, exit})` / `show(name)` / `showSection(sectionId)` / `currentView()`）；
  `show` 顺序固定为 exit 旧视图 → 更新 current → hideAll（5 个 section 与 `resultActions`/`appendResumesButton`/`appendCallAudioButton` 隐藏、`viewTitle` 可见）→ enter 新视图，同一视图重复 show 直接返回；
  不依赖全局 state，DOM 查找内联 `document.getElementById`（元素缺失时 `console.warn`）。
- `frontend/src/ui/customSelect.ts`：自定义下拉组件（隐藏的原生 `select` 做值载体，`value` 读写与 `change` 事件语义不变；菜单从 `select.options` 渲染，动态 option 变化后调用 `sync()` 重建；
  展开/收起过渡与键盘导航（方向键/Enter/Space/Tab/Escape）；方向自适应按最近滚动容器/视口底部判断向上/向下弹出，菜单限高 300px 内部滚动；订阅 `src/i18n` 的 `onChange`，语言切换自动重建菜单——option 文案由 React 异步提交 DOM，故 `onChange` 回调经双 `requestAnimationFrame` 延迟到提交完成后执行 `sync()`，避免重建时读到切换前旧文案），对外仅暴露 `createCustomSelect({ wrap, select })` → `{ sync, close }`。
- `frontend/src/ui/`：基础 UI 组件（React + TSX），class 名 / ARIA / 状态语义对齐 `frontend/public/styles.css` 的 shell 与状态样式体系，样式 token 直接引用现有 CSS 变量（`--ink`/`--paper`/`--surface-muted`/`--red`/`--blue-soft` 等），不引入新设计。
  各组件：
  - `Button.tsx`：`Button({ variant: "primary"|"secondary"|"danger"|"icon"|"send", busy, ... })`，variant 映射 `.primary-button`（黑底白字）/`.secondary-button`（白底描边）/`.danger-button`（红底）/`.icon-button`（圆形 36px）/`.send-button`（黑色主 CTA）；
    `busy` 时加 `.is-busy`（13px spinner 由 CSS `::before` 绘制）、置 `disabled`、写 `aria-busy="true"`，非 busy 时不携带 `aria-busy`；
    默认 `type="button"`。
  - `StatusDot.tsx`：`.status-dot`（默认金色未就绪态）/`.status-dot.ready`（蓝色就绪态）；无独立 error 样式类，`status="error"` 只渲染基类。
  - `Tag.tsx`：`.conclusion` + 等级修饰类（`grade="a"|"b"|"c"` → `.a` 浅蓝 / `.b` 浅金 / `.c` 浅红），等级换算：A→a、B→b、其余→c，由调用方换算后传入。
  - `Progress.tsx`：`.progress-track`（高 4px、圆角、`--surface-muted` 底）内嵌填充 `span`，宽度经内联 style 控制并收敛到 0-100；电话视图结构相同的 `.call-progress-track` 通过 `trackClassName` 复用。
  - `Toast.tsx`：`.toast` + `role="status"` + `hidden` 显隐控制（`open` prop）；自动隐藏定时属调用方应用逻辑，不在组件内。
  - `EmptyState.tsx`：两种 DOM 形态——`variant="history"` → `.history-empty-state`（flex 列居中，可选图标 + 文案）；`variant="table"` → `tr.empty-row > td`（结果表空行）。
  - `PreviewDialog.tsx`：产物预览弹窗（查看类：关闭按钮 + ESC + 点遮罩关闭，无未保存输入）。受控 props `{ open, jobId, kind: "criteria" | "workbook", onClose }`；
    预览数据与请求句柄为组件本地状态，不写全局 state。打开时经 `api()` 请求 `GET /api/jobs/{id}/preview/{kind}` 并用 AbortController 中止上一次未完成请求，卸载/关闭时中止当前请求；
    markdown 安全渲染仅 h1-h3/ul/p（文本节点输出防 HTML 注入），空内容显示 emptyPreview；workbook sheet tabs 支持点击与左右/Home/End 键盘切换、空表显示 emptyWorksheet；
    `truncated` 显示截断提示；下载走 `GET /api/jobs/{id}/criteria` 与 `/download`（Blob + `content-disposition` 文件名，zh 优先服务端文件名）。
    交互与渲染由 `frontend/tests/unit/preview-dialog.test.tsx` 锁定（jsdom，不截图）。
  - `SettingsDialog.tsx`：应用设置弹窗（编辑类：仅关闭按钮 + ESC 退出，点遮罩不关闭）。桌面端按模型服务、本地处理、飞书推送和使用偏好分组双列展示；飞书分组包含 Webhook、签名密钥和自动推送开关，使用偏好包含本地保留简历文本和生成电话快筛详情。
    低高度视口仅滚动配置内容并保持头部与操作区可见，窄屏回落单列。受控 props `{ open, onClose }`；每次打开从全局 `state.settings` 回填非密钥字段（默认值：base_url `https://api.openai.com/v1`、max_parallel 6、request_timeout 180），密钥输入框（api_key / asr_api_key / feishu_sign_secret）恒为空、不回填明文密钥。
    密钥保留/清除语义：三个密钥输入框留空提交空串表示保留已存值（服务端仅覆盖非空字段）；「清除 ASR」「清除飞书签名」置 `clear_asr` / `clear_feishu_sign=true` 并提交表单（`requestSubmit` 走原生表单校验，对应密钥字段同时提交空串），`clear_*` 为一次性瞬态标志、提交后复位。
    保存 `PUT /api/settings`（成功后写回 `state.settings`）、测试模型连接 `POST /api/settings/test`（zh 优先展示服务端 `result.message`，en 固定通用文案）、测试飞书 `POST /api/settings/feishu-test`，请求负载键名与端点稳定；
    保存/两个测试按钮独立 busy（is-busy + 文案切换）；OCR 状态按 `state.settings.ocr` 渲染 ready/error 文案；结果提示区 `.dialog-message`（error 追加 `.error`）；
    订阅 `src/i18n` 的 `onChange`，语言切换重渲染并清空结果提示。交互与渲染由 `frontend/tests/unit/settings-dialog.test.tsx` 锁定（jsdom，不截图）。
  - `CompareDialog.tsx`：AI 横向对比弹窗（查看类：关闭按钮 + ESC + 点遮罩关闭，对比进行中关闭 = 触发取消）。受控 props `{ open, jobId, candidates, onClose }`，`candidates` 为结果页数据行（`source_file` / `candidate_name` / `conclusion`）。
    候选人勾选在结果页完成（仅 A/B 结论可参与、C 类复选框禁用并带 compareExcludeC 提示，≥2 人启用发起按钮、不足时带 compareButtonTitle 提示，勾选集合走全局 `state.compareSelection`）；
    **弹窗打开即用传入 `candidates` 的 `source_file` 自动发起对比**（"点击即运行"，无弹窗内二次勾选），候选人不足 2 人时不发起并显示空态兜底。发起 `POST /api/jobs/{id}/compare?cancel_key=<crypto.randomUUID()>`，body `{files: [...candidates]}`（服务端再排序去重）；
    `cancel_key` 由组件生成并以 `cancelKeyRef` 持有，完成/失败/取消后置空。取消走 `POST /api/jobs/{id}/compare/cancel`（body `{cancel_key}`），请求失败可忽略，成功后关闭 + 「已取消对比」toast；
    用户取消后对比请求晚到的结果与 499 被静默丢弃。后端取消对比返回 499 时前端展示 compareFail 文案；400（少于 2 人 / C 类参与 / 文件不在结果 / 模型未配置）/404（评估结果未生成）/500 错误经 `api()` detail 透传后同样以 compareFail 展示。
    缓存命中时后端直接返回 `{ranking}`，前端直出结果；结果渲染 ranking 列表（序号补零、候选人名、结论徽章按 A/B/C 着色、理由），meta 显示 compareMetaCount。
    订阅 `src/i18n` 的 `onChange`，语言切换重渲染徽章与文案。Toast（取消/失败提示）经 `createPortal` 渲染到 body，避免随遮罩淡出动画截断。交互与渲染由 `frontend/tests/unit/compare-dialog.test.tsx` 锁定（jsdom，不截图）。
  - `HistoryDrawer.tsx`：历史任务抽屉（查看类：关闭按钮 + ESC + 点遮罩关闭）。受控 props `{ open, initialKind, onClose, onOpenJob, onOpenCall }`；
    点击行触发 `onOpenJob(jobId)` / `onOpenCall(callId)` props 回调通知外层打开对应视图，组件不依赖 screening/phone 模块；删除当前任务后的工作区重置同样交由外层视图容器处理，组件只负责请求、刷新列表与 toast。
    active 行按全局 `state.currentJob` / `state.currentCall` 的 id 判断。顶部 kind 切换（job | call，label 复用 taskHistory / phoneRecord），各自独立 recent/archived tab 与计数；
    分页 `limit=50` + `offset` 追加「加载更多」（`items.length < total` 时显示）。数据经 `api()` 走 `GET /api/jobs?scope=&limit=&offset=` → `{jobs, total}`、`GET /api/calls?scope=...` → `{calls, total}`；
    存储占用 `GET /api/storage`（`job_count` / `jobs_bytes`，仅 job 列表展示，格式化 `formatStorageSize`）。行操作：归档/恢复 `POST /api/{jobs|calls}/{id}/archive|restore`，永久删除 `DELETE /api/{jobs|calls}/{id}`（确认框，删除中按钮禁用 + deleting 文案 + toast；
    queued/running 任务禁用归档与删除；ESC 先关确认框）。空状态区分 recent/archived 与 job/call 文案，加载中显示读取文案，请求错误经 toast 展示；订阅 `src/i18n` 的 `onChange`，语言切换重渲染（标题 / tab / 日期格式 / 文案）。
    交互与渲染由 `frontend/tests/unit/history-drawer.test.tsx` 锁定（jsdom，不截图）。
  - `src/App.tsx`：应用根组件（应用外壳 / 顶栏 / 启动流程 / 视图容器），class 名对齐 `frontend/public/styles.css` 的 shell 体系（`app-shell` / `topbar` / `brand-group` / `tool-strip` / `language-switch` / `connection-state` / `topbar-actions`），900/660/420px 断点行为由样式表直接接管（顶栏两列、隐藏 wordmark / view-context / 连接状态文案等）。
    顶栏构成：品牌区（wordmark + 历史按钮打开 `HistoryDrawer` + 新建按钮展开 `toolStrip` 工具切换 screening|phone，点击外部或 ESC 关闭，document 级监听）；
    语言切换（zh-CN/EN，写 `src/i18n` 的 `state.language` + 持久化，并同步 `document.title` 与 `html lang`，切换经 `onChange` 广播重渲染；
    页面级过渡：支持 View Transition 时 `document.startViewTransition(() => flushSync(() => setLanguage(lang)))` 整页交叉淡化——React 异步渲染需 `flushSync` 在过渡回调内同步提交，否则新快照读到旧文案；
    `prefers-reduced-motion` 或浏览器无该 API 时直接切换，不支持 View Transition 时直接切换）；连接状态（`configDot` / `configStatus`，按 bootstrap `settings.is_ready` + `settings.model` 渲染 `modelConnected` / `modelPending` / `configLoading` 三态）；
    设置按钮（打开 `SettingsDialog`）；退出按钮（`window.confirm(t("exitConfirm"))` → `POST /api/shutdown` → 渲染 `.shutdown-message` 退出页，失败经 toast 提示）。
    启动流程 `bootstrap()`：`GET /api/bootstrap` → 写 `state.settings` / `state.jobs` / `state.historyTotals.recent` → 按 `localStorage.talentHub.activeTool` 分流（phone → 电话视图；
    screening 且有 `talentHub.lastJob` → `GET /api/jobs/{id}` 按任务状态路由 results（completed 或含结果的 failed）/ criteriaReview（waiting）/ progress（其余），失败清 lastJob 回落 setup；
    无 lastJob → 写 activeTool=screening 并进入 setup）→ `!settings.is_ready` 自动打开设置弹窗 → 隐藏 startup-loading。**视图切换 `navigate(name)` 对筛选子视图统一 `routerShow("screening")`**（setup / progress / criteriaReview / results 归一到 "screening" 路由视图，phone 独立），随后 `showSection` 显隐对应 section 并同步 `document.body.dataset.view`（criteriaReview 对应 review）；
    离开筛选视图（切到 phone）时经 router 触发 "screening" 视图 exit 清理筛选轮询定时器；`viewTitle` 在电话视图隐藏，筛选视图按任务标题显示（`displayJobTitle`）。
    筛选四视图（setup / progress / criteriaReview / results）由 `ScreeningView` 渲染；`resultActions`（下载筛选标准 / 评估表格）与追加 FAB 仍由 shell 渲染，其显隐由 ScreeningView 在每次渲染后同步（results 视图 + completed 任务显示，追加 FAB 额外要求未归档），点击事件亦由 ScreeningView 接线（下载打开 `PreviewDialog`、追加 FAB 触发隐藏文件输入）。
    `frontend/src/main.tsx` 为 Vite 构建入口（`createRoot` 挂载 `#root`，渲染 `<App/>`）。应用启动、基础路由与异步任务隔离由 `frontend/tests/unit/app-shell.test.tsx` 锁定；真实托管页面启动由 `frontend/tests/visual/smoke.spec.ts` 验证。
  - `src/views/ScreeningView.tsx`：简历筛选任务流视图，由 App 以 props `{ view, onNavigate, onToast, onRequireSettings, resetSignal }` 驱动（`view` 为当前 section 名，`onNavigate` 复用 App.navigate，`resetSignal` 递增时重置工作区 state 清理）。
    **setup**：JD textarea（`#jdText`）+ 简历拖拽区（accept 为 `.pdf,.docx,.txt,.md,.markdown,.png,.jpg,.jpeg,.webp,.tif,.tiff,.bmp`，dragenter/dragover/drop 带 `.dragging` 态）+ 文件输入选择，去重键 `${name}:${size}:${lastModified}`（写全局 `state.selectedResumes`）；
    「候选人简历」摘要按钮（`#openResumeWorkspaceButton`）为查看/增添/移除简历的唯一入口，点击打开 `ResumeWorkspace` 本地模式，不渲染内联已选列表；开始按钮按 `hasJd && count>0` 启停。
    **任务创建**：`POST /api/jobs`（body `{title:"岗位候选人筛选"}`）→ `PUT /api/jobs/{id}/jd`（body `{text}`）→ 逐份 `PUT /api/jobs/{id}/resumes?filename=`（body 为 File，`upload.accepted===false` 计重复）→ `POST /api/jobs/{id}/start` → 进入 progress 并轮询；
    上传期间 progress 阶段文案为「保存岗位说明 / 上传简历 {current}/{total}」（progress 的瞬态 stage），完成后重复数经 `duplicateResumesSkipped` toast 提示。
    **progress**：1200ms 轮询 `GET /api/jobs/{id}`，定时器存全局 `state.pollTimer`，组件挂载时 `registerView("screening", { exit: 清 pollTimer })`（视图切换离开筛选视图即停轮询，router 保证互斥）；
    回调先校验任务 id 未变（排期时捕获）再发请求，响应后校验 `currentView() === "screening"` 且 id 未变（防跨任务/跨视图串扰），网络错误不停止轮询（toast 后重排）；
    按状态分流：completed → results + `completedToast`，failed/cancelled → 有结果的 failed 进 results、否则 progress + 对应 toast，waiting → criteriaReview，其余 → progress 并续排。
    视图内展示阶段文案（`stageLabel`）/百分比（带 bump 动画）/`Progress` 进度条/`resumeProgress` 计数/速率（`jobElapsed`+`speed`/`elapsed`）/实时结果（`liveResults` 最多 8 条倒序，结论徽章按 A/B/C 着色）/错误列表；
    取消 `POST /api/jobs/{id}/cancel`（按钮禁用 + 「正在停止任务」文案）后继续轮询至终态；重试 `POST /api/jobs/{id}/start`（清空对比勾选）。**criteriaReview**：进入时 `GET /api/jobs/{id}/criteria-json` 拉取标准渲染编辑器（essence textarea + 8 个列表字段 + 5 个规则字段，行内可增删，规则行含 rule/verification 输入），失败 toast 后回退到任务状态视图；
    「保存并开始/重新筛选」`PUT /api/jobs/{id}/criteria-json`（收集编辑后标准，空行过滤、规则保留 `id`）→ `POST start` → progress 并轮询；
    返回按钮按任务状态回退（completed → results，其余 → progress）；编辑标准入口（results 工具栏）带 `confirmAndRestart` 文案。**results**：汇总统计（候选人总数 + A/B/C 计数，结论精确匹配 `A优先约面`/`B电话确认`/`C不推进`）、A/B/C 分段过滤（`state.resultFilter`）、8 列表格（对比勾选 / 顺序 / 候选人 / 简历预览入口（眼睛按钮，点击打开 `ResumeWorkspace` stored 模式）/ 结论徽章 / 一句话判定 / 关键风险 / 下一步，数组值按语言分隔符连接、空值 `missingValue`）、错误列表；
    工具栏按钮显隐规则（completed 才显示通知重试/编辑标准/对比/下载，归档任务隐藏追加与结果动作）；对比勾选走全局 `state.compareSelection`，C 类禁用，≥2 人启用 `CompareDialog`；
    重试 / 飞书通知重试（`POST /api/jobs/{id}/retry-notification`，`{job, errors, sent}`）；下载筛选标准 / 评估表格经 `PreviewDialog`（workbook / criteria 预览 + Blob 下载）。
    **追加简历**：仅 completed 且未归档任务（FAB 显隐由 results 视图控制），逐份上传后按 `upload.accepted` 区分：重复且 `duplicate_of` 未在已评估结果中计 pendingDuplicateCount；
    全部重复且无 pending → 回读任务 + `noNewResumes` 提示并回 results；否则 `POST start` 重新筛选；归档任务直接忽略。`resultActions` / 追加 FAB 为 shell 渲染的非受控元素，其显隐在每次渲染后同步（读取 `document.getElementById`，不参与 React reconcile，与 router 的 DOM 显隐管理一致）。
    核心交互由 `frontend/tests/unit/screening-view.test.tsx` 锁定（7 例，jsdom，不截图：创建与上传去重、轮询取消、标准确认、结果过滤对比、追加简历、归档恢复和删除复位）。
  - `src/views/ResumeWorkspace.tsx`：简历工作台弹窗（编辑类：仅「关闭按钮 + ESC」退出，点遮罩不关闭）。受控 props `{ open, stored?, onClose, onFilesChanged? }`；
    本地模式文件列表读全局 `state.selectedResumes`（弹窗内新增按 `name:size:lastModified` 去重追加、移除与预览索引调整，增删后经 `onFilesChanged` 通知外层同步），stored 模式由 `{ jobId, filename, candidateName }` 进入（results 视图入口），单文件预览并隐藏导航与添加按钮。
    预览接口：本地 PDF `POST /api/resumes/preview?scale=`（multipart 字段 `file`，页面按 `name:size:lastModified` 缓存到 `state.resumeRenderCache`，命中不重复请求），已存 PDF `GET /api/jobs/{id}/resumes/{filename}/preview?scale=`（不缓存）；
    图片预览本地 `URL.createObjectURL(file)`、已存 `GET /api/jobs/{id}/resumes/{filename}`（Blob → `createObjectURL`），切换/关闭时 `revokeObjectURL`。
    前端渲染与预取可并行发起请求，后端以进程内互斥锁串行执行 PDFium 调用；前端的渲染与预取各持 AbortController（切换/关闭中止旧请求；预取跳过当前文件与已缓存项，逐份写入缓存）。非 PDF/非图片本地文件显示 `previewUnavailable`；
    后端 415/413/422/503 等异常显示 `previewFailed`，并通过 `api()` 透传具体 `detail`。上一个/下一个导航（位置计数 + 端点禁用态）、移除、ESC/按钮关闭、订阅 `src/i18n` 的 `onChange` 语言切换重渲染。
    核心预览边界由 `frontend/tests/unit/resume-workspace.test.tsx` 锁定（5 例，jsdom，不截图：本地 PDF、切换请求中止、历史 PDF 端点、图片 Blob 释放和不支持格式拦截）；
    后端并发边界由 `tests/test_resume_preview.py` 锁定。
  - `src/views/PhoneView.tsx`：电话确认任务流视图，由 App 以 props `{ view, callOpenRequest, onToast, onRequireSettings, onHistoryChanged, resetSignal }` 驱动（`view === "phone"` 时激活；
    `callOpenRequest={id, seq}` 为历史抽屉打开任务的请求，seq 递增保证重复打开同一条目也触发加载；`resetSignal` 递增时重置工作区；`onHistoryChanged` 在任务状态变化后通知外层，历史抽屉每次打开时重新拉取列表，故无需缓存失效动作）。
    **进入电话视图**：按 `callOpenRequest.id` 或 `localStorage.talentHub.lastCall` 经 `GET /api/calls/{id}` 恢复任务（queued/running 自动续轮询），无 lastCall 时展示新建表单；
    工具切换重置由 `resetSignal` 效果完成。**新建表单**：标题 / 岗位名 / 关联岗位下拉（`GET /api/jobs?scope=recent&limit=100`，复用 `createCustomSelect`，草稿关联岗位不在最近 100 条时补拉 `GET /api/jobs/{id}`）+ 岗位联动导入（`GET /api/jobs/{id}/criteria-json` 的 `bonus_signals` 关键词匹配预设维度，seq 防乱序覆盖，完全替换语义，失败按「筛选标准尚未生成」/「导入失败」toast）+ 软性维度勾选（`soft_skill_dimensions`）+ 录音选择（拖拽/点击，accept `.m4a,.wav,.mp3,.ogg,.opus`，`name:size:lastModified` 去重，后缀/100MB 校验经 `callInvalidAudio` toast）。
    **任务创建**：`POST /api/calls`（body `{title, title_mode, job_title, job_id, soft_skill_focus, soft_skill_dimensions}`；`title_mode` 为 `auto|custom`，自动标题按当前界面语言展示日期标题）→ 逐份 `PUT /api/calls/{id}/audio?filename=`（body 为 File，`upload.accepted===false` 计重复）→ 全部重复则 `noNewAudio` 提示、不触发整理且表单保留草稿关联信息（软性维度/关联岗位回填）→ 否则 `POST /api/calls/{id}/process` → 详情视图并轮询；
    重复计数经 `duplicateAudioSkipped` toast。**追加录音**：仅 call done 且未归档（shell 渲染的 `appendCallAudioButton` FAB 显隐每次渲染后同步），追加后自动 `POST process`；
    全部重复 → `noNewAudio`；追加中忽略重复触发。**详情视图**：标题 / meta（岗位名 · 候选人计数 · stageLabel · 更新时间）/ 错误列表 / 条目卡片（音频名或候选人名 / 状态徽章 `call-badge` / 非 done 条目显示进度条与错误，`transcribing|summarizing` 加活动态；
    done 卡片头部点击打开条目详情浮层，浮层与音频播放由 `src/views/CallItemDetail.tsx` 承载）。操作按钮显隐：取消按钮仅 queued/running（`POST /api/calls/{id}/cancel`，中间态回滚由服务端收敛），重试按钮仅 failed/cancelled 且未归档（`POST /api/calls/{id}/process`）。
    **轮询**：2500ms `GET /api/calls/{id}`，定时器存全局 `state.callPollTimer`，组件挂载时 `registerView("phone", { exit: 清 callPollTimer })`（视图切换离开即停轮询，router 保证互斥）；
    回调先校验任务 id 未变（排期时捕获）再发请求，响应后校验 `currentView() === "phone"` 且 id 未变（防跨任务/跨视图串扰），网络错误不停止轮询（toast 后重排）；
    queued/running 续排，打开/process/追加/重试后经 `[state.currentCall]` 效果统一启动轮询。**详情浮层接线**：done 卡片点击置 `detailItemId` 渲染 `CallItemDetail`（props `{call, itemId, onSelectItem, onClose, onToast, onSaved}`，上/下一个切换同组件内完成）；
    切换任务（`selectCall`）与工具重置（`resetSignal`）时调用 `releaseAudioBlobs()` 释放音频 Blob 并关闭浮层；轮询更新后条目消失时经效果兜底关闭浮层。
    **状态机**：draft（新建表单）/ queued / running / done / failed / cancelled。核心交互由 `frontend/tests/unit/phone-view.test.tsx` 锁定（8 例，jsdom，不截图：创建上传、轮询取消、追加录音、删除复位、归档恢复、历史请求隔离与失败回落、任务重试）。
  - `src/views/CallItemDetail.tsx`：电话条目详情浮层。受控 props `{ call, itemId, onSelectItem, onClose, onToast, onSaved }`（`onSelectItem` 供上/下一个按已完成条目顺序切换，`onSaved` 在保存回读后通知外层刷新历史并同步界面）；
    遮罩通过 React Portal 直接挂到 `document.body`，不受 `.phone-view` 淡入动画层叠上下文限制。**弹窗类别**：编辑类，仅「关闭按钮 + ESC」退出，点遮罩不关闭（防止误触打断录音/丢未保存输入）；
    尺寸由 `.call-item-detail` 独立控制（最大 1400×900px，桌面端打开后高度不随折叠面板开合变化，660px 及以下铺满视口），不改变其他 `.preview-dialog`；
    1080px 及以上将候选人/播放器/narrative 与折叠结果面板分为左右两栏，左栏在详情内容滚动时吸顶，窄屏保持单栏；narrative 禁止拖拽调整尺寸，桌面端固定高度 500px、660px 及以下固定为 240px；
    详情内容区为纵向滚动容器并始终预留滚动条槽位，折叠面板开合不会改变内容宽度。**详情内容**：候选人名输入框 / `<audio class="call-audio">` 播放器 / narrative textarea / 可折叠面板（`<details class="call-panel">`：fields 字段速览（label + value 多行表单，自动换行并随内容增高，不显示字段内部滚动条）、facts 事实清单（content/speaker/ref/start_time，无时间点置禁用态）、doubts 疑点清单、transcript 转写原文 `pre`）；
    标题 meta 为 stageLabel + 状态文案。**音频**：`GET /api/calls/{id}/items/{item_id}/audio`（Blob → `createObjectURL`），模块级 `Map` 缓存 `audioBlobUrls`（key `callId:itemId`）复用 + `audioBlobPending` 合并并发下载（重复打开同一条目共用同一请求）；
    缓存跨浮层开关复用，仅切换任务/重置时经 `releaseAudioBlobs()` 整体 revoke（PhoneView 切换任务/重置时调用）；加载失败隐藏播放器并 toast `callAudioLoadFail`（已隐藏不重复提示）；
    媒体元素仅在 `0s` 发生解码错误时将同一 Blob URL 改为 `#t=0.064` 并重新加载一次，跳过不完整的 AAC 首包且避免循环重试。**播放恢复**：对同一 `itemKey` 复用 `<audio>` DOM 节点，轮询重绘不销毁元素，播放位置与播放状态天然保持；
    元素被重建（条目状态往返重挂载）时经 ref 回调在卸载瞬间捕获快照（currentTime/paused/ended + capturedAt）并暂停（防双音），加载完成后按快照补偿「捕获→恢复」已播时长（L1）后 seek+play，恢复前一次性监听 play/pause/seeked，用户已操作播放器则不覆盖（M2）；
    条目切换不跨条目恢复。**编辑保存**：`PUT /api/calls/{id}/items/{item_id}`，body `{narrative, candidate_name, fields:[{key,label,value,status,note}]}`（完整覆盖语义、字段值可清空，status 缺省回退「已确认」），成功后回读 `GET /api/calls/{id}` 写回 `state.currentCall` 并经 `onSaved` 通知外层；
    **facts 跳转**：点击事实行 → `currentTime = start_time` 并播放（音频未就绪时先加载，readyState/loadedmetadata 后执行）；**Markdown 下载**：`GET .../items/{item_id}/download`（Blob，文件名解析 `filename*` → `filename` → 回退 `{itemId}.md`）。
    **非 done 条目**：转写中/整理中/failed 在详情内展示进度（`transcribing|summarizing` 加活动条纹）与错误文案，不加载音频（本实现保留浮层展示状态）。语言切换经 `src/i18n` `onChange` 重渲染。
    核心交互由 `frontend/tests/unit/call-item-detail.test.tsx` 锁定（8 例，jsdom，不截图：详情结构、音频加载失败、首包解码恢复、缓存释放、轮询重绘播放保持、编辑保存、事实跳转和处理中状态）。

### 2.2 前端 UI 行为约定

以下为本项目稳定落地的 UI 行为约定，改动时应保持一致，避免风格分裂：

- **模态框动画收敛**：居中弹窗（settings/resume/preview/compare/callItemDetail/confirm）的动画声明统一走「公共动效组」分组规则（淡入 + 上移 + 微缩放），各 dialog 类只保留尺寸/边框/圆角差异；
  `callItemDetail` 复用 `preview-dialog` 样式但属于编辑类；`history-dialog` 抽屉（X 轴滑入）与 `confirm-dialog` 更暗遮罩（.44）是刻意差异，保留独立覆盖。
  弹窗统一经 preview-backdrop 遮罩开合（useDialogAnimation 双 rAF 加 .is-visible）；删除确认框的遮罩嵌套在抽屉遮罩内部，其 .44 背景覆盖必须用 :has(> .confirm-dialog) 直接子代选择器限定——若用后代选择器会同时命中祖先抽屉遮罩，两层都变 .44、叠加过深。
- **遮罩点击关闭按误触成本分级**：编辑类（settings / resume / callItemDetail）只支持「关闭按钮 + ESC」退出（误触会丢未保存输入或打断录音播放）；查看类（preview / compare / history）保留点遮罩关闭；confirm 删除框本就不支持。新增编辑类 dialog 时应默认禁遮罩关闭。
- **下拉统一走 `createCustomSelect()`**（`frontend/src/ui/customSelect.ts`）：原生 `<select>` 弹层无法做 CSS 过渡动画，全站下拉统一改用该组件——隐藏原生 select 做值载体（`value` 读写与 `change` 监听零改动），JS 从 `select.options` 渲染菜单，带展开/收起过渡、键盘导航（方向键/Enter/Space/Tab/ESC）、方向自适应（内部 `measureSelectFlip` 按最近滚动容器判断向上/向下弹出，菜单限高 300px 内部滚动）、语言切换自动重建。
  新增下拉一律复用组件，禁止手写第二份逻辑。
- **页面滚动条 gutter 恒定**：`html` 使用 `scrollbar-gutter: stable`（`@supports` 包裹 + `overflow-y: scroll` 兜底），结果页 ↔ 新建页切换不因滚动条出现/消失产生内容区宽度突变。
- **动态内部滚动区 gutter 恒定**：横向对比、设置弹窗配置内容、历史任务列表、自定义下拉菜单、简历库、PDF 简历页、下载预览正文与工作表预览统一使用 `scrollbar-gutter: stable`；加载完成、标签切换、文件增删或内容长度变化不会因纵向滚动条出现/消失改变内部可用宽度。电话条目详情内容区遵循同一约束。
- **视图切换过渡**：5 个 section 与结果页配套元素（`#resultActions`、`#appendResumesButton`、`#appendCallAudioButton`）统一 `view-in` 纯淡入动画（出现侧，`prefers-reduced-motion` 豁免）；消失侧为瞬间隐藏（纯 CSS 边界，如需交叉淡化需 View Transition API）。
