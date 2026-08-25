from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import time
from typing import Callable

import httpx

from .config import AppSettings, SettingsStore

logger = logging.getLogger(__name__)

_MAX_BODY_BYTES = 18 * 1024  # 飞书限制 20KB，留余量
_SCREENING_TOP_N = 5
_CALL_FIELD_LIMIT = 6


class FeishuPushError(Exception):
    def __init__(self, code: int, msg: str) -> None:
        super().__init__(f"code={code} msg={msg}")
        self.code = code
        self.msg = msg


def gen_sign(timestamp: int, secret: str) -> str:
    string_to_sign = f"{timestamp}\n{secret}"
    hmac_code = hmac.new(string_to_sign.encode("utf-8"), digestmod=hashlib.sha256).digest()
    return base64.b64encode(hmac_code).decode("utf-8")


def send_message(settings: AppSettings, body: dict) -> None:
    payload = dict(body)
    secret = settings.feishu_sign_secret.strip()
    if secret:
        timestamp = int(time.time())
        payload["timestamp"] = str(timestamp)
        payload["sign"] = gen_sign(timestamp, secret)
    try:
        response = httpx.post(
            settings.feishu_webhook_url,
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=10,
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise FeishuPushError(0, f"网络请求失败：{exc}") from exc
    try:
        data = response.json()
    except ValueError as exc:
        raise FeishuPushError(0, f"响应不是合法 JSON：{response.text[:200]}") from exc
    # 注意：飞书成功时 code 为 0，不能使用 `or -1` 兜底（0 会被当作假值）
    raw_code = data.get("code", data.get("StatusCode"))
    code = int(raw_code) if raw_code is not None else -1
    if code != 0:
        raise FeishuPushError(code, str(data.get("msg", data.get("StatusMessage", "未知错误"))))


def _text_line(text: str) -> list[dict]:
    return [{"tag": "text", "text": text}]


def _post_body(title: str, lines: list[list[dict]]) -> dict:
    return {"msg_type": "post", "content": {"post": {"zh_cn": {"title": title, "content": lines}}}}


def _body_bytes(body: dict) -> int:
    return len(json.dumps(body, ensure_ascii=False).encode("utf-8"))


def _fit_post(title: str, header_lines: list[list[dict]], candidate_lines: list[list[dict]]) -> dict:
    for count in range(len(candidate_lines), -1, -1):
        lines = header_lines + candidate_lines[:count]
        omitted = len(candidate_lines) - count
        if omitted:
            lines.append(_text_line(f"（篇幅所限，其余 {omitted} 人已省略）"))
        body = _post_body(title, lines)
        if _body_bytes(body) <= _MAX_BODY_BYTES:
            return body
    return _post_body(title, header_lines)


def build_screening_message(job_title: str, evaluations: list) -> dict:
    counts = {"A优先约面": 0, "B电话确认": 0, "C不推进": 0}
    for evaluation in evaluations:
        counts[evaluation.conclusion] = counts.get(evaluation.conclusion, 0) + 1
    header_lines = [
        _text_line(f"候选人总数：{len(evaluations)}"),
        _text_line(
            "结论分布：A优先约面 {a} · B电话确认 {b} · C不推进 {c}".format(
                a=counts["A优先约面"], b=counts["B电话确认"], c=counts["C不推进"]
            )
        ),
    ]
    candidate_lines = []
    for index, evaluation in enumerate(evaluations[:_SCREENING_TOP_N], start=1):
        candidate_lines.append(
            _text_line(
                f"{index}. {evaluation.candidate_name or '未知姓名'}｜{evaluation.conclusion}｜证据等级：{evaluation.evidence_level}"
            )
        )
    return _fit_post(f"简历筛选完成：{job_title or '未命名岗位'}", header_lines, candidate_lines)


def build_call_message(call_title: str, items: list) -> dict:
    header_lines = [_text_line(f"完成条目：{len(items)}")]
    candidate_lines = []
    for item in items:
        summary = item.get("summary") or {}
        name = summary.get("candidate_name") or item.get("title") or "未知候选人"
        fields = summary.get("fields") or []
        confirmed = [
            field for field in fields
            if isinstance(field, dict) and field.get("status") == "已确认" and field.get("value")
        ]
        parts = [f"{field.get('label') or field.get('key') or '字段'}：{field.get('value')}" for field in confirmed[:_CALL_FIELD_LIMIT]]
        detail = "；".join(parts) if parts else "无已确认字段"
        candidate_lines.append(_text_line(f"{name}｜{detail}"))
    return _fit_post(f"电话初筛完成：{call_title or '未命名任务'}", header_lines, candidate_lines)


def build_test_message() -> dict:
    return {"msg_type": "text", "content": {"text": "Talent Hub 飞书推送测试成功"}}


def push_if_enabled(settings_store: SettingsStore, build_fn: Callable[..., dict], *build_args) -> str | None:
    """惰性构建 + 发送：构建与发送的任何异常都在内部捕获，绝不向外抛。

    返回 None 表示未推送或推送成功；返回字符串表示失败提示（并入任务 errors）。
    """
    try:
        settings = settings_store.load()
        if not settings.feishu_push_enabled or not settings.feishu_webhook_url.strip():
            return None
        body = build_fn(*build_args)
        send_message(settings, body)
        logger.info("飞书推送成功：%s", body.get("msg_type"))
        return None
    except Exception as exc:  # noqa: BLE001 保护伞：绝不让推送影响任务状态
        logger.warning("飞书推送失败：%s", exc)
        return f"飞书推送失败：{exc}"
