# 配置、密钥与安全边界

> 配置读写、敏感信息保护、外部服务设置和安全联查项。
>
> 返回 [SOURCE_MAP.md](../../SOURCE_MAP.md) 选择其他主题。

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
