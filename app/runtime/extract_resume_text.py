#!/usr/bin/env python3
"""Extract resume text from common resume files with fast fallbacks.

This script only performs text extraction and parsing quality checks. It does
not summarize, pre-screen, score, or classify candidates.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
import zipfile
from pathlib import Path
from xml.etree import ElementTree


EMAIL_RE = re.compile(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}")
PHONE_RE = re.compile(r"(?:\+?86[- ]?)?(?:1[3-9]\d{9}|\d{3,4}[- ]?\d{7,8})")
TEXT_SUFFIXES = {".txt", ".md", ".markdown"}
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp"}
SUPPORTED_SUFFIXES = {".pdf", ".docx"} | TEXT_SUFFIXES | IMAGE_SUFFIXES
SKIP_DIR_NAMES = {"parsed_text", "__pycache__", ".git", ".svn", ".hg"}
MAX_DOCX_XML_BYTES = 20 * 1024 * 1024
# PDF 水印/防伪条被当作文本提取时，通常是"无空格、纯 ASCII、字母数字混合"的长串，且在文中反复出现
_ASCII_MIXED_LINE_RE = re.compile(r"^[0-9A-Za-z_\-~+/]{15,}$")
# 中文简历里被 PDF 字距错误拆开的英文单词片段（前段 2-5 字符、后段小写开头），如 "Li sting"、"Inv estment"
_SPLIT_WORD_RE = re.compile(r"([A-Z][A-Za-z]{1,4}) ([a-z]{2,})")
# 大写缩写与数字粘连，如 "TR 4" -> "TR4"、"4 A" -> "4A"；数字后跟小数点（版本号 "IP 2.0"）不合并
_NUMBER_JOIN_RE = re.compile(r"\b([A-Z]{1,4}) ([0-9]+[A-Za-z]*)(?!\.)\b")
_NUMBER_PREFIX_JOIN_RE = re.compile(r"\b([0-9]+) ([A-Z]{1,4})\b")
# 连续大写单字母被拆开，如 "O A" -> "OA"、"F T O" -> "FTO"
_ACRONYM_SPACE_RE = re.compile(r"(?<![A-Za-z0-9])([A-Z])(?: ([A-Z]))+(?![A-Za-z0-9])")
# 跨行断词：行尾 1-3 个字母 + 下一行小写开头，如 "Lis\n" + "ting" -> "Listing"
_LINE_BREAK_RE = re.compile(r"(?<![A-Za-z0-9])([A-Za-z]{1,3})\n([a-z]{2,})")
# 完整短词不做合并，避免误伤 "My name" 这类正常英文
_COMMON_SHORT_WORDS = frozenset({
    "a", "ab", "an", "as", "at", "be", "big", "but", "by", "can", "did", "do", "for",
    "from", "get", "go", "has", "had", "he", "her", "him", "his", "hot", "how",
    "i", "if", "in", "is", "it", "its", "may", "me", "my", "new", "no", "not",
    "of", "old", "on", "one", "or", "our", "out", "own", "per", "put", "red",
    "san", "say", "see", "set", "she", "so", "ten", "the", "to", "top", "two",
    "up", "us", "use", "way", "we", "who", "why", "you",
})
# 常见英文词尾片段：同行断裂时若后片段是这些词尾，视为单词被拆（如 "Inv"+"estment"、"Limit"+"ed"）
_WORD_TAILS = frozenset({
    "able", "ance", "ed", "ence", "er", "est", "estment", "field", "ful",
    "ible", "ied", "ies", "ing", "ity", "ive", "land", "less", "ly", "ment",
    "ness", "ous", "port", "shire", "side", "sion", "ted", "tion", "ville",
})


def import_optional(module_name: str):
    try:
        return __import__(module_name)
    except Exception:
        return None


def _is_watermark_candidate(line: str) -> bool:
    """判断一行是否疑似水印乱码：无空格、无中文、纯 ASCII 字母数字混合长串。"""
    if not line or " " in line or re.search(r"[\u3400-\u9fff]", line):
        return False
    if not _ASCII_MIXED_LINE_RE.fullmatch(line):
        return False
    return bool(re.search(r"[A-Za-z]", line)) and bool(re.search(r"[0-9]", line))


def _remove_watermark_lines(text: str) -> str:
    """删除在文档中重复出现的疑似水印乱码行。"""
    lines = text.split("\n")
    counts: dict[str, int] = {}
    for line in lines:
        if _is_watermark_candidate(line):
            counts[line] = counts.get(line, 0) + 1
    repeated = {line for line, count in counts.items() if count >= 2}
    if not repeated:
        return text
    return "\n".join(line for line in lines if line not in repeated)


def _repair_split_lines(text: str) -> str:
    """修复跨行被拆开的英文单词，如行尾 "Lis" + 换行 + "ting" -> "Listing"。
    仅当断裂处至少一侧紧邻中文才合并（中英混排跨行断词），避免误并纯英文正常换行。"""

    def join_line(match: re.Match) -> str:
        first = match.group(1)
        if first.casefold() in _COMMON_SHORT_WORDS:
            return match.group(0)
        before = text[: match.start()].rstrip()
        after = text[match.end() :].lstrip()
        left = before[-1] if before else ""
        right = after[0] if after else ""
        if not re.search(r"[\u3400-\u9fff]", left + right):
            return match.group(0)
        return first + match.group(2)

    return _LINE_BREAK_RE.sub(join_line, text)


def _repair_split_words(line: str) -> str:
    """修复 PDF 提取中被空格拆开的单词：缩写粘连、中英混排及英文断词。"""
    line = _NUMBER_JOIN_RE.sub(r"\1\2", line)
    line = _NUMBER_PREFIX_JOIN_RE.sub(r"\1\2", line)
    line = _ACRONYM_SPACE_RE.sub(lambda match: match.group(0).replace(" ", ""), line)

    def join_break(match: re.Match) -> str:
        first, second = match.group(1), match.group(2)
        if first.casefold() in _COMMON_SHORT_WORDS:
            return match.group(0)
        # 断裂处至少一侧紧邻中文/行边界，或后片段是常见英文词尾（英文简历场景），才视为断词
        before = line[: match.start()].rstrip()
        after = line[match.end() :].lstrip()
        left = before[-1] if before else ""
        right = after[0] if after else ""
        cjk_adjacent = bool(re.search(r"[\u3400-\u9fff]", left + right))
        if cjk_adjacent or second.casefold() in _WORD_TAILS:
            return first + second
        return match.group(0)

    return _SPLIT_WORD_RE.sub(join_break, line)


def normalize_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    # 移除 PDF 文本层嵌入的 NUL 等不可见控制字符（保留换行与制表符）
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"(?<=[\u3400-\u9fff]) (?=[\u3400-\u9fff])", "", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = _remove_watermark_lines(text)
    text = _repair_split_lines(text)
    text = "\n".join(_repair_split_words(line) for line in text.split("\n"))
    return text.strip()


def is_resume_text_good_enough(text: str) -> bool:
    compact = re.sub(r"\s+", "", text or "")
    if len(compact) < 80:
        return False

    garbled_markers = compact.count("?") + compact.count("�")
    if garbled_markers >= 5 and garbled_markers / max(len(compact), 1) > 0.03:
        return False

    contact_signals = 0
    for pattern in [EMAIL_RE, PHONE_RE]:
        if pattern.search(text):
            contact_signals += 1

    content_signals = 0
    for pattern in [
        re.compile(r"教育|学历|本科|硕士|博士|大专|学校|院校|education|degree|university", re.I),
        re.compile(r"工作|经历|项目|职责|任职|公司|experience|employment|company|project|responsib", re.I),
        re.compile(r"技能|证书|语言|工具|系统|skill|certificate|language|tool|system", re.I),
    ]:
        if pattern.search(text):
            content_signals += 1

    if len(compact) >= 200:
        return content_signals >= 2 or (content_signals >= 1 and contact_signals >= 1)

    return content_signals >= 2 and contact_signals >= 1


def extract_pdf_with_pypdf(path: Path) -> tuple[str, int]:
    pypdf = import_optional("pypdf")
    if pypdf is None:
        return "", 0

    parts: list[str] = []
    reader = pypdf.PdfReader(path, strict=False)
    page_count = len(reader.pages)
    for index, page in enumerate(reader.pages, start=1):
        page_text = page.extract_text()
        if page_text:
            parts.append(f"===== Page {index} =====\n{page_text}")
    return normalize_text("\n\n".join(parts)), page_count


def extract_pdf_with_pdfplumber(path: Path) -> tuple[str, int]:
    pdfplumber = import_optional("pdfplumber")
    if pdfplumber is None:
        return "", 0

    parts: list[str] = []
    with pdfplumber.open(path) as pdf:
        page_count = len(pdf.pages)
        for index, page in enumerate(pdf.pages, start=1):
            page_text = page.extract_text()
            if page_text:
                parts.append(f"===== Page {index} =====\n{page_text}")
    return normalize_text("\n\n".join(parts)), page_count


def extract_docx_text(path: Path) -> str:
    paragraphs: list[str] = []
    namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}

    with zipfile.ZipFile(path) as docx:
        document_info = docx.getinfo("word/document.xml")
        if document_info.file_size > MAX_DOCX_XML_BYTES:
            raise ValueError("DOCX document.xml exceeds the 20 MB safety limit")
        with docx.open("word/document.xml") as document_xml:
            root = ElementTree.parse(document_xml).getroot()

    for para in root.findall(".//w:p", namespace):
        texts = [node.text or "" for node in para.findall(".//w:t", namespace)]
        paragraph = "".join(texts).strip()
        if paragraph:
            paragraphs.append(paragraph)

    return normalize_text("\n".join(paragraphs))


def extract_text_file(path: Path) -> str:
    for encoding in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            return normalize_text(path.read_text(encoding=encoding))
        except UnicodeDecodeError:
            continue
    return normalize_text(path.read_text(errors="replace"))


def extract_file(path: Path) -> tuple[str, str, bool, int]:
    suffix = path.suffix.lower()

    if suffix == ".pdf":
        text, page_count = extract_pdf_with_pypdf(path)
        if is_resume_text_good_enough(text):
            return text, "pypdf", True, page_count

        fallback, fallback_page_count = extract_pdf_with_pdfplumber(path)
        if is_resume_text_good_enough(fallback):
            return fallback, "pdfplumber", True, fallback_page_count

        return fallback or text, "pdf-text-layer-insufficient", False, fallback_page_count or page_count

    if suffix == ".docx":
        text = extract_docx_text(path)
        return text, "docx-xml", is_resume_text_good_enough(text), 0

    if suffix in TEXT_SUFFIXES:
        text = extract_text_file(path)
        return text, "text", is_resume_text_good_enough(text), 0

    if suffix in IMAGE_SUFFIXES:
        return "", "image-ocr-required", False, 0

    return "", f"unsupported-{suffix.lstrip('.') or 'file'}", False, 0


def iter_input_files(paths: list[Path]) -> list[Path]:
    files: list[Path] = []
    for path in paths:
        if path.is_dir():
            files.extend(
                item
                for item in sorted(path.rglob("*"))
                if is_supported_input_file(item)
            )
        elif is_supported_input_file(path):
            files.append(path)
    return files


def is_supported_input_file(path: Path) -> bool:
    if not path.is_file() or path.name.startswith("~$"):
        return False
    if any(part in SKIP_DIR_NAMES for part in path.parts):
        return False
    return path.suffix.lower() in SUPPORTED_SUFFIXES


def normalized_source_key(source: Path) -> str:
    try:
        source_key = str(source.resolve(strict=False))
    except OSError:
        source_key = str(source.absolute())
    if sys.platform == "win32":
        source_key = source_key.casefold()
    return source_key


def source_output_name(source: Path) -> str:
    source_key = normalized_source_key(source)
    digest = hashlib.sha256(source_key.encode("utf-8")).hexdigest()[:12]
    return f"{source.stem}--{digest}.txt"


def atomic_write_text(target: Path, text: str) -> None:
    descriptor, temp_name = tempfile.mkstemp(
        prefix=f".{target.name}.",
        suffix=".tmp",
        dir=str(target.parent),
    )
    os.close(descriptor)
    temp_path = Path(temp_name)
    try:
        temp_path.write_text(text, encoding="utf-8")
        os.replace(temp_path, target)
    finally:
        if temp_path.exists():
            temp_path.unlink()


def write_outputs(records: list[dict], output_dir: Path | None) -> None:
    if output_dir is None:
        return

    output_dir.mkdir(parents=True, exist_ok=True)
    planned_targets: dict[Path, str] = {}
    for record in records:
        source = Path(record["file"])
        target = output_dir / source_output_name(source)
        source_key = normalized_source_key(source)
        existing_source_key = planned_targets.get(target)
        if existing_source_key is not None and existing_source_key != source_key:
            raise RuntimeError(
                f"Output name collision for source {source}: {target}"
            )
        planned_targets[target] = source_key
        record["text_path"] = str(target)

    for record in records:
        target = Path(record["text_path"])
        atomic_write_text(target, record["text"])


def write_jsonl(records: list[dict], path: Path, include_text: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for record in records:
            payload = dict(record)
            if not include_text:
                payload.pop("text", None)
            handle.write(json.dumps(payload, ensure_ascii=False) + "\n")


def write_manifest(records: list[dict], output_dir: Path | None) -> None:
    if output_dir is None:
        return
    manifest_path = output_dir / "manifest.jsonl"
    write_jsonl(records, manifest_path, include_text=False)


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract text from resume files.")
    parser.add_argument("paths", nargs="+", type=Path, help="Resume files or folders")
    parser.add_argument("--output-dir", type=Path, help="Optional folder for .txt outputs")
    parser.add_argument("--json", action="store_true", help="Print JSON records")
    parser.add_argument("--json-output", type=Path, help="Write records to JSON or JSONL instead of printing full text")
    parser.add_argument("--jsonl", action="store_true", help="Use JSON Lines format with --json-output")
    parser.add_argument("--include-text", action="store_true", help="Include full extracted text in --json-output records")
    args = parser.parse_args()

    records: list[dict] = []
    for path in iter_input_files(args.paths):
        try:
            text, method, usable, page_count = extract_file(path)
            error = ""
        except Exception as exc:
            text, method, usable, page_count = "", "error", False, 0
            error = f"{type(exc).__name__}: {exc}"
        records.append(
            {
                "file": str(path),
                "method": method,
                "usable": usable,
                "page_count": page_count,
                "char_count": len(text),
                "error": error,
                "text_path": "",
                "text": text,
            }
        )

    write_outputs(records, args.output_dir)
    write_manifest(records, args.output_dir)

    if args.json_output:
        if args.jsonl:
            write_jsonl(records, args.json_output, include_text=args.include_text)
        else:
            payload = records if args.include_text else [{k: v for k, v in record.items() if k != "text"} for record in records]
            args.json_output.parent.mkdir(parents=True, exist_ok=True)
            args.json_output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    if args.json:
        print(json.dumps(records, ensure_ascii=False, indent=2))
    else:
        for record in records:
            status = "OK" if record["usable"] else "CHECK"
            print(
                f"{status}\t{record['method']}\tpages={record['page_count']}\tchars={record['char_count']}\t{record['file']}"
            )

    return 0 if records else 1


if __name__ == "__main__":
    sys.exit(main())
