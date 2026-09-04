# 电话确认链路

> 电话任务、ASR、摘要、招聘判断、人工编辑和取消语义。
>
> 返回 [SOURCE_MAP.md](../SOURCE_MAP.md) 选择其他主题。

## 9. 电话确认端到端数据流

电话链路由一次模型调用生成完整 `CallSummary`。程序只校验 JSON、动态记录章节和字段结构；结构失败时最多纠正重试一次，不对模型返回的客观记录、综合招聘判断和字段状态做语义裁决或删改。`facts[].ref` 只用于尽可能定位录音时间，不影响最终 `narrative`。人工编辑是最终校正边界。`CallRepository` 复用 `repository.py` 的 `JsonStore`，因此电话任务的 JSON 保存、归档、恢复、删除和锁语义与岗位任务共享同一底层仓储规则。

### 9.1 创建和上传

```text
frontend/src/views/PhoneView.tsx 处理任务
  → POST /api/calls {title, title_mode, job_title, job_id, soft_skill_focus, soft_skill_dimensions}
  → CallRepository.create()
  → calls/<call_id>/record.json
  → 创建 audio/ transcripts/ summaries/

  → PUT /api/calls/<id>/audio?filename=...
  → 校验后缀和 100 MB 上限
  → reserve_audio() 处理重名
  → add_item()
  → record.json.items[] 新增 queued 条目
```

`title_mode` 使用 `auto|custom` 区分日期默认标题与用户标题。前端对 `auto` 标题按当前界面语言渲染，`custom` 标题保持用户原文；没有该字段的任务仅在标题严格符合中英文日期默认格式时按自动标题兼容显示。

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
     5. AI 生成 CallSummary：以高级招聘专员的第一工作视角生成客观记录和综合招聘判断；候选人信息、软性关注项和转写放入明确的不可信数据边界；转写超过 160,000 字符时保留首 120,000 与末 40,000 字符并显式标注省略；快筛问答按 `call_qa_records` 开关生成
     6. validate_call_structure() 检查动态章节和字段是否完整；失败时纠正重试一次
     7. render_remark_narrative() 完整渲染模型返回的客观记录、综合招聘判断与可选快筛详情
     8. attach_fact_timestamps() 按 fact.ref 尝试定位录音时间区间，写入 facts[].start_time/end_time；定位失败不改变模型内容
     9. summaries/<item_id>.json 和 .md
    10. record.json 中对应条目写入 summary
    11. summarizing → done
```

录音回放定位：`GET /api/calls/{call_id}/items/{item_id}/audio` 按 token 校验后返回录音文件流（前端 fetch 为 Blob 播放，不新增存储）；事实时间戳由 `attach_fact_timestamps()` 在落盘前计算并持久化到 `facts[].start_time/end_time`，旧任务无时间戳时前端降级为不可点击。

每条录音只有一个模型整理阶段；JSON 或必填结构失败时该阶段最多纠正重试一次：

| 阶段 | 模型输入 | 模型输出 | 程序责任 |
| --- | --- | --- | --- |
| 整理 | ASR 转写、可选软性关注项 | 结构化 `CallSummary`（不含 narrative；qa_records 按开关生成） | 校验基础结构，完整渲染 narrative，尝试定位事实时间 |

### 9.3 首轮摘要是稳定基线

`CallSummary` 是最终持久化和前端展示的数据结构，包括：

```text
candidate_name, call_date,
remark_sections[]     动态业务章节（title, bullets[] 字符串）
soft_skill_summary[]  可选综合招聘判断字符串；信息不足时为空，判断维度不限
soft_skill_summary_title  招聘判断章节标题（可选）
qa_records[]          快筛详情通篇问答（question, answer；按设置开关生成，默认关闭；关闭时程序侧解析后强制清空，模型自行输出也不保留）
narrative             由上述结构渲染的统一可编辑文本，用于展示和 Markdown 下载
fields[].{key,label,value,status,note}, facts[], doubts[],
transcript（转写原文与时间戳定位基准）
```

`narrative` 由 `render_remark_narrative()` 完整渲染三层结构：① 客观记录章节 → ② 分点式综合招聘判断 → ③ 快筛详情（通篇问答原文，仅开关开启且有内容时渲染）。人工编辑 `narrative` 后不反向解析回结构化字段。

首轮整理必须至少满足：

- `remark_sections` 至少一项，且每项标题与要点非空；
- `fields` 非空；
- 渲染后的 `narrative` 非空。

综合招聘判断与快筛详情（`qa_records`）不是必填项：没有可靠通话信息时可以为空。每条招聘判断是一句完整字符串，不限定维度；提示词要求结论详写实际工作价值或潜在风险，行为依据简写。

首轮若返回空壳，视为结构失败并携带错误重试一次；连续失败则该条目进入 failed，不得以空摘要标记 done。

### 9.4 基础结构校验与录音定位

`validate_call_structure()` 只拒绝无法形成可用结果的空壳：动态章节为空、章节标题或要点为空、字段列表为空。它不分析文本语义，不删除正文、招聘判断或问答，也不改写字段状态。

`facts[]` 是录音回放的辅助数据。`attach_fact_timestamps()` 使用 `ref` 在带时间戳的转写和原始 utterances 中尝试定位；定位成功时写入 `start_time/end_time`，失败时保持为空，前端将该事实显示为不可点击。事实引用是否定位成功不影响整理内容和任务完成状态。

### 9.5 多录音并发与隔离

同一电话任务中的录音以固定 5 路并发处理（`ITEM_CONCURRENCY`）：每条录音各自独立完成“转写 → 整理 → 结构校验 → 落盘”，互不阻塞。每个条目创建独立模型客户端，摘要文件使用独立 `item_id`，仓储通过 `update_item()` 在锁内读取最新 `record.json` 并只更新目标条目。

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

人工编辑发生在 AI 整理与基础结构校验完成之后，是最终人工校正边界。修改 `CallSummary`、`CallField`、`CallFact` 时，必须同步检查：整理 prompt、完整性校验、Markdown、编辑 API、前端字段渲染与保存、电话回归验证。

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

历史侧栏通过 `HistoryMutation` 把删除身份或归档/恢复后的服务端摘要提交给 `App`。事件命中 `state.currentCall` 时，删除会清除 `talentHub.lastCall` 与当前任务，并递增 `phoneResetSignal`，由 `PhoneView` 停止轮询、释放音频对象 URL、关闭条目详情并回到新建表单；归档与恢复会把摘要合并到当前完整任务，使追加录音和重试操作立即按最新 `archived_at` 显隐。非当前电话记录的变更只刷新侧栏，不改变主区域。

电话历史任务加载使用独立递增序号。只有最后一次用户选择的响应可以写入 `state.currentCall` 和 `talentHub.lastCall`；视图退出、工作区重置和新的选择都会使早期请求失效。最后一次请求失败时清空当前电话任务、待上传文件和恢复键，并回到新建表单。
