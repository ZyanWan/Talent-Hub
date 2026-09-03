# 简历筛选链路

> 简历任务的数据流、状态机、证据守卫和 Excel 契约。
>
> 返回 [SOURCE_MAP.md](../../SOURCE_MAP.md) 选择其他主题。

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

前端编辑器在本地状态中保留 `job_title`、`essence`、全部列表字段和规则字段；提交时带回完整标准。后端还会把提交字段覆盖到已保存 JSON 上，未提交字段不会被默认值静默抹掉。`ScreeningCriteria` 在每次校验时删除以年龄、性别、民族、籍贯、婚姻或生育状况形成的决策规则，并为缺失或重复的规则 ID 生成任务内唯一 ID。增加或删除 `ScreeningCriteria` 字段时，必须明确它应当：

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

证据守卫只负责核验证据状态，不直接采用模型给出的等级。随后由硬性门槛守卫按统一状态机计算最终结论：

- 任一有效硬条件 `unmet`，或四个核心维度中存在有原文支撑的“不匹配” → C。
- 没有上述明确失败，但存在硬条件 `unknown`，或核心维度不是全部“匹配” → B。
- 全部硬条件 `met` 且四个核心维度全部“匹配” → A。
- B 至少保留一个高优先级核实问题并限制为最多 3 个；A/C 清空电话问题。
- `bonus_signal_hits` 只有同时匹配标准中的加分项且存在简历事实锚点时保留，不改变等级。

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
- 程序最终等级同时使用硬条件状态和四个核心维度状态；模型输出的 `conclusion` 只作为结构输入，不拥有最终决定权。
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
结果排序（等级 → 证据充分度 → 加分项有效命中数 → 证据强度 → 姓名）
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

横向比较最多接收 20 位 A/B 候选人。模型输入是带“不可信数据”边界的结构化 JSON，包含完整筛选规则、硬条件结果、证据维度和有效加分项命中。模型给出同等级内部比较理由；程序强制 A 整体排在 B 前并重新编号，C 不进入比较。

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
