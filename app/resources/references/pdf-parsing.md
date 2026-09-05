# 简历文件解析策略（应用实现）

> 本文档描述 Talent-Hub 应用中简历解析的实际实现，基于 `app/pipeline.py` 与 `app/runtime/extract_resume_text.py` 的代码事实编写，非技能工作流说明。
> 应用内的解析是全自动的：评估流程调用 `extract_document()` 完成提取，无需人工运行命令。

## 应用内解析流程

评估任务运行时，`pipeline.py` 对每份简历调用 `extract_document(path, settings, resume=True)`，顺序如下：

1. **PDF 页数限制**：先用 pypdfium2 统计页数；计页成功且超过 `MAX_PDF_PAGES = 100` 页时拒绝，记录错误 `pdf-page-limit`。计页异常时当前流程继续尝试文本提取。
2. **文本层提取**：调用 `extract_file()`：
   - PDF：先用 **pypdf** 快速提取全文；文本通过质量判断则采用；否则用 **pdfplumber** 补充提取；两者都不足时标记为 `pdf-text-layer-insufficient`，`usable=False`。
   - `.docx`：直接解析 `word/document.xml`（有 20 MB 安全上限），方法 `docx-xml`。
   - `.txt/.md/.markdown`：按 `utf-8-sig → utf-8 → gb18030` 顺序尝试解码；均失败时使用平台默认编码并以替换字符处理非法字节，方法 `text`。
   - 图片（`.png/.jpg/.jpeg/.webp/.tif/.tiff/.bmp`）：不在此步提取，标记 `image-ocr-required`，`usable=False`。
   - 各提取路径（含下方 OCR 兜底）返回前统一经 `normalize_text()` 清洗（详见"提取后文本清洗"），清洗后文本再进入质量判断。
3. **质量门槛**：文本是否可用由 `is_resume_text_good_enough(text)` 判定——去空白后长度 ≥ 80；乱码符号占比不超阈值；存在联系方式信号（手机号/邮箱）与内容信号（教育、工作、技能等关键词），长文本（≥200 字符）条件适当放宽。
4. **OCR 兜底**：仅当文件是图片，或 PDF 文本不足（`not usable` 或长度 < 80 字符）时触发 **Tesseract** OCR：
   - 图片：`pytesseract.image_to_string()` 直接识别。
   - 扫描 PDF：用 pypdfium2 将每页渲染为图片（约 220 DPI）后走同一 OCR 路径。
   - 方法记为 `tesseract-image-ocr` / `tesseract-pdf-ocr`；OCR 后再次用质量门槛判定 `usable`。
5. **OCR 不可用**：未检测到 Tesseract 或缺少中英文语言包时，提取失败原因写入 `error`，该简历评估跳过，任务错误列表记录 `<文件名>：<原因>`。

## 提取后文本清洗（normalize_text）

`normalize_text()` 是 `extract_resume_text.py` 中所有提取路径（pypdf / pdfplumber / docx / txt）与 OCR 路径共用的最终整理函数，依次执行：

1. **换行归一**：`\r\n`、`\r` 统一为 `\n`。
2. **移除控制字符**：清除 PDF 文本层嵌入的 NUL 等不可见控制字符（保留换行与制表符）。
3. **空白归一**：连续空格/制表符合并为单个空格；移除中文字符之间被 PDF 误插的空格。
4. **压缩空行**：连续 3 个及以上换行压为 2 个。
5. **水印行过滤**：删除“无空格、无中文、仅含 ASCII 字母、数字、`_ - ~ + /`、长度 ≥ 15、同时包含字母与数字，且在全文重复出现 ≥ 2 次”的行。
6. **跨行断词修复**：行尾 1-3 个字母 + 下一行小写开头，且断裂处至少一侧紧邻中文时合并（`Lis` + 换行 + `ting` → `Listing`）。纯英文正常换行（如 `Are` + 换行 + `you`）不合并。
7. **同行断词修复**：
   - 大写缩写与数字粘连：`TR 4` → `TR4`；数字后紧跟小数点的版本号（`IP 2.0`）不合并。
   - 连续大写单字母合并：`O A` → `OA`、`F T O` → `FTO`。
   - 中英混排断词、或后片段为常见英文词尾（ed / ing / estment 等 28 个）时合并：`Li sting` → `Listing`、`Inv estment` → `Investment`、`Water ing` → `Watering`。
   - 前片段为常见短词（My / in / the 等约 60 个）时不合并，避免误伤正常英文（如 `My name`、`AB test`、`New york`）。

清洗规则均以"低误伤"为约束：同一规则尽可能同时要求格式特征与语义白名单/黑名单。已知无法可靠自动修复的残留（如 `no cr edit`、`Hudder sfield` 这类字母错乱或超长片段）保留原样，交由模型语义理解纠错。

## Tesseract 配置

- 设置项 `ocr_executable` 指定 Tesseract 程序路径；未配置时按 `TESSERACT_CMD` 环境变量 → `PATH` → 平台常见安装目录（Windows 的 `ProgramFiles`、`ProgramFiles(x86)`、`LOCALAPPDATA` 下 `Tesseract-OCR`，macOS 的 `/opt/homebrew/bin/tesseract`、`/usr/local/bin/tesseract`）自动探测。
- 语言包自动探测：同时存在 `chi_sim` 与 `eng` 时使用 `chi_sim+eng`，否则退回可用单语言；两者都缺失时报错。
- 项目安装与打包清单包含 pypdfium2、pytesseract、Pillow、pypdf 和 pdfplumber；解析代码在 pypdf 或 pdfplumber 模块不可用时跳过对应提取方式。

## 解析不足的处理

`usable=False` 的简历不会进入大模型评估：

- 解析结果（`method`、`page_count`、`char_count`、`error` 等）写入任务目录的 `解析清单.json`，每行对应一份简历。
- 该简历不会产出评估结论，任务 errors 中记录原因；界面据此提示"解析不足/需人工提供文本"，不得脑补候选人信息。

## 任务运行时的落盘位置

评估任务（`pipeline.py` `_run`）在任务数据目录下保留以下文件：

- `解析清单.json`：全部简历的解析方式、页数、字符数、错误信息。
- `筛选标准.json`、`评估结果.json`、`候选人评估表.xlsx`：评估产物。
- `parsed/<原文件名>--<源路径短哈希12位>.txt`：勾选"保留解析文本"（`retain_resume_text`）时保存的解析全文，命名与 `extract_resume_text.py` 的 `source_output_name()` 一致；同名不同来源的简历哈希不同、互不覆盖。

## 独立命令行工具（开发/调试用）

应用运行时不需要人工调用，但 `app/runtime/` 下保留了 CLI，便于批量导出与抽查：

```bash
python -m app.runtime.extract_resume_text <简历目录> --output-dir parsed_text
python -m app.runtime.extract_resume_text <简历目录> --jsonl --json-output records.jsonl
```

## 返回值与输出字段

`extract_file()` 返回四元组 `(text, method, usable, page_count)`。`pipeline.extract_document()` 返回包含 `text`、`method`、`usable`、`page_count`、`char_count` 和 `error` 的字典。独立 CLI 在此基础上组装以下记录字段：

| 字段 | 说明 |
|---|---|
| `file` | 原始简历路径 |
| `method` | 解析方式：`pypdf` / `pdfplumber` / `docx-xml` / `text` / `tesseract-image-ocr` / `tesseract-pdf-ocr` / `pdf-text-layer-insufficient` / `image-ocr-required` / `pdf-page-limit` / `error` |
| `usable` | 文本是否达到评估最低可用质量 |
| `page_count` | PDF 页数，非 PDF 为 0 |
| `char_count` | 提取文本长度 |
| `text_path` | CLI 输出目录中的文本路径；任务流程仅在开启保留解析文本时记录对应文件名 |
| `error` | 提取失败原因，成功为空 |
| `text` | 提取出的正文（仅在解析阶段内部使用） |
