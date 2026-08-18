#!/usr/bin/env python3
"""Transcribe a local audio file with Volcengine's Doubao ASR flash model."""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import uuid
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


ENDPOINT = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash"
RESOURCE_ID = "volc.bigasr.auc_turbo"
MAX_BYTES = 100 * 1024 * 1024
SUPPORTED_SUFFIXES = {".m4a", ".wav", ".mp3", ".ogg", ".opus"}


def load_project_env() -> None:
    """Load simple KEY=VALUE entries from the project's local .env file."""
    env_path = Path(__file__).resolve().parent / ".env"
    if not env_path.is_file():
        return
    for raw_line in env_path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("\"'")
        if key and key not in os.environ:
            os.environ[key] = value


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Transcribe a local audio file with Volcengine Doubao ASR."
    )
    parser.add_argument("audio", type=Path, help="Local M4A, WAV, MP3, OGG, or OPUS file")
    parser.add_argument(
        "-o",
        "--output-dir",
        type=Path,
        default=Path("transcripts"),
        help="Directory for JSON and TXT results (default: transcripts)",
    )
    parser.add_argument(
        "--no-speaker-info",
        action="store_true",
        help="Do not request automatic speaker separation",
    )
    parser.add_argument(
        "--enable-itn",
        action="store_true",
        help="Enable inverse text normalization for numbers and formats",
    )
    parser.add_argument(
        "--enable-punc",
        action="store_true",
        help="Enable punctuation prediction",
    )
    parser.add_argument(
        "--enable-ddc",
        action="store_true",
        help="Enable semantic smoothing; leave off for a research-style raw transcript",
    )
    parser.add_argument(
        "--no-timestamp",
        action="store_true",
        help="Omit timestamps in the output TXT file",
    )
    return parser.parse_args()


def get_authentication() -> tuple[dict[str, str], str]:
    api_key = os.getenv("VOLCENGINE_API_KEY")
    if api_key:
        return {
            "X-Api-Key": api_key,
        }, os.getenv("VOLCENGINE_APP_KEY", api_key)

    app_id = os.getenv("VOLCENGINE_APP_ID")
    access_token = os.getenv("VOLCENGINE_ACCESS_TOKEN")
    if app_id and access_token:
        return {
            "X-Api-App-Key": app_id,
            "X-Api-Access-Key": access_token,
        }, app_id

    raise RuntimeError(
        "Set VOLCENGINE_API_KEY for the new console, or set both "
        "VOLCENGINE_APP_ID and VOLCENGINE_ACCESS_TOKEN for the old console."
    )


def read_audio(path: Path) -> str:
    if not path.is_file():
        raise FileNotFoundError(f"Audio file not found: {path}")
    if path.suffix.lower() not in SUPPORTED_SUFFIXES:
        raise ValueError(
            f"Unsupported audio format: {path.suffix}. "
            f"Expected one of {', '.join(sorted(SUPPORTED_SUFFIXES))}."
        )
    size = path.stat().st_size
    if size > MAX_BYTES:
        raise ValueError(
            f"Audio file is {size / 1024 / 1024:.1f} MB; the flash API limit is 100 MB."
        )
    return base64.b64encode(path.read_bytes()).decode("ascii")


def transcribe(path: Path, options: argparse.Namespace) -> tuple[dict[str, Any], dict[str, str]]:
    audio_data = read_audio(path)
    auth_headers, uid = get_authentication()
    request_id = str(uuid.uuid4())
    payload = {
        "user": {"uid": uid},
        "audio": {"data": audio_data},
        "request": {
            "model_name": "bigmodel",
            "enable_speaker_info": not options.no_speaker_info,
            "enable_itn": options.enable_itn,
            "enable_punc": options.enable_punc,
            "enable_ddc": options.enable_ddc,
        },
    }
    headers = {
        "Content-Type": "application/json",
        "X-Api-Resource-Id": RESOURCE_ID,
        "X-Api-Request-Id": request_id,
        "X-Api-Sequence": "-1",
    }
    headers.update(auth_headers)
    request = Request(
        ENDPOINT,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urlopen(request, timeout=300) as response:
            response_body = response.read().decode("utf-8")
            response_headers = {key.lower(): value for key, value in response.headers.items()}
    except HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Volcengine HTTP {error.code}: {body}") from error
    except URLError as error:
        raise RuntimeError(f"Could not reach Volcengine: {error.reason}") from error

    try:
        result = json.loads(response_body)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"Volcengine returned invalid JSON: {response_body[:500]}") from error

    status_code = response_headers.get("x-api-status-code", "")
    if status_code != "20000000":
        message = response_headers.get("x-api-message", "unknown error")
        raise RuntimeError(f"Volcengine recognition failed: {status_code} {message}; {result}")
    return result, response_headers


def write_outputs(result: dict[str, Any], headers: dict[str, str], source: Path, output_dir: Path, options: argparse.Namespace) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    stem = source.stem
    json_path = output_dir / f"{stem}.json"
    text_path = output_dir / f"{stem}.txt"
    json_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    utterances = result.get("result", {}).get("utterances", [])
    source_label = "\u6e90\u6587\u4ef6"
    unknown_label = "\u672a\u77e5"
    speaker_label = "\u8bf4\u8bdd\u4eba"
    lines = [f"{source_label}: {source}", f"Log ID: {headers.get('x-tt-logid', '')}", ""]
    for utterance in utterances:
        start = utterance.get("start_time", 0) / 1000
        end = utterance.get("end_time", 0) / 1000
        additions = utterance.get("additions", {})
        speaker = utterance.get(
            "speaker_id",
            utterance.get("speaker", additions.get("speaker", unknown_label)),
        )
        text = utterance.get("text", "").strip()
        if options.no_timestamp:
            lines.append(f"{speaker_label}{speaker}: {text}")
        else:
            lines.append(f"[{start:09.3f}-{end:09.3f}] {speaker_label}{speaker}: {text}")
    if not utterances:
        lines.append(result.get("result", {}).get("text", ""))
    text_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"JSON: {json_path}")
    print(f"TXT:  {text_path}")


def main() -> int:
    load_project_env()
    args = parse_args()
    try:
        result, headers = transcribe(args.audio, args)
        write_outputs(result, headers, args.audio, args.output_dir, args)
    except (FileNotFoundError, RuntimeError, ValueError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
