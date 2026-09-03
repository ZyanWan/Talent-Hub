from __future__ import annotations

import json
import logging
import random
import re
import threading
import time
from typing import Any

import httpx

from .config import AppSettings

logger = logging.getLogger(__name__)


class LLMError(RuntimeError):
    pass


class LLMRequestError(LLMError):
    def __init__(self, message: str, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.retryable = retryable


class LLMResponseError(LLMError):
    """模型已响应，但输出被服务端截断或过滤，原输入重试无法修复。"""


def prompt_json(value: Any) -> str:
    """把动态数据序列化为 JSON，并转义可伪造文本边界的尖括号。"""
    return json.dumps(value, ensure_ascii=False).replace("<", "\\u003c").replace(">", "\\u003e")


def extract_json_object(content: str) -> dict[str, Any]:
    text = content.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.I)
        text = re.sub(r"\s*```$", "", text)
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start < 0 or end <= start:
            raise LLMError("模型响应中没有可解析的 JSON 对象。")
        try:
            value = json.loads(text[start : end + 1])
        except json.JSONDecodeError as exc:
            raise LLMError(f"模型返回的 JSON 无效：{exc.msg}") from exc
    if not isinstance(value, dict):
        raise LLMError("模型响应必须是 JSON 对象。")
    return value


class OpenAICompatibleClient:
    def __init__(self, settings: AppSettings, cancel_event: threading.Event | None = None) -> None:
        self.settings = settings.normalized()
        if not self.settings.is_ready:
            raise LLMError("模型配置不完整，请先填写 API 地址、API Key 和模型名称。")
        self._cancel_event = cancel_event
        self._aborted = False
        self._client = httpx.Client(timeout=self.settings.request_timeout)

    def __enter__(self) -> "OpenAICompatibleClient":
        return self

    def __exit__(self, _exc_type, _exc, _traceback) -> None:
        self.close()

    def close(self) -> None:
        self._client.close()

    def _cancelled(self) -> bool:
        return self._aborted or (self._cancel_event is not None and self._cancel_event.is_set())

    def abort(self) -> None:
        """中断当前正在进行的模型请求（可由其他线程调用）。"""
        self._aborted = True
        try:
            self._client.close()
        except Exception:
            pass

    def chat_json(
        self, system_prompt: str, user_prompt: str, attempts: int = 3,
        timeout: float | None = None,
    ) -> dict[str, Any]:
        """调用模型并解析 JSON 对象。timeout 覆盖本次请求超时（秒）；None 表示沿用客户端默认。"""
        endpoint = f"{self.settings.base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.settings.effective_api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": self.settings.model,
            "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }
        last_error: Exception | None = None
        response_format_fallback_used = False
        attempt = 0
        start_time = time.monotonic()
        while attempt < attempts:
            if self._cancelled():
                raise InterruptedError("用户取消了任务。")
            try:
                if timeout is None:
                    response = self._client.post(endpoint, headers=headers, json=payload)
                else:
                    response = self._client.post(endpoint, headers=headers, json=payload, timeout=timeout)
                if response.status_code >= 400:
                    detail = response.text[:500].replace("\n", " ")
                    if (
                        response.status_code == 400
                        and not response_format_fallback_used
                        and any(marker in detail.casefold() for marker in ("response_format", "json_object"))
                    ):
                        payload.pop("response_format", None)
                        response_format_fallback_used = True
                        continue
                    retryable = response.status_code in {408, 409, 429} or response.status_code >= 500
                    raise LLMRequestError(
                        f"模型服务返回 HTTP {response.status_code}：{detail}",
                        retryable=retryable,
                    )
                body = response.json()
                choice = body["choices"][0]
                finish_reason = choice.get("finish_reason")
                if finish_reason == "length":
                    raise LLMResponseError("模型输出因长度限制被截断。")
                if finish_reason == "content_filter":
                    raise LLMResponseError("模型输出被内容过滤器中止。")
                content = choice["message"]["content"]
                if isinstance(content, list):
                    content = "".join(
                        str(item.get("text", "")) if isinstance(item, dict) else str(item)
                        for item in content
                    )
                result = extract_json_object(str(content))
                logger.info(
                    "chat_json ok model=%s elapsed=%.1fs attempt=%d",
                    self.settings.model, time.monotonic() - start_time, attempt + 1,
                )
                return result
            except LLMRequestError as exc:
                if self._aborted:
                    raise InterruptedError("用户取消了任务。") from exc
                if not exc.retryable:
                    raise
                last_error = exc
                attempt += 1
                if attempt < attempts:
                    if self._cancelled():
                        raise InterruptedError("用户取消了任务。")
                    time.sleep(min(2 ** attempt + random.random(), 5))
            except (httpx.TimeoutException, httpx.NetworkError, httpx.ProtocolError) as exc:
                if self._aborted:
                    raise InterruptedError("用户取消了任务。") from exc
                last_error = exc
                attempt += 1
                if attempt < attempts:
                    if self._cancelled():
                        raise InterruptedError("用户取消了任务。")
                    time.sleep(min(2 ** attempt + random.random(), 5))
            except LLMError:
                # JSON 解析失败由上层携带结构约束纠正，避免重复发送同一提示。
                raise
            except (KeyError, ValueError) as exc:
                raise LLMError("模型服务响应结构无效。") from exc
        logger.warning(
            "chat_json failed model=%s elapsed=%.1fs attempts=%d error=%s",
            self.settings.model, time.monotonic() - start_time, attempts, last_error,
        )
        if isinstance(last_error, LLMRequestError):
            raise last_error
        if isinstance(last_error, (httpx.TimeoutException, httpx.NetworkError, httpx.ProtocolError)):
            raise LLMRequestError(str(last_error)) from last_error
        raise LLMError(str(last_error or "模型调用失败"))

    def test_connection(self) -> str:
        result = self.chat_json(
            "你是连接测试程序。只返回 JSON。",
            '返回 {"ok": true, "message": "连接成功"}，不要添加其他字段。',
            attempts=1,
        )
        if result.get("ok") is not True:
            raise LLMError("模型已响应，但未按要求返回连接测试结果。")
        return str(result.get("message", "连接成功"))
