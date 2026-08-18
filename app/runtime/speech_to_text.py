"""语音转写：调用火山引擎 ASR 极速版接口，将本地音频文件转写为文本。

仅负责音频校验、接口调用与转写文本渲染，不包含业务持久化逻辑。
"""

from __future__ import annotations

import base64
import uuid
from pathlib import Path
from typing import Any

import httpx

ENDPOINT = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash"
RESOURCE_ID = "volc.bigasr.auc_turbo"
MAX_BYTES = 100 * 1024 * 1024
SUPPORTED_SUFFIXES = {".m4a", ".wav", ".mp3", ".ogg", ".opus"}
HTTP_TIMEOUT = 300  # ASR 文件转写较慢，使用独立超时，不沿用项目通用请求超时


def validate_audio(path: Path) -> None:
    """校验音频文件：存在、后缀受支持且大小不超过 100MB。"""
    if not path.is_file():
        raise FileNotFoundError(f"音频文件不存在：{path}")
    if path.suffix.lower() not in SUPPORTED_SUFFIXES:
        raise ValueError(f"不支持的文件格式：{path.suffix}")
    if path.stat().st_size > MAX_BYTES:
        raise ValueError("音频文件超过 100MB 上限。")


def transcribe_audio(path: Path, api_key: str, *, enable_speaker_info: bool = True) -> dict[str, Any]:
    """转写本地音频文件，返回 {"utterances": [...], "raw": 原始响应 JSON}。"""
    validate_audio(path)
    audio_data = base64.b64encode(path.read_bytes()).decode("ascii")
    payload = {
        "user": {"uid": api_key},
        "audio": {"data": audio_data},
        "request": {
            "model_name": "bigmodel",
            "enable_speaker_info": enable_speaker_info,
            "enable_itn": True,   # 数字归一（薪资"一万五"场景必需）
            "enable_punc": True,  # 标点
            "enable_ddc": False,  # 语义顺滑关闭，保留口语原文
        },
    }
    headers = {
        "X-Api-Key": api_key,
        "X-Api-Resource-Id": RESOURCE_ID,
        "X-Api-Request-Id": uuid.uuid4().hex,
        "X-Api-Sequence": "-1",
        "Content-Type": "application/json",
    }
    with httpx.Client(timeout=HTTP_TIMEOUT) as client:
        response = client.post(ENDPOINT, headers=headers, json=payload)
    if response.status_code >= 400:
        detail = response.text[:500]
        raise RuntimeError(f"语音转写服务返回 HTTP {response.status_code}：{detail}")
    result = response.json()
    status_code = response.headers.get("x-api-status-code", "")
    if status_code != "20000000":
        message = response.headers.get("x-api-message", "未知错误")
        raise RuntimeError(f"语音转写失败：{status_code} {message}；{response.text[:500]}")
    return {
        "utterances": result.get("result", {}).get("utterances", []),
        "raw": result,
    }


def render_transcript(utterances: list[dict], *, with_timestamp: bool = True) -> str:
    """把识别结果的 utterances 渲染为逐行文本；无内容时返回空字符串。"""
    lines: list[str] = []
    for utterance in utterances:
        additions = utterance.get("additions") or {}
        speaker = utterance.get(
            "speaker_id",
            utterance.get("speaker", additions.get("speaker", "未知")),
        )
        text = utterance.get("text", "").strip()
        if with_timestamp:
            start = utterance.get("start_time", 0) / 1000
            end = utterance.get("end_time", 0) / 1000
            lines.append(f"[{start:09.3f}-{end:09.3f}] 说话人{speaker}: {text}")
        else:
            lines.append(f"说话人{speaker}: {text}")
    return "\n".join(lines)
