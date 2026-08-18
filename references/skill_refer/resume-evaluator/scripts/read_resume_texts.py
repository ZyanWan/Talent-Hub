#!/usr/bin/env python3
"""Print extracted resume text in controlled batches.

This helper only reads previously extracted text files. It does not summarize,
score, pre-screen, or classify candidates.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def load_manifest(path: Path) -> list[dict]:
    records: list[dict] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


def coerce_records(path: Path) -> list[dict]:
    if path.is_dir():
        manifest = path / "manifest.jsonl"
        if manifest.exists():
            return load_manifest(manifest)
        return [
            {
                "file": str(item),
                "text_path": str(item),
                "method": "text",
                "usable": True,
                "page_count": 0,
                "char_count": item.stat().st_size,
                "error": "",
            }
            for item in sorted(path.glob("*.txt"))
        ]
    return load_manifest(path)


def main() -> int:
    parser = argparse.ArgumentParser(description="Read extracted resume text in batches.")
    parser.add_argument("manifest_or_dir", type=Path, help="parsed_text directory or manifest.jsonl")
    parser.add_argument("--start", type=int, default=1, help="1-based start index")
    parser.add_argument("--count", type=int, default=3, help="Number of resumes to print")
    parser.add_argument("--list", action="store_true", help="List records without printing resume text")
    args = parser.parse_args()

    records = coerce_records(args.manifest_or_dir)
    if not records:
        print("No records found.", file=sys.stderr)
        return 1

    if args.list:
        for index, record in enumerate(records, start=1):
            source = Path(record.get("file") or record.get("text_path") or "")
            usable = "OK" if record.get("usable") else "CHECK"
            print(
                f"{index}\t{usable}\t{record.get('method', '')}\t"
                f"pages={record.get('page_count', 0)}\tchars={record.get('char_count', 0)}\t{source.name}"
            )
        return 0

    start = max(args.start, 1)
    end = min(start + max(args.count, 0) - 1, len(records))
    if start > len(records) or args.count <= 0:
        print("Requested batch is empty.", file=sys.stderr)
        return 1

    for index in range(start, end + 1):
        record = records[index - 1]
        text_path = Path(record.get("text_path") or "")
        source = Path(record.get("file") or text_path)
        if not text_path.exists():
            print(f"===== Resume {index}/{len(records)}: {source.name} =====")
            print("解析文本文件不存在")
            continue
        print(f"===== Resume {index}/{len(records)}: {source.name} =====")
        print(
            f"method={record.get('method', '')}; usable={record.get('usable')}; "
            f"pages={record.get('page_count', 0)}; chars={record.get('char_count', 0)}"
        )
        print(text_path.read_text(encoding="utf-8"))
        print()

    return 0


if __name__ == "__main__":
    sys.exit(main())
