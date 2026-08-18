# 简历文件解析策略

## 目标

优先用快速方法覆盖绝大多数简历。普通电子PDF、`.docx`、文本简历约占九成，都可被 `extract_resume_text.py` 的批量文本抽取直接处理，**无需 OCR**。只有图片型简历、扫描件、图片型PDF，以及文本层不足/乱码无法评估的少数情况，才进入 OCR 兜底。推荐 OCR 引擎为 **RapidOCR**（轻量、ONNX 推理、中英文准确度好）；脚本当前不内置 OCR，需另行安装并在图片/解析失败分支调用，详见下文「OCR 兜底」。

## 首选脚本

优先运行 `scripts/extract_resume_text.py`，不要每次重写解析代码。

```bash
python scripts/extract_resume_text.py <ResumeFolder> --output-dir <ResumeFolder>/parsed_text
python scripts/extract_resume_text.py <ResumeFolder> --output-dir <ResumeFolder>/parsed_text --json-output <ResumeFolder>/parsed_text/records.jsonl --jsonl
python scripts/read_resume_texts.py <ResumeFolder>/parsed_text --list
python scripts/read_resume_texts.py <ResumeFolder>/parsed_text --start 1 --count 3
```

批量PDF场景不得把所有简历全文JSON直接打印到终端。优先写入 `parsed_text/*.txt`、`parsed_text/manifest.jsonl` 和可选的 `records.jsonl`，控制台只保留每份文件的状态行，避免编码错误、终端截断和上下文污染。

脚本输出字段：

- `file`：原始简历路径
- `method`：解析方式，例如 `pymupdf`、`pdfplumber`、`docx-xml`、`text`、`image-ocr-required`
- `usable`：文本是否达到评估最低可用质量
- `page_count`：PDF页数，非PDF可为0
- `char_count`：提取文本长度
- `text_path`：完整解析文本路径
- `text`：提取出的正文

解析文本文件使用 `<原文件名>--<来源路径短哈希>.txt` 命名。不同目录或不同扩展名下的同名简历会生成不同文本文件；下游必须读取 manifest 中的 `text_path`，不得根据原文件名自行拼接路径。

当 `usable=false` 或方法为 `pdf-text-layer-insufficient` 时，只能把该简历标为“解析不足/需人工提供文本”，不得继续脑补候选人信息。

## 批量读取边界

`scripts/read_resume_texts.py` 只用于按批次读取完整文本，方便逐份评估。它不做摘要、关键词抽取、预筛、评分或A/B/C分类。

评估仍必须由代理阅读完整解析文本后，按岗位筛选标准逐项提取证据并给出结论。不要让解析脚本替代评估判断。

## 工具优先级

| 场景 | 推荐工具 | 使用策略 |
|---|---|---|
| 普通电子PDF简历 | PyMuPDF | 首选，速度快，适合批量处理 |
| 分栏、表格、排版较复杂 | pdfplumber | 当PyMuPDF文本顺序混乱或信息缺失时补充 |
| `.docx` Word简历 | DOCX XML | 直接读取 `word/document.xml` 文本；`.doc` 不在脚本内置支持范围 |
| 文本简历 | UTF-8/GB18030文本读取 | 用于用户粘贴或导出的 `.txt`、`.md` |
| 复杂版式、需要Markdown/JSON结构 | docling | 深度兜底，不默认首选；脚本未内置时由代理按需补充 |
| 扫描件、图片型PDF、图片简历、文本层不足的PDF | RapidOCR（推荐） | **仅此类才需 OCR**；普通电子PDF/Word/文本约九成无需 OCR。安装与调用见「OCR 兜底」 |
| 简单拆分、合并、元数据读取 | pypdf | 辅助工具，不作为主文本解析器 |

## 解析顺序

1. 按文件类型运行 `extract_resume_text.py`。
2. PDF先用PyMuPDF快速提取全文文本。
3. 判断文本是否足够，例如字符数、邮箱、手机号、教育经历、工作经历等关键信息是否存在。
4. 如果PDF文本不足或顺序混乱，用pdfplumber补充提取。
5. 如果仍无法满足评估需要，标注“解析不足”；图片、扫描件或图片型PDF标注“需OCR/需人工提供文本”，并只在用户明确需要时进入docling或OCR兜底。
6. 对无法可靠解析的简历，在候选人总表中保留文件名、解析方式和风险说明，候选人字段写“未体现”或“解析不足”。

## 依赖缺失处理

脚本会自动探测可选依赖：

- 没有 `fitz` / PyMuPDF 时，跳过PyMuPDF。
- 没有 `pdfplumber` 时，跳过pdfplumber。
- DOCX和文本文件不需要额外依赖。
- 如果PDF依赖都不存在或文本不足，输出 `usable=false`，不要伪造解析结果。

## OCR 兜底（仅图片型 / 解析失败）

绝大多数简历（普通电子PDF、Word、文本，约九成）已由批量文本抽取覆盖，**不要对它们跑 OCR**——既慢又无收益。只有以下情况才触发 OCR：

- 图片型简历（`.png/.jpg/.jpeg/.webp/.tif/.bmp`）
- 扫描件、图片型PDF（PyMuPDF/pdfplumber 抽取文本为空或返回 `pdf-text-layer-insufficient`）
- 文本层存在但严重乱码、无法评估

**推荐引擎：RapidOCR**

- 轻量：基于 ONNX Runtime 推理，无需安装 PaddlePaddle 等重型框架（单 `pip install` 即可）
- 准确：复用 PaddleOCR 权重，对简历常见的中英文混排表现好
- 速度：CPU 单页约 1–3s，百页批处理约 2–5 分钟；有 GPU 时显著更快
- 输入建议 300 DPI，更高 DPI 只增耗时、精度收益递减；批量跑比反复单页更划算

安装：

```bash
pip install rapidocr-onnxruntime
```

接入位置（落到 `extract_resume_text.py`）：

- 图片分支（`IMAGE_SUFFIXES`）：调用 RapidOCR 得到文本，再复用 `is_resume_text_good_enough` 判定 `usable`
- PDF 分支：当 PyMuPDF/pdfplumber 返回 `pdf-text-layer-insufficient` 时，可按需渲染页面为图片后走同一 OCR 路径
- 输出字段沿用现有 `method`（如 `rapidocr`）、`usable`、`text_path`，保证 `read_resume_texts.py` 与下游无需改动

注意：OCR 只是预处理，不替代评估判断；OCR 结果仍需代理按筛选标准逐项提取证据。

## 文本质量判断

需要进入兜底解析的信号：

- 文本长度过短且缺少联系方式、教育、工作经历、项目、技能等核心信号；如果短文本同时包含联系方式和多个核心内容信号，可以视为可用但仍应保留缺失信息
- 缺少手机号、邮箱、姓名、教育、工作经历等核心信息
- 出现大量乱码、重复字符或明显断行错位
- PDF页数不少，但提取文本几乎为空
- 候选人经历段落顺序明显混乱，影响匹配判断

## 输出要求

记录每份简历的解析方式。生成Excel时，把解析方式写入 `候选人总表` 的“解析方式”列；解析不足时，把缺失原因写入“主要风险”或“缺失信息”列。

批量任务应保留 `parsed_text/manifest.jsonl`，其中每行对应一份原始简历，便于追溯原文件、解析方式、页数、字符数、文本路径和错误信息。
