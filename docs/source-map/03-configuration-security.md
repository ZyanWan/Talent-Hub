# 配置、密钥与安全边界

> 配置读写、敏感信息保护、外部服务设置和安全联查项。
>
> 返回 [SOURCE_MAP.md](../SOURCE_MAP.md) 选择其他主题。

## 5. 配置与密钥数据流

```text
frontend/src/ui/SettingsDialog.tsx
  -> initialForm() 从 state.settings 回填非密钥字段，密钥输入恒为空
  -> buildPayload() 为保存、模型测试和飞书测试构造同一字段集合
  -> PUT /api/settings
  -> main.py merged_settings()
     ├─ 读取 SettingsStore 当前值
     ├─ 从 payload 排除密钥、clear_* 与 asr_enabled，再构造 AppSettings
     ├─ api_key / asr_api_key / feishu_sign_secret：空输入保留已存值
     ├─ clear_asr / clear_feishu_sign：清空对应密钥
     └─ asr_enabled 由 bool(asr_api_key) 计算，不直接采用请求值
  -> SettingsStore.save()
     ├─ normalized() 收敛地址、并发和超时范围
     ├─ Windows：模型、ASR 与飞书签名密钥使用 DPAPI 加密
     ├─ 非 Windows：敏感密钥通过环境变量提供，不写入 settings.json
     └─ 临时文件 + os.replace 写 settings.json
  -> AppSettings.public_dict() 移除全部明文密钥并给出 configured/is_ready 状态
  -> public_settings() 追加 OCR 状态后返回前端
```

`feishu_webhook_url` 会由公开设置返回前端；模型、ASR 和飞书签名密钥只返回 `api_key_configured`、`asr_configured`、`feishu_sign_configured` 布尔状态。

外部服务取值链路：

```text
EvaluationEngine / CallProcessor / 模型连接测试 / 候选人对比
  -> SettingsStore.load()
  -> AppSettings.effective_* 读取已存值或对应环境变量
  -> OpenAICompatibleClient / speech_to_text

POST /api/settings/feishu-test
  -> merged_settings() 合并当前表单与已存密钥
  -> build_test_message()
  -> send_message(settings, body)
  -> 飞书 Webhook
```

飞书业务通知链路：

```text
pipeline._run / phone_screening._run 或独立通知重试 API
  -> 按通知状态和兼容基线筛出待发送结果
  -> push_with_status(settings_store, build_fn, *args)
  -> SettingsStore.load() 读取最新配置
  -> 开关关闭或 Webhook 为空：返回 (False, None)，不发起请求
  -> 构建消息、按内置规则替换常见手机号/座机号/邮箱格式并检查大小
  -> send_message()
  -> 连接/超时、HTTP 429/5xx 最多 3 次总尝试，并执行共享频控
  -> 仅飞书业务码 0 视为成功；成功后写入对应通知状态
  -> 错误转换为不含 Webhook 和密钥的类别、HTTP 状态/业务码及尝试次数
```

关键约束：

- 设置框不回填已保存密钥；空输入表示保留，`clear_asr` / `clear_feishu_sign` 表示清除。
- 推送挂点位于任务写入终态（Job `completed`、Call `done`）之前；通知失败提示与终态在同一次任务更新中持久化。
- 电话条目使用 `feishu_push_status` / `feishu_pushed_at`；简历任务使用 `feishu_criteria_fingerprint`、`feishu_notified_resume_hashes`、`feishu_notified_at` 和 `feishu_rescreen_pending`。
- `_ensure_feishu_baseline()` 为没有通知版本字段的持久化任务建立兼容基线。电话使用 `feishu_baseline_item_ids`，简历使用 `feishu_baseline_resume_hashes`；该操作幂等、不发送消息，并保留 `updated_at`。
- 同一任务的自动通知与独立重试共用任务级互斥锁；后进入者等待后重新读取通知状态，避免重复发送。
- `schema_version` 控制持久化设置的兼容加载和归一化。
- 修改配置字段时同步检查 `AppSettings`、`SettingsInput`、`merged_settings()`、`AppSettings.public_dict()`、`public_settings()`、三个设置端点、前端 `initialForm()` / `buildPayload()` 和配置验证。

## 13. 安全边界及其交叉依赖

| 安全边界 | 实现位置 | 修改时同步检查 |
| --- | --- | --- |
| 仅监听回环地址 | `app/main.py` 的 Uvicorn 配置 | 启动、烟测、产品约束 |
| API 本地令牌 | `app/main.py` 中间件、HTML meta、`frontend/src/api/client.ts` | 首页注入、所有 API 验证 |
| 密钥保护与环境变量 | `app/config.py` | 设置 API、公开配置、模型/ASR/飞书签名密钥、验证 |
| 文件名清洗 | `app/repository.py` | 上传、下载、预览、结果 `source_file` |
| 路径边界 | 仓储、`app/artifact_preview.py` | 下载、预览、删除、路径逃逸验证 |
| 上传大小限制 | `app/main.py`、`app/runtime/speech_to_text.py` | 前端提示、错误码、验证 |
| Prompt 注入防护 | `app/pipeline.py`、`app/main.py`、`app/runtime/phone_screening.py` | JD、简历、比较数据、候选人信息、关注项、转写和结构验证 |
| 简历原文证据校验 | `app/pipeline.py` | 分级、硬性门槛、人工展示、验证 |
| 电话事实录音定位 | `app/runtime/phone_screening.py` 的 `attach_fact_timestamps()` | `facts[].ref` 与转写时间；不裁决正文、软性素质评价或字段状态 |
| Excel 公式和外链防护 | 工作簿构建器、校验器 | 工作簿契约、预览、验证 |
| XSS 防护 | React 文本渲染、预览组件 | Markdown、模型输出、表格预览 |

不得绕过令牌、路径校验、简历证据守卫或工作簿校验。电话引用无法定位时保持无时间点，由前端降级为不可跳转，不得据此删除或改写模型业务内容。
