from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import re
import threading
import time
from collections import deque
from typing import Callable

import httpx

from .config import AppSettings, SettingsStore

logger = logging.getLogger(__name__)

_MAX_BODY_BYTES = 18 * 1024
_SCREENING_TOP_N = 5
_TRUNCATION_NOTICE = "内容超过飞书单条消息限制，完整记录请在 Talent Hub 中查看"


class FeishuPushError(Exception):
    def __init__(self, code: int, msg: str, *, attempts: int = 1) -> None:
        super().__init__(msg)
        self.code = code
        self.msg = msg
        self.attempts = attempts


class _RateLimiter:
    def __init__(self) -> None:
        self._starts: deque[float] = deque()
        self._last = -1.0
        self._lock = threading.Lock()

    def wait(self, clock: Callable[[], float], sleep: Callable[[float], None]) -> None:
        with self._lock:
            now = clock()
            delay = max(0.0, self._last + 0.2 - now)
            while self._starts and self._starts[0] <= now - 60:
                self._starts.popleft()
            if len(self._starts) >= 100:
                delay = max(delay, self._starts[0] + 60 - now)
            if delay:
                sleep(delay)
                now = clock()
                while self._starts and self._starts[0] <= now - 60:
                    self._starts.popleft()
            self._last = now
            self._starts.append(now)


_rate_limiter = _RateLimiter()


def gen_sign(timestamp: int, secret: str) -> str:
    string_to_sign = f"{timestamp}\n{secret}"
    hmac_code = hmac.new(string_to_sign.encode("utf-8"), digestmod=hashlib.sha256).digest()
    return base64.b64encode(hmac_code).decode("utf-8")


def _safe_error(kind: str, *, status: int | None = None, code: int | None = None, attempts: int = 1) -> FeishuPushError:
    parts = [kind]
    if status is not None:
        parts.append(f"HTTP {status}")
    if code is not None:
        parts.append(f"业务码 {code}")
    parts.append(f"尝试 {attempts} 次")
    return FeishuPushError(code or 0, "，".join(parts), attempts=attempts)


def send_message(
    settings: AppSettings,
    body: dict,
    *,
    post: Callable[..., object] = httpx.post,
    sleep: Callable[[float], None] = time.sleep,
    clock: Callable[[], float] = time.monotonic,
    limiter: _RateLimiter = _rate_limiter,
) -> None:
    payload = dict(body)
    secret = settings.feishu_sign_secret.strip()
    if secret:
        timestamp = int(time.time())
        payload["timestamp"] = str(timestamp)
        payload["sign"] = gen_sign(timestamp, secret)
    if len(json.dumps(payload, ensure_ascii=False).encode("utf-8")) >= 20 * 1024:
        raise _safe_error("消息构建错误")

    for attempt in range(1, 4):
        limiter.wait(clock, sleep)
        try:
            response = post(
                settings.feishu_webhook_url,
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=10,
            )
        except httpx.ConnectError:
            if attempt < 3:
                sleep(float(2 ** (attempt - 1)))
                continue
            raise _safe_error("网络连接失败", attempts=attempt)
        except httpx.TimeoutException:
            if attempt < 3:
                sleep(float(2 ** (attempt - 1)))
                continue
            raise _safe_error("网络响应不可确认，独立通知重试可能产生重复消息", attempts=attempt)
        except httpx.HTTPError:
            raise _safe_error("网络请求失败", attempts=attempt)

        status = response.status_code
        if status == 429 or status >= 500:
            if attempt < 3:
                delay = float(2 ** (attempt - 1))
                if status == 429:
                    try:
                        delay = max(delay, float(response.headers.get("Retry-After", "")))
                    except (TypeError, ValueError):
                        pass
                sleep(delay)
                continue
            raise _safe_error("飞书临时错误", status=status, attempts=attempt)
        if status >= 400:
            raise _safe_error("飞书请求被拒绝", status=status, attempts=attempt)
        try:
            data = response.json()
        except ValueError:
            raise _safe_error("飞书响应不是合法 JSON", attempts=attempt)
        raw_code = data.get("code", data.get("StatusCode"))
        try:
            code = int(raw_code) if raw_code is not None else -1
        except (TypeError, ValueError):
            code = -1
        if code != 0:
            raise _safe_error("飞书业务错误", code=code, attempts=attempt)
        return


def _text_line(text: str) -> list[dict]:
    return [{"tag": "text", "text": text}]


def _post_body(title: str, lines: list[list[dict]]) -> dict:
    return {"msg_type": "post", "content": {"post": {"zh_cn": {"title": title, "content": lines}}}}


def _body_bytes(body: dict) -> int:
    return len(json.dumps(body, ensure_ascii=False).encode("utf-8"))


def redact_text(text: str) -> str:
    text = re.sub(r"(?<!\d)1[3-9]\d{9}(?!\d)", "[手机号已隐藏]", text)
    text = re.sub(r"(?<!\d)(?:0\d{2,3}[- ]?)?\d{7,8}(?!\d)", "[电话已隐藏]", text)
    return re.sub(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", "[邮箱已隐藏]", text)


def _redact_body(body: dict) -> dict:
    def redact(value):
        if isinstance(value, str):
            return redact_text(value)
        if isinstance(value, list):
            return [redact(item) for item in value]
        if isinstance(value, dict):
            return {key: redact(item) for key, item in value.items()}
        return value
    return redact(body)


def _truncate_utf8(text: str, max_bytes: int) -> str:
    encoded = text.encode("utf-8")
    if len(encoded) <= max_bytes:
        return text
    return encoded[:max_bytes].decode("utf-8", errors="ignore")


def build_call_message(call_title: str, item: dict) -> dict:
    summary = item.get("summary") or {}
    name = summary.get("candidate_name") or item.get("candidate_name") or item.get("title") or "未知候选人"
    narrative = summary.get("narrative") or ""
    title = f"电话初筛完成：{call_title or '未命名任务'}"
    prefix = [
        _text_line(f"候选人：{name}"),
        _text_line("AI 初步整理，请 HR 校对后使用"),
    ]
    body = _redact_body(_post_body(title, prefix + [_text_line(narrative)]))
    if _body_bytes(body) <= _MAX_BODY_BYTES:
        return body
    safe_title = _truncate_utf8(redact_text(title), 512)
    safe_candidate = _truncate_utf8(redact_text(f"候选人：{name}"), 512)
    redacted_narrative = redact_text(narrative)
    empty = _post_body(safe_title, [_text_line(safe_candidate), prefix[1], _text_line(""), _text_line(_TRUNCATION_NOTICE)])
    budget = max(0, _MAX_BODY_BYTES - _body_bytes(empty) - 8)
    return _post_body(
        safe_title,
        [_text_line(safe_candidate), prefix[1], _text_line(_truncate_utf8(redacted_narrative, budget)), _text_line(_TRUNCATION_NOTICE)],
    )


def build_screening_message(
    job_title: str,
    evaluations: list,
    *,
    mode: str = "initial",
    submitted_count: int | None = None,
    cumulative_count: int | None = None,
) -> dict:
    safe_job_title = _truncate_utf8(redact_text(job_title or "未命名岗位"), 512)
    counts = {"A优先约面": 0, "B电话确认": 0, "C不推进": 0}
    for evaluation in evaluations:
        counts[evaluation.conclusion] = counts.get(evaluation.conclusion, 0) + 1
    submitted = len(evaluations) if submitted_count is None else submitted_count
    failed = max(0, submitted - len(evaluations))
    titles = {
        "initial": "简历筛选完成",
        "incremental": "新增简历筛选完成",
        "rescreen": "简历重新筛选完成",
    }
    lines = [
        _text_line(f"本轮提交文件数：{submitted}"),
        _text_line(f"成功评估人数：{len(evaluations)}"),
        _text_line(f"处理失败数：{failed}"),
        _text_line("结论分布：A优先约面 {a} · B电话确认 {b} · C不推进 {c}".format(
            a=counts["A优先约面"], b=counts["B电话确认"], c=counts["C不推进"]
        )),
    ]
    if mode == "incremental":
        lines.append(_text_line(f"岗位累计成功评估人数：{cumulative_count or 0}"))
    if mode == "rescreen":
        lines.append(_text_line("筛选标准已更新，本次为全量重新筛选结果。"))
    priority = [item for item in evaluations if item.conclusion in {"A优先约面", "B电话确认"}]
    if priority:
        for index, evaluation in enumerate(priority[:_SCREENING_TOP_N], start=1):
            candidate_name = _truncate_utf8(str(evaluation.candidate_name or "未知姓名"), 512)
            prefix = f"{index}. {candidate_name}｜{evaluation.conclusion}｜"
            one_line = str(evaluation.one_line or "")
            budget = max(0, _MAX_BODY_BYTES - _body_bytes(_post_body("", lines + [_text_line(prefix), _text_line(_TRUNCATION_NOTICE)])) - 512)
            if len(one_line.encode("utf-8")) > budget:
                one_line = _truncate_utf8(one_line, budget) + _TRUNCATION_NOTICE
            lines.append(_text_line(prefix + one_line))
    else:
        lines.append(_text_line("当前没有建议优先处理的候选人。"))
    lines.append(_text_line("请进入 Talent Hub 查看完整评估并人工复核。"))
    message_title = f"{titles.get(mode, titles['initial'])}：{safe_job_title}"
    body = _redact_body(_post_body(message_title, lines))
    if _body_bytes(body) > _MAX_BODY_BYTES:
        while len(lines) > 6 and _body_bytes(_redact_body(_post_body(message_title, lines))) > _MAX_BODY_BYTES:
            lines.pop(-2)
        body = _redact_body(_post_body(message_title, lines))
    return body


def build_test_message() -> dict:
    return {"msg_type": "text", "content": {"text": "Talent Hub 飞书推送测试成功"}}


def push_with_status(settings_store: SettingsStore, build_fn: Callable[..., dict], *build_args, **build_kwargs) -> tuple[bool, str | None]:
    try:
        settings = settings_store.load()
        if not settings.feishu_push_enabled or not settings.feishu_webhook_url.strip():
            return False, None
        body = build_fn(*build_args, **build_kwargs)
        send_message(settings, body)
        logger.info("飞书推送成功：%s", body.get("msg_type"))
        return True, None
    except FeishuPushError as exc:
        safe = str(exc)
        logger.warning("飞书推送失败：%s", safe)
        return False, f"飞书推送失败：{safe}"
    except Exception:  # noqa: BLE001
        safe = "消息构建错误，尝试 1 次"
        logger.warning("飞书推送失败：%s", safe)
        return False, f"飞书推送失败：{safe}"


def push_if_enabled(settings_store: SettingsStore, build_fn: Callable[..., dict], *build_args, **build_kwargs) -> str | None:
    return push_with_status(settings_store, build_fn, *build_args, **build_kwargs)[1]
