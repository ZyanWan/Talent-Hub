# API 与运行时约束

> 前后端 API、轮询、并发、持久化和取消隔离。
>
> 返回 [SOURCE_MAP.md](../../SOURCE_MAP.md) 选择其他主题。

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
remark_sections[].{title,bullets[].{text,fact_ids}}, soft_skill_summary_title,
soft_skill_summary[].{text,fact_ids},
qa_records[].{question,answer},
fields[].{key,label,value,status,fact_ids,note},
facts[].{id,content,speaker,ref,start_time,end_time},
extra_info, doubts, guard_warnings, transcript
```

`fields[].key` 是人工编辑的稳定身份；`facts[].id` 是事实引用（字段 `fact_ids`）的稳定身份。修改它们会影响事实守卫、人工编辑和旧摘要兼容。

前端实际直接消费的子集：任务字段中仅 `progress`、`created_at` 不被前端直接读取（电话任务结构不存在 `completed`/`total`，二者是 Job 任务专有字段）；摘要直接渲染 `narrative`、`fields[].{key,label,value,status}`、`facts[].{content,speaker,ref,start_time}`、`doubts`、`guard_warnings`、`transcript`；`remark_sections`、`soft_skill_summary`、`soft_skill_summary_title`、`qa_records` 由后端 `render_remark_narrative()` 渲染进 `narrative` 后间接消费；`call_date`、`extra_info` 及 `fields[].{fact_ids,note}` 前端不直接展示，编辑保存时仍会透传。

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
