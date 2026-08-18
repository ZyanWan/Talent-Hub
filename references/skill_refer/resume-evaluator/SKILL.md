---
name: "resume-evaluator"
description: "根据岗位要求/JD生成简历筛选标准，并评估resume/CV、电子或图片PDF、.docx、.txt/.md或批量候选人文件；适用于招聘筛选、candidate screening、resume evaluation、CV review、shortlist、岗位匹配度分类、风险识别和候选人评估表输出。不要用于仅解析/转换简历文件、泛HR咨询、面试题生成、薪酬调研或非招聘筛选任务。"
---

# Resume 评估

本技能用于把岗位要求（JD/job description）转成可执行的筛选标准，再按标准批量完成候选人筛选并产出决策级评估表。

## 执行步骤

### Step 1. 准备筛选标准文件

必须深入理解JD，详细分析该岗位具体的人才画像后，依据 `templates/job-screening-criteria.md`创建筛选标准文件：`<JobFolder>/<岗位名称>-简历筛选标准.md`填写岗位筛选标准，并确认可直接用于简历评估，
**未完成该文件前，不得进入后续任何步骤**，否则会导致后续候选人评估结果不准确。

### Step 2. 解析 PDF 简历

必须先从简历文件中提取可用文本。按 `references/pdf-parsing.md` 执行，优先运行 `scripts/extract_resume_text.py`，批量导出文本和解析清单；若需要分批阅读，运行 `scripts/read_resume_texts.py`。

- 若解析结果缺失联系方式、教育、工作经历等关键信息，则标注“解析不足/需人工提供文本”。
- 图片类简历本脚本只标记“需另走 OCR”而不内置 OCR，需先完成 OCR 再喂入解析流程。

### Step 3. 证据提取与候选人评估

1. 从简历原文中提取候选人的基本信息、教育、工作经历、技能、项目、薪资与状态。未体现的信息标注“未体现”，并提取与筛选标准对应的证据。
2. 使用 Step 1 生成的筛选标准作为唯一判断依据，为每位候选人提取画像和证据，必须按照 `references/evidence-rules.md` 里面的规则进行思考，记录 A/B/C 结论，根据候选人的具体情况写一句话概括特点，并生成推荐排序、风险点和下一步动作。

### Step 4. 生成最终材料

生成 Excel 评估表，固定包含候选人总表、证据匹配表、电话确认问题、筛选标准四张工作表。最终 Excel 必须遵守 `references/excel-output.md` 中的规范。按该文档命令运行 `scripts/build_candidate_workbook.py` 将候选人数据写入 xlsx，并运行 `scripts/validate_workbook.py` 校验结构与安全规则，未通过校验不得交付。校验通过不代表业务判断正确，A/B/C 结论仍须以筛选标准和简历证据为依据。
- 其中电话确认问题只收录需要向候选人确认、会影响结论的问题，不重复询问已明确的信息，问题要让候选人说明具体事实。

## 按需加载的文件

| 文件/路径 | 说明 |
| --------- | ---- |
| `scripts/build_candidate_workbook.py` | 将 JSON/候选人数据生成 xlsx，固定创建候选人总表、证据匹配表、电话确认问题与筛选标准四张工作表。Step 4 调用。 |
| `scripts/workbook_contract.py` | 维护 builder 与 validator 共用的工作表、核心字段、结论、样式和枚举规则。修改 Excel 契约时同步检查。 |
| `scripts/extract_resume_text.py` | 支持 PDF/DOCX/图片的文本抽取（优先尝试文本层，图片类仅标记需另走 OCR，不内置 OCR）。Step 2 优先调用。 |
| `scripts/read_resume_texts.py` | 读取 Step 2 导出的文本/清单，按批次打印简历原文，用于分批阅读避免上下文溢出。Step 2 按需调用。 |
| `scripts/validate_workbook.py` | 校验生成的 xlsx 是否满足 `references/excel-output.md` 的结构与安全要求。Step 4 调用。 |
| `references/pdf-parsing.md` | 简历解析流程与常用命令、解析质量判定标准。 |
| `references/evidence-rules.md` | 证据抽取字段、优先级与示例片段位置规范。 |
| `references/excel-output.md` | Excel 输出表结构、字段说明、示例模板说明。 |
| `references/gotchas.md` | 历史踩坑、边界判断与常见纠偏说明（遇到争议先看此文档）。 |
| `templates/job-screening-criteria.md` | 筛选标准模板（Step 1 使用的可填模板）。 |

## 输出物

| 场景       | 必须产出                           | 可选产出                                       |
| -------- | ------------------------------ | ------------------------------------------ |
| 只有岗位要求   | `<JobFolder>/<岗位名称>-简历筛选标准.md` | 无                                          |
| 有岗位要求和简历 | `<ResumeFolder>/候选人评估表.xlsx`   | `<ResumeFolder>/候选人解析与评估明细.md`（仅当需要保留长文本时） |

## Gotchas（历史踩坑记录）

历史踩坑和纠偏规则维护在 `references/gotchas.md`。当简历评估任务涉及相邻行业、overqualified、样本校准、主表表述或B类边界时，应该先阅读该文件，避免再次踩坑！后续如果遇到了新的问题被用户纠偏，记得要同步更新。
