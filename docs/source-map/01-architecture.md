# 架构与运行

> 项目边界、运行拓扑、启动链路和单一事实来源。
>
> 返回 [SOURCE_MAP.md](../../SOURCE_MAP.md) 选择其他主题。

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
