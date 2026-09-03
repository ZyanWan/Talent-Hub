# 电话确认链路

> 电话任务、ASR、摘要、事实守卫、人工编辑和取消语义。
>
> 返回 [SOURCE_MAP.md](../../SOURCE_MAP.md) 选择其他主题。

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
