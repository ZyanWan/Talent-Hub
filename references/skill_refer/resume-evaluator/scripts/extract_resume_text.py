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


def import_optional(module_name: str):
    try:
        return __import__(module_name)
    except Exception:
        return None


def normalize_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
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


def extract_pdf_with_pymupdf(path: Path) -> tuple[str, int]:
    fitz = import_optional("fitz")
    if fitz is None:
        return "", 0

    parts: list[str] = []
    with fitz.open(path) as doc:
        page_count = doc.page_count
        for index, page in enumerate(doc, start=1):
            page_text = page.get_text("text")
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
        text, page_count = extract_pdf_with_pymupdf(path)
        if is_resume_text_good_enough(text):
            return text, "pymupdf", True, page_count

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
