from __future__ import annotations

import base64
import ctypes
import json
import os
import sys
import tempfile
from ctypes import wintypes
from dataclasses import asdict, dataclass, fields
from pathlib import Path


APP_DIR_NAME = "TalentHub"
ENV_API_KEY = "TALENT_HUB_API_KEY"


def app_data_dir() -> Path:
    override = os.getenv("TALENT_HUB_DATA_DIR")
    if override:
        return Path(override).expanduser().resolve()
    if sys.platform == "win32":
        root = Path(os.getenv("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    else:
        root = Path.home() / ".local" / "share"
    return root / APP_DIR_NAME


@dataclass(slots=True)
class AppSettings:
    schema_version: int = 2
    base_url: str = "https://api.openai.com/v1"
    api_key: str = ""
    model: str = ""
    max_parallel: int = 6
    request_timeout: int = 180
    ocr_executable: str = ""
    asr_enabled: bool = False   # 是否启用语音转写（火山引擎）
    asr_api_key: str = ""       # 火山引擎 API Key，DPAPI 加密保存
    retain_resume_text: bool = True
    call_qa_records: bool = False   # 电话整理是否生成快筛详情（通篇问答原文）；关闭可大幅减少模型输出
    feishu_push_enabled: bool = False   # 任务完成后是否推送结果到飞书群
    feishu_webhook_url: str = ""        # 飞书自定义机器人 Webhook 地址
    feishu_sign_secret: str = ""        # 飞书签名密钥，DPAPI 加密保存

    def normalized(self) -> "AppSettings":
        base_url = self.base_url.strip().rstrip("/")
        model = self.model.strip()
        return AppSettings(
            schema_version=2,
            base_url=base_url,
            api_key=self.api_key.strip(),
            model=model,
            max_parallel=max(1, min(int(self.max_parallel), 12)),
            request_timeout=max(30, min(int(self.request_timeout), 600)),
            ocr_executable=self.ocr_executable.strip(),
            asr_enabled=bool(self.asr_enabled),
            asr_api_key=self.asr_api_key.strip(),
            retain_resume_text=bool(self.retain_resume_text),
            call_qa_records=bool(self.call_qa_records),
            feishu_push_enabled=bool(self.feishu_push_enabled),
            feishu_webhook_url=self.feishu_webhook_url.strip(),
            feishu_sign_secret=self.feishu_sign_secret.strip(),
        )

    @property
    def is_ready(self) -> bool:
        return bool(self.base_url and self.model and (self.api_key or os.getenv(ENV_API_KEY)))

    @property
    def effective_api_key(self) -> str:
        return self.api_key or os.getenv(ENV_API_KEY, "")

    def public_dict(self) -> dict[str, object]:
        return {
            "base_url": self.base_url,
            "api_key_configured": bool(self.effective_api_key),
            "model": self.model,
            "max_parallel": self.max_parallel,
            "request_timeout": self.request_timeout,
            "ocr_executable": self.ocr_executable,
            "asr_configured": bool(self.asr_api_key.strip()),
            "retain_resume_text": self.retain_resume_text,
            "call_qa_records": self.call_qa_records,
            "feishu_push_enabled": self.feishu_push_enabled,
            "feishu_webhook_url": self.feishu_webhook_url,
            "feishu_sign_configured": bool(self.feishu_sign_secret.strip()),
            "is_ready": self.is_ready,
        }


class _DataBlob(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]


def _protect_windows(value: str) -> str:
    raw = value.encode("utf-8")
    source = ctypes.create_string_buffer(raw)
    source_blob = _DataBlob(len(raw), ctypes.cast(source, ctypes.POINTER(ctypes.c_char)))
    target_blob = _DataBlob()
    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32
    if not crypt32.CryptProtectData(
        ctypes.byref(source_blob), "TalentHub", None, None, None, 0,
        ctypes.byref(target_blob),
    ):
        raise ctypes.WinError()
    try:
        protected = ctypes.string_at(target_blob.pbData, target_blob.cbData)
        return base64.b64encode(protected).decode("ascii")
    finally:
        kernel32.LocalFree(target_blob.pbData)


def _unprotect_windows(value: str) -> str:
    raw = base64.b64decode(value)
    source = ctypes.create_string_buffer(raw)
    source_blob = _DataBlob(len(raw), ctypes.cast(source, ctypes.POINTER(ctypes.c_char)))
    target_blob = _DataBlob()
    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32
    if not crypt32.CryptUnprotectData(
        ctypes.byref(source_blob), None, None, None, None, 0,
        ctypes.byref(target_blob),
    ):
        raise ctypes.WinError()
    try:
        return ctypes.string_at(target_blob.pbData, target_blob.cbData).decode("utf-8")
    finally:
        kernel32.LocalFree(target_blob.pbData)


class SettingsStore:
    def __init__(self, root: Path | None = None) -> None:
        self.root = root or app_data_dir()
        self.path = self.root / "settings.json"

    def load(self) -> AppSettings:
        if not self.path.exists():
            return AppSettings()
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
            allowed = {field.name for field in fields(AppSettings)} - {"api_key"}
            values = {key: value for key, value in payload.items() if key in allowed}
            if int(payload.get("schema_version", 1)) < 2:
                values["max_parallel"] = max(6, int(payload.get("max_parallel", 3)))
            encrypted_key = str(payload.get("api_key_dpapi", ""))
            if encrypted_key and sys.platform == "win32":
                values["api_key"] = _unprotect_windows(encrypted_key)
            encrypted_asr_key = str(payload.get("asr_api_key_dpapi", ""))
            if encrypted_asr_key and sys.platform == "win32":
                values["asr_api_key"] = _unprotect_windows(encrypted_asr_key)
            encrypted_feishu_sign = str(payload.get("feishu_sign_secret_dpapi", ""))
            if encrypted_feishu_sign and sys.platform == "win32":
                values["feishu_sign_secret"] = _unprotect_windows(encrypted_feishu_sign)
            return AppSettings(**values).normalized()
        except Exception:
            return AppSettings()

    def save(self, settings: AppSettings) -> AppSettings:
        normalized = settings.normalized()
        payload = asdict(normalized)
        api_key = payload.pop("api_key", "")
        if api_key:
            if sys.platform != "win32":
                raise RuntimeError(f"非 Windows 系统请通过环境变量 {ENV_API_KEY} 配置 API Key。")
            payload["api_key_dpapi"] = _protect_windows(api_key)
        asr_api_key = payload.pop("asr_api_key", "")
        if asr_api_key:
            if sys.platform != "win32":
                raise RuntimeError("非 Windows 系统暂不支持保存语音转写（ASR）密钥。")
            payload["asr_api_key_dpapi"] = _protect_windows(asr_api_key)
        feishu_sign_secret = payload.pop("feishu_sign_secret", "")
        if feishu_sign_secret:
            if sys.platform != "win32":
                raise RuntimeError("非 Windows 系统暂不支持保存飞书签名密钥。")
            payload["feishu_sign_secret_dpapi"] = _protect_windows(feishu_sign_secret)
        self.root.mkdir(parents=True, exist_ok=True)
        descriptor, temp_name = tempfile.mkstemp(prefix="settings-", suffix=".tmp", dir=self.root)
        os.close(descriptor)
        temp_path = Path(temp_name)
        try:
            temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
            os.replace(temp_path, self.path)
        finally:
            temp_path.unlink(missing_ok=True)
        return normalized
