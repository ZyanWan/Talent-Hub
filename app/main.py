from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import io
import json
import logging
import secrets
import socket
import threading
import urllib.request
import webbrowser
from logging.handlers import RotatingFileHandler
from pathlib import Path

import uvicorn
from fastapi import FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ValidationError

from .artifact_preview import markdown_preview, resolve_artifact, workbook_preview
from .call_repository import CallRepository
from .config import AppSettings, SettingsStore, app_data_dir
from .feishu import build_test_message, send_message
from .llm import LLMError, LLMRequestError, OpenAICompatibleClient
from .models import CallField, CallSummary
from .pipeline import EvaluationEngine, ROOT, ocr_status
from .repository import JobRepository
from .runtime.phone_screening import CallProcessor, render_call_summary_markdown


MAX_FILE_BYTES = 50 * 1024 * 1024
MAX_JOB_BYTES = 1024 * 1024 * 1024

PDF_PREVIEW_SCALE = 3.0
PDF_PREVIEW_MAX_PAGES = 50


# ---- AI 横向对比 ----

COMPARE_DIMENSIONS = [
    ("object_match", "对象匹配"),
    ("scenario_match", "场景垂直度"),
    ("core_actions", "核心动作"),
    ("ownership_depth", "负责深度"),
    ("closed_loop", "闭环证据"),
    ("tools_certificates", "工具与证书"),
    ("scale_results", "规模与结果"),
    ("stability", "稳定性"),
]


def compare_system_prompt() -> str:
    return """你是资深招聘顾问。HR 已按筛选标准完成对候选人简历的证据评估，现在需要你对选中候选人进行横向比较。
请基于给定的筛选标准和每位候选人的评估摘要，排出推荐约面的先后顺序（rank 1 为最优先）。
要求：
- 理由必须是基于评估摘要维度的结论性对比分析，说明排序依据；不得引用简历原文。
- 必须覆盖全部候选人，每人且仅出现一次；rank 从 1 开始连续递增且不重复。
不要输出思维过程，只输出 JSON。"""


def compare_user_prompt(criteria: dict, candidates: list[dict]) -> str:
    lines: list[str] = []
    lines.append(f"岗位：{criteria.get('job_title') or '未命名岗位'}")
    essence = criteria.get("essence")
    if essence:
        lines.append(f"岗位本质：{essence}")
    hard = criteria.get("hard_requirements") or []
    if hard:
        lines.append("硬性门槛：")
        for item in hard:
            rule = item.get("rule") if isinstance(item, dict) else str(item)
            lines.append(f"- {rule}")
    negative = criteria.get("negative_signals") or []
    if negative:
        lines.append("负向信号：")
        for item in negative:
            rule = item.get("rule") if isinstance(item, dict) else str(item)
            lines.append(f"- {rule}")
    lines.append("")
    lines.append(f"共 {len(candidates)} 位候选人需要排序：")
    for index, candidate in enumerate(candidates, start=1):
        name = candidate.get("candidate_name") or "未命名"
        file_name = candidate.get("source_file") or ""
        lines.append("")
        lines.append(f"【候选人 {index}】{name}（{file_name}）")
        lines.append(f"结论：{candidate.get('conclusion', '')}")
        lines.append(f"一句话判定：{candidate.get('one_line', '')}")
        lines.append(f"证据充分度：{candidate.get('evidence_level', '')}")
        evidence = candidate.get("evidence") or {}
        for field, label in COMPARE_DIMENSIONS:
            dim = evidence.get(field) or {}
            status = dim.get("status", "未体现")
            summary = dim.get("summary", "未体现")
            if summary and summary != "未体现" and status != "未体现":
                lines.append(f"- {label}：{status} - {summary}")
            else:
                lines.append(f"- {label}：{status}")
        strengths = candidate.get("strengths") or []
        if strengths:
            lines.append(f"优势：{'；'.join(strengths)}")
        blockers = candidate.get("blockers") or []
        if blockers:
            lines.append(f"风险：{'；'.join(blockers)}")
    lines.append("")
    lines.append('请输出 JSON：{"ranking": [{"candidate": "姓名（文件名）", "rank": 1, "reason": "..."}]}')
    return "\n".join(lines)


class CompareSelection(BaseModel):
    files: list[str] = Field(min_length=1)


class CompareCancel(BaseModel):
    cancel_key: str


class CompareItem(BaseModel):
    candidate: str
    rank: int = Field(ge=1)
    reason: str


class CompareReport(BaseModel):
    ranking: list[CompareItem] = Field(min_length=1)


# 进行中的对比请求：cancel_key -> (取消事件, 模型客户端)。请求结束后清理。
_compare_cancels: dict[str, tuple[threading.Event, OpenAICompatibleClient]] = {}
_compare_cancels_lock = threading.Lock()

# 对比结果缓存：规范化文件组合 -> (评估结果内容哈希, 对比报告)。评估结果变更后自动失效。
_compare_cache: dict[str, tuple[str, CompareReport]] = {}


def validate_compare_report(report: CompareReport, expected: set[str]) -> None:
    names = [item.candidate for item in report.ranking]
    if set(names) != expected:
        missing = sorted(expected - set(names))
        raise ValueError(f"排序未覆盖全部候选人，缺少：{'、'.join(missing)}")
    ranks = [item.rank for item in report.ranking]
    if sorted(ranks) != list(range(1, len(report.ranking) + 1)):
        raise ValueError("排名序号必须从 1 开始连续且不重复。")


def validated_compare_call(
    client: OpenAICompatibleClient, criteria: dict, candidates: list[dict],
) -> CompareReport:
    expected = {
        f"{candidate.get('candidate_name') or '未命名'}（{candidate.get('source_file') or ''}）"
        for candidate in candidates
    }
    system = compare_system_prompt()
    user = compare_user_prompt(criteria, candidates)
    last_error: Exception | None = None
    for attempt in range(2):
        try:
            report = CompareReport.model_validate(client.chat_json(system, user))
            validate_compare_report(report, expected)
            return report
        except LLMRequestError:
            raise
        except (ValidationError, ValueError, LLMError) as exc:
            last_error = exc
            user = (
                compare_user_prompt(criteria, candidates)
                + f"\n\n上一次输出未通过校验：{str(exc)[:600]}。请修正并重新返回完整 JSON。"
            )
    raise RuntimeError(f"AI 对比结果结构校验失败：{last_error}")


def _render_pdf_preview(raw: bytes, scale: float) -> tuple[int, list[dict]]:
    """在后台线程中渲染 PDF 预览页，避免阻塞事件循环。"""
    try:
        import pypdfium2 as pdfium
    except ImportError:
        raise HTTPException(status_code=503, detail="PDF 渲染组件不可用")
    try:
        document = pdfium.PdfDocument(raw)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"无法解析 PDF：{type(exc).__name__}") from exc
    try:
        page_count = len(document)
        if page_count > PDF_PREVIEW_MAX_PAGES:
            raise HTTPException(
                status_code=422,
                detail=f"PDF 共 {page_count} 页，超过 {PDF_PREVIEW_MAX_PAGES} 页预览上限",
            )
        pages: list[dict] = []
        for index in range(page_count):
            page = document[index]
            try:
                bitmap = page.render(scale=scale)
                try:
                    image = bitmap.to_pil()
                    try:
                        buffer = io.BytesIO()
                        image.save(buffer, format="PNG")
                        encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
                        pages.append({"index": index + 1, "data": f"data:image/png;base64,{encoded}"})
                    finally:
                        buffer.close()
                finally:
                    image.close()
            finally:
                bitmap.close()
                page.close()
    finally:
        document.close()
    return page_count, pages


class SettingsInput(BaseModel):
    base_url: str
    api_key: str = ""
    model: str
    max_parallel: int = Field(default=6, ge=1, le=12)
    request_timeout: int = Field(default=180, ge=30, le=600)
    ocr_executable: str = ""
    asr_enabled: bool = False
    asr_api_key: str = ""
    clear_asr: bool = False
    retain_resume_text: bool = True
    call_qa_records: bool = False
    feishu_push_enabled: bool = False
    feishu_webhook_url: str = ""
    feishu_sign_secret: str = ""
    clear_feishu_sign: bool = False


class JobInput(BaseModel):
    title: str = ""


class JobBriefInput(BaseModel):
    text: str


class CallInput(BaseModel):
    title: str = ""
    job_title: str = ""
    job_id: str = ""
    soft_skill_focus: str = ""
    soft_skill_dimensions: list[str] = Field(default_factory=list)


class CallItemInput(BaseModel):
    narrative: str = ""
    fields: list[dict] | None = None
    candidate_name: str = ""


def public_job(job: dict) -> dict:
    return {
        key: value
        for key, value in job.items()
        if key not in {"internal_trace", "resume_hashes"}
    }


def public_job_summary(job: dict) -> dict:
    keys = {
        "id", "title", "status", "stage", "progress", "created_at", "updated_at",
        "archived_at", "completed", "total", "reviewed", "elapsed_seconds",
    }
    return {key: value for key, value in job.items() if key in keys}


def public_call(record: dict) -> dict:
    return {key: value for key, value in record.items() if key not in {"internal_trace", "audio_hashes"}}


def public_call_summary(record: dict) -> dict:
    return {
        "id": record.get("id"),
        "title": record.get("title"),
        "job_title": record.get("job_title"),
        "status": record.get("status"),
        "stage": record.get("stage"),
        "created_at": record.get("created_at"),
        "updated_at": record.get("updated_at"),
        "archived_at": record.get("archived_at"),
        "item_count": len(record.get("items", [])),
    }


def public_settings(settings: AppSettings, ocr: dict[str, object]) -> dict[str, object]:
    payload = settings.public_dict()
    payload["ocr"] = ocr
    return payload


def create_app(data_dir: Path | None = None, app_token: str | None = None) -> FastAPI:
    root = data_dir or app_data_dir()
    settings_store = SettingsStore(root)
    repository = JobRepository(root)
    engine = EvaluationEngine(repository, settings_store)
    call_repository = CallRepository(root)
    call_processor = CallProcessor(call_repository, settings_store)
    token = app_token or secrets.token_urlsafe(32)
    static_dir = ROOT / "app" / "static"

    app = FastAPI(title="招聘工作台", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.settings_store = settings_store
    app.state.repository = repository
    app.state.engine = engine
    app.state.call_repository = call_repository
    app.state.call_processor = call_processor
    app.state.app_token = token
    # 每任务一把 asyncio 上传锁：串行化同一任务的并发上传，避免预留/元数据竞争
    upload_locks: dict[str, asyncio.Lock] = {}
    app.state.upload_locks = upload_locks

    @app.middleware("http")
    async def local_token_guard(request: Request, call_next):
        if request.url.path.startswith("/api/"):
            supplied = request.headers.get("X-App-Token", "")
            if not secrets.compare_digest(supplied, token):
                return JSONResponse({"detail": "无效的本地会话令牌"}, status_code=403)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = "no-store"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; "
            "object-src 'self' blob:; frame-src 'self' blob:; frame-ancestors 'none'"
        )
        return response

    @app.exception_handler(ValueError)
    async def value_error_handler(_request: Request, exc: ValueError):
        return JSONResponse({"detail": str(exc)}, status_code=400)

    @app.exception_handler(FileNotFoundError)
    async def file_not_found_handler(_request: Request, _exc: FileNotFoundError):
        return JSONResponse({"detail": "任务或文件不存在。"}, status_code=404)

    @app.get("/", response_class=HTMLResponse)
    async def index():
        html = (static_dir / "index.html").read_text(encoding="utf-8")
        return HTMLResponse(html.replace("__APP_TOKEN__", token))

    @app.get("/health")
    async def health():
        return {"app": "talent-hub", "status": "ok"}

    @app.get("/api/bootstrap")
    async def bootstrap():
        settings = settings_store.load()
        ocr = await run_in_threadpool(ocr_status, settings)
        return {
            "settings": public_settings(settings, ocr),
            "jobs": [public_job_summary(job) for job in repository.list_recent()],
            "limits": {"file_mb": MAX_FILE_BYTES // 1024 // 1024},
        }

    @app.get("/api/jobs")
    async def list_jobs(
        scope: str = Query(default="recent", pattern="^(recent|archived)$"),
        limit: int = Query(default=50, ge=1, le=100),
        offset: int = Query(default=0, ge=0),
    ):
        archived = scope == "archived"
        jobs = await run_in_threadpool(lambda: repository.list_jobs(archived=archived))
        return {
            "jobs": [public_job_summary(job) for job in jobs[offset:offset + limit]],
            "total": len(jobs),
        }

    @app.get("/api/storage")
    async def storage():
        return await run_in_threadpool(repository.storage_stats)

    def merged_settings(payload: SettingsInput) -> AppSettings:
        current = settings_store.load()
        api_key = payload.api_key.strip() or current.api_key
        asr_key = "" if payload.clear_asr else (payload.asr_api_key.strip() or current.asr_api_key)
        feishu_sign = "" if payload.clear_feishu_sign else (
            payload.feishu_sign_secret.strip() or current.feishu_sign_secret
        )
        return AppSettings(
            **payload.model_dump(exclude={
                "api_key", "asr_api_key", "asr_enabled", "clear_asr",
                "feishu_sign_secret", "clear_feishu_sign",
            }),
            api_key=api_key,
            asr_api_key=asr_key,
            asr_enabled=bool(asr_key),
            feishu_sign_secret=feishu_sign,
        )

    @app.put("/api/settings")
    async def save_settings(payload: SettingsInput):
        settings = merged_settings(payload)
        try:
            saved = settings_store.save(settings)
        except RuntimeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        ocr = await run_in_threadpool(ocr_status, saved)
        return public_settings(saved, ocr)

    @app.post("/api/settings/feishu-test")
    async def test_feishu(payload: SettingsInput):
        settings = merged_settings(payload)
        if not settings.feishu_webhook_url.strip():
            raise HTTPException(status_code=400, detail="请先填写飞书 Webhook 地址。")
        try:
            await run_in_threadpool(send_message, settings, build_test_message())
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"ok": True}

    @app.post("/api/settings/test")
    async def test_settings(payload: SettingsInput):
        settings = merged_settings(payload)
        try:
            def run_test() -> str:
                with OpenAICompatibleClient(settings) as client:
                    return client.test_connection()

            message = await run_in_threadpool(run_test)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"ok": True, "message": message}

    @app.post("/api/jobs")
    async def create_job(payload: JobInput):
        return public_job(repository.create(payload.title))

    async def save_stream(
        request: Request, target: Path, current_total: int, max_bytes: int = MAX_FILE_BYTES,
    ) -> tuple[int, str]:
        declared = request.headers.get("content-length")
        if declared and int(declared) > max_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"单个文件超过 {max_bytes // (1024 * 1024)} MB 限制。",
            )
        size = 0
        fingerprint = hashlib.sha256()
        try:
            with target.open("wb") as handle:
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > max_bytes:
                        raise HTTPException(
                            status_code=413,
                            detail=f"单个文件超过 {max_bytes // (1024 * 1024)} MB 限制。",
                        )
                    if current_total + size > MAX_JOB_BYTES:
                        raise HTTPException(status_code=413, detail="单个任务文件总量超过 1 GB 限制。")
                    handle.write(chunk)
                    fingerprint.update(chunk)
        except Exception:
            target.unlink(missing_ok=True)
            raise
        if size == 0:
            target.unlink(missing_ok=True)
            raise HTTPException(status_code=400, detail="文件为空。")
        return size, fingerprint.hexdigest()

    @app.put("/api/jobs/{job_id}/jd")
    async def save_job_brief(job_id: str, payload: JobBriefInput):
        async with upload_locks.setdefault(job_id, asyncio.Lock()):
            job = repository.get(job_id)
            if job["status"] in {"queued", "running"}:
                raise HTTPException(status_code=409, detail="任务运行中，不能替换 JD。")
            if job.get("archived_at"):
                raise HTTPException(status_code=409, detail="请先将任务恢复到最近任务。")
            text = payload.text.strip()
            if not text:
                raise HTTPException(status_code=400, detail="岗位说明不能为空。")
            content = text.encode("utf-8")
            if len(content) > MAX_FILE_BYTES:
                raise HTTPException(status_code=413, detail="岗位说明超过 50 MB 限制。")
            reserved, target = repository.reserve_upload(job_id, "jd", "岗位JD.txt")
            existing_bytes = sum(
                path.stat().st_size for path in repository.job_dir(job_id).rglob("*") if path.is_file()
            )
            if existing_bytes + len(content) > MAX_JOB_BYTES:
                raise HTTPException(status_code=413, detail="单个任务文件总量超过 1 GB 限制。")
            try:
                target.write_bytes(content)
            except Exception:
                target.unlink(missing_ok=True)
                raise
            old_name = job.get("jd_file")
            if old_name and old_name != reserved:
                (repository.job_dir(job_id) / "jd" / old_name).unlink(missing_ok=True)
            return public_job(repository.update(job_id, jd_file=reserved, stage="JD 已就绪"))

    @app.put("/api/jobs/{job_id}/resumes")
    async def upload_resume(job_id: str, request: Request, filename: str):
        async with upload_locks.setdefault(job_id, asyncio.Lock()):
            job = repository.get(job_id)
            if job["status"] in {"queued", "running"}:
                raise HTTPException(status_code=409, detail="任务运行中，不能添加简历。")
            if job.get("archived_at"):
                raise HTTPException(status_code=409, detail="请先将任务恢复到最近任务。")
            reserved, target = repository.reserve_upload(job_id, "resumes", filename)
            existing_bytes = sum(
                path.stat().st_size for path in repository.job_dir(job_id).rglob("*") if path.is_file()
            )
            _size, fingerprint = await save_stream(request, target, existing_bytes)
            resume_hashes = dict(job.get("resume_hashes", {}))
            duplicate_of = next(
                (stored_name for stored_name, stored_hash in resume_hashes.items() if stored_hash == fingerprint),
                None,
            )
            if duplicate_of:
                target.unlink(missing_ok=True)
                return {
                    **public_job(job),
                    "upload": {"accepted": False, "duplicate_of": duplicate_of},
                }

            resume_hashes[reserved] = fingerprint
            files = [*job.get("resume_files", []), reserved]
            updated = repository.update(
                job_id,
                resume_files=files,
                resume_hashes=resume_hashes,
                total=len(files),
                stage=f"已上传 {len(files)} 份简历",
            )
            return {**public_job(updated), "upload": {"accepted": True}}

    @app.post("/api/resumes/preview")
    async def render_resume_preview(file: UploadFile = File(...), scale: float = Query(default=PDF_PREVIEW_SCALE, ge=1.0, le=4.0)):
        if Path(file.filename or "").suffix.lower() != ".pdf":
            raise HTTPException(status_code=415, detail="仅支持 PDF 文件预览")
        chunks: list[bytes] = []
        total = 0
        try:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_FILE_BYTES:
                    raise HTTPException(status_code=413, detail=f"文件超过 {MAX_FILE_BYTES // (1024 * 1024)} MB 限制")
                chunks.append(chunk)
        finally:
            await file.close()
        if total == 0:
            raise HTTPException(status_code=400, detail="文件内容为空")
        raw = b"".join(chunks)
        page_count, pages = await run_in_threadpool(_render_pdf_preview, raw, scale)
        return {"page_count": page_count, "pages": pages}

    @app.get("/api/jobs/{job_id}/resumes/{filename}/preview")
    async def render_stored_resume_preview(
        job_id: str,
        filename: str,
        scale: float = Query(default=PDF_PREVIEW_SCALE, ge=1.0, le=4.0),
    ):
        path = repository.resume_path(job_id, filename)
        if path.suffix.lower() != ".pdf":
            raise HTTPException(status_code=415, detail="仅支持 PDF 文件预览")
        raw = await run_in_threadpool(path.read_bytes)
        page_count, pages = await run_in_threadpool(_render_pdf_preview, raw, scale)
        return {"page_count": page_count, "pages": pages}

    @app.get("/api/jobs/{job_id}/resumes/{filename}")
    async def read_stored_resume(job_id: str, filename: str):
        path = repository.resume_path(job_id, filename)
        return FileResponse(path)

    @app.post("/api/jobs/{job_id}/start")
    async def start_job(job_id: str):
        try:
            return public_job(engine.start(job_id))
        except RuntimeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/jobs/{job_id}/cancel")
    async def cancel_job(job_id: str):
        try:
            return public_job(engine.cancel(job_id))
        except RuntimeError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @app.post("/api/jobs/{job_id}/archive")
    async def archive_job(job_id: str):
        try:
            return public_job_summary(engine.archive(job_id))
        except RuntimeError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @app.post("/api/jobs/{job_id}/restore")
    async def restore_job(job_id: str):
        return public_job_summary(repository.restore(job_id))

    @app.delete("/api/jobs/{job_id}")
    async def delete_job(job_id: str):
        try:
            await run_in_threadpool(engine.delete, job_id)
            upload_locks.pop(job_id, None)
            cache_prefix = f"{job_id}\x1f"
            for cache_key in [key for key in _compare_cache if key.startswith(cache_prefix)]:
                _compare_cache.pop(cache_key, None)
        except RuntimeError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except OSError as exc:
            raise HTTPException(
                status_code=409,
                detail="任务文件可能正被其他程序占用，请关闭相关文件后重试。",
            ) from exc
        return {"ok": True}

    @app.post("/api/calls")
    async def create_call(payload: CallInput):
        return public_call(call_repository.create(
            payload.title, payload.job_title, payload.soft_skill_focus,
            payload.job_id, payload.soft_skill_dimensions,
        ))

    @app.put("/api/calls/{call_id}/audio")
    async def upload_call_audio(call_id: str, request: Request, filename: str):
        async with upload_locks.setdefault(f"call:{call_id}", asyncio.Lock()):
            call = call_repository.get(call_id)
            if call["status"] in {"queued", "running"} or call.get("archived_at"):
                raise HTTPException(status_code=409, detail="任务处理中或已归档，不能追加录音。")
            try:
                reserved, target = call_repository.reserve_audio(call_id, filename)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            _size, fingerprint = await save_stream(request, target, 0, max_bytes=100 * 1024 * 1024)
            # 内容指纹查重：与筛选简历同款机制，重复文件不落库、不新增条目（防误传重复录音白花 ASR 费用）。
            audio_hashes = dict(call.get("audio_hashes", {}))
            duplicate_of = next(
                (stored_name for stored_name, stored_hash in audio_hashes.items() if stored_hash == fingerprint),
                None,
            )
            if duplicate_of:
                target.unlink(missing_ok=True)
                return {**public_call(call), "upload": {"accepted": False, "duplicate_of": duplicate_of}}
            audio_hashes[reserved] = fingerprint
            call_repository.update(call_id, audio_hashes=audio_hashes)
            record = call_repository.add_item(call_id, reserved)
            return {**public_call(record), "upload": {"accepted": True}}

    @app.post("/api/calls/{call_id}/process")
    async def process_call(call_id: str):
        try:
            return public_call(call_processor.start(call_id))
        except RuntimeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/api/calls/{call_id}")
    async def get_call(call_id: str):
        try:
            return public_call(call_repository.get(call_id))
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="任务不存在。") from exc

    @app.get("/api/calls")
    async def list_calls(
        scope: str = Query(default="recent", pattern="^(recent|archived)$"),
        limit: int = Query(default=50, ge=1, le=100),
        offset: int = Query(default=0, ge=0),
    ):
        archived = scope == "archived"
        calls = await run_in_threadpool(lambda: call_repository.list_calls(archived=archived))
        return {
            "calls": [public_call_summary(call) for call in calls[offset:offset + limit]],
            "total": len(calls),
        }

    @app.get("/api/calls/{call_id}/items/{item_id}")
    async def get_call_item(call_id: str, item_id: str):
        call = call_repository.get(call_id)
        item = next(
            (entry for entry in call.get("items", []) if entry.get("id") == item_id), None,
        )
        if item is None:
            raise HTTPException(status_code=404, detail="条目不存在。")
        return item

    @app.put("/api/calls/{call_id}/items/{item_id}")
    async def update_call_item(call_id: str, item_id: str, payload: CallItemInput):
        call = call_repository.get(call_id)
        item = next(
            (entry for entry in call.get("items", []) if entry.get("id") == item_id), None,
        )
        if item is None:
            raise HTTPException(status_code=404, detail="条目不存在。")
        summary = CallSummary.model_validate(item.get("summary") or {})
        narrative = payload.narrative.strip()
        candidate_name = payload.candidate_name.strip()
        # 完整覆盖语义：提交值（含空值）直接写入，保证前端可清空内容
        summary.narrative = narrative
        summary.candidate_name = candidate_name
        if payload.fields is not None:
            summary.fields = [CallField.model_validate(field) for field in payload.fields]
        changes = {"summary": summary.model_dump(mode="json")}
        if candidate_name:
            changes["candidate_name"] = candidate_name
        updated = call_repository.update_item(call_id, item_id, **changes)
        item = next(
            (entry for entry in updated["items"] if entry.get("id") == item_id), item,
        )
        summary_dir = call_repository.call_dir(call_id) / "summaries"
        summary_dir.mkdir(parents=True, exist_ok=True)
        (summary_dir / f"{item_id}.json").write_text(
            summary.model_dump_json(indent=2), encoding="utf-8"
        )
        (summary_dir / f"{item_id}.md").write_text(
            render_call_summary_markdown(summary), encoding="utf-8"
        )
        return item

    @app.post("/api/calls/{call_id}/archive")
    async def archive_call(call_id: str):
        try:
            return public_call_summary(call_repository.archive(call_id))
        except RuntimeError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @app.post("/api/calls/{call_id}/restore")
    async def restore_call(call_id: str):
        try:
            return public_call_summary(call_repository.restore(call_id))
        except RuntimeError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @app.delete("/api/calls/{call_id}")
    async def delete_call(call_id: str):
        try:
            await run_in_threadpool(call_processor.delete, call_id)
            upload_locks.pop(f"call:{call_id}", None)
        except RuntimeError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except OSError as exc:
            raise HTTPException(
                status_code=409,
                detail="任务文件可能正被其他程序占用，请关闭相关文件后重试。",
            ) from exc
        return {"ok": True}

    @app.post("/api/calls/{call_id}/cancel")
    async def cancel_call(call_id: str):
        try:
            return public_call(call_processor.cancel(call_id))
        except RuntimeError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @app.get("/api/calls/{call_id}/items/{item_id}/download")
    async def download_call_item(call_id: str, item_id: str):
        call = call_repository.get(call_id)
        item = next(
            (entry for entry in call.get("items", []) if entry.get("id") == item_id), None,
        )
        if item is None:
            raise HTTPException(status_code=404, detail="条目不存在。")
        summary = item.get("summary")
        if not summary:
            raise HTTPException(status_code=404, detail="电话确认记录尚未生成。")
        md_path = call_repository.call_dir(call_id) / "summaries" / f"{item_id}.md"
        if not md_path.is_file():
            raise HTTPException(status_code=404, detail="电话确认记录尚未生成。")
        candidate_name = summary.get("candidate_name") or item.get("candidate_name") or "候选人"
        return FileResponse(
            md_path,
            filename=f"{candidate_name}-电话确认记录.md",
            media_type="text/markdown; charset=utf-8",
        )

    @app.get("/api/calls/{call_id}/items/{item_id}/audio")
    async def get_call_item_audio(call_id: str, item_id: str):
        call = call_repository.get(call_id)
        item = next(
            (entry for entry in call.get("items", []) if entry.get("id") == item_id), None,
        )
        if item is None:
            raise HTTPException(status_code=404, detail="条目不存在。")
        audio_file = item.get("audio_file") or ""
        if not audio_file:
            raise HTTPException(status_code=404, detail="录音文件不存在。")
        audio_dir = (call_repository.call_dir(call_id) / "audio").resolve()
        target = (audio_dir / audio_file).resolve()
        if target.parent != audio_dir or not target.is_file():
            raise HTTPException(status_code=404, detail="录音文件不存在。")
        return FileResponse(target)

    @app.post("/api/shutdown")
    async def shutdown():
        callback = getattr(app.state, "shutdown_callback", None)
        if callback is None:
            raise HTTPException(status_code=503, detail="当前运行方式不支持从页面退出。")
        threading.Timer(0.2, callback).start()
        return {"ok": True}

    @app.get("/api/jobs/{job_id}")
    async def get_job(job_id: str):
        try:
            return public_job(repository.get(job_id))
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="任务不存在。") from exc

    @app.get("/api/jobs/{job_id}/download")
    async def download_result(job_id: str):
        job = repository.get(job_id)
        output_file = job.get("output_file")
        if not output_file:
            raise HTTPException(status_code=404, detail="结果文件尚未生成。")
        path = resolve_artifact(repository.job_dir(job_id), output_file)
        return FileResponse(path, filename=f"{job.get('title', '岗位')}-候选人评估表.xlsx")

    @app.get("/api/jobs/{job_id}/criteria")
    async def download_criteria(job_id: str):
        job = repository.get(job_id)
        criteria_file = job.get("criteria_file")
        if not criteria_file:
            raise HTTPException(status_code=404, detail="筛选标准尚未生成。")
        path = resolve_artifact(repository.job_dir(job_id), criteria_file)
        return FileResponse(path, filename=path.name, media_type="text/markdown; charset=utf-8")

    @app.get("/api/jobs/{job_id}/criteria-json")
    async def get_criteria_json(job_id: str):
        job = repository.get(job_id)
        if not job.get("criteria_file"):
            raise HTTPException(status_code=404, detail="筛选标准尚未生成。")
        path = repository.job_dir(job_id) / "筛选标准.json"
        if not path.is_file():
            raise HTTPException(status_code=404, detail="筛选标准尚未生成。")
        return {"criteria": json.loads(path.read_text(encoding="utf-8"))}

    @app.put("/api/jobs/{job_id}/criteria-json")
    async def save_criteria_json(job_id: str, payload: dict):
        try:
            return public_job(await run_in_threadpool(engine.save_criteria, job_id, payload))
        except RuntimeError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @app.get("/api/jobs/{job_id}/preview/criteria")
    async def preview_criteria(job_id: str):
        job = repository.get(job_id)
        criteria_file = job.get("criteria_file")
        if not criteria_file:
            raise HTTPException(status_code=404, detail="筛选标准尚未生成。")
        path = resolve_artifact(repository.job_dir(job_id), criteria_file)
        return await run_in_threadpool(markdown_preview, path)

    @app.get("/api/jobs/{job_id}/preview/workbook")
    async def preview_workbook(job_id: str):
        job = repository.get(job_id)
        output_file = job.get("output_file")
        if not output_file:
            raise HTTPException(status_code=404, detail="结果文件尚未生成。")
        path = resolve_artifact(repository.job_dir(job_id), output_file)
        return await run_in_threadpool(workbook_preview, path)

    @app.post("/api/jobs/{job_id}/compare")
    async def compare_candidates(
        job_id: str,
        payload: CompareSelection,
        cancel_key: str | None = Query(default=None),
    ):
        repository.get(job_id)
        job_dir = repository.job_dir(job_id)
        results_path = job_dir / "评估结果.json"
        if not results_path.is_file():
            raise HTTPException(status_code=404, detail="评估结果尚未生成。")
        try:
            raw = results_path.read_bytes()
            data = json.loads(raw.decode("utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise HTTPException(status_code=500, detail="评估结果文件不可读。") from exc
        results_hash = hashlib.sha256(raw).hexdigest()
        if not isinstance(data, list):
            raise HTTPException(status_code=500, detail="评估结果文件格式异常。")
        # 排序后构造 prompt，保证同一批候选人无论勾选顺序如何，模型输入完全一致。
        requested = sorted(dict.fromkeys(payload.files))
        if len(requested) < 2:
            raise HTTPException(status_code=400, detail="请至少选择两位候选人进行对比。")
        by_file = {
            item.get("source_file"): item
            for item in data
            if isinstance(item, dict) and item.get("source_file")
        }
        missing = [name for name in requested if name not in by_file]
        if missing:
            raise HTTPException(status_code=400, detail="以下简历不在评估结果中：" + "、".join(missing))
        blocked = [name for name in requested if by_file[name].get("conclusion") == "C不推进"]
        if blocked:
            raise HTTPException(status_code=400, detail="C 类候选人不能参与对比：" + "、".join(blocked))
        criteria: dict = {}
        criteria_path = job_dir / "筛选标准.json"
        if criteria_path.is_file():
            try:
                loaded = json.loads(criteria_path.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    criteria = loaded
            except (OSError, json.JSONDecodeError):
                criteria = {}
        settings = settings_store.load()
        if not settings.is_ready:
            raise HTTPException(status_code=400, detail="模型配置不完整，请先填写 API 地址、API Key 和模型名称。")
        candidates = [by_file[name] for name in requested]
        cache_key = job_id + "\x1f" + "\x1f".join(requested)
        cached = _compare_cache.get(cache_key)
        if cached is not None and cached[0] == results_hash:
            return {"ranking": [item.model_dump() for item in cached[1].ranking]}
        cancel_event = threading.Event()

        def run_compare() -> CompareReport:
            with OpenAICompatibleClient(settings, cancel_event=cancel_event) as client:
                if cancel_key:
                    with _compare_cancels_lock:
                        _compare_cancels[cancel_key] = (cancel_event, client)
                try:
                    return validated_compare_call(client, criteria, candidates)
                finally:
                    if cancel_key:
                        with _compare_cancels_lock:
                            _compare_cancels.pop(cancel_key, None)

        try:
            report = await run_in_threadpool(run_compare)
        except InterruptedError:
            raise HTTPException(status_code=499, detail="对比请求已取消。")
        except (RuntimeError, LLMError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        repository.get(job_id)
        _compare_cache[cache_key] = (results_hash, report)
        return {"ranking": [item.model_dump() for item in report.ranking]}

    @app.post("/api/jobs/{job_id}/compare/cancel")
    async def cancel_compare(job_id: str, payload: CompareCancel):
        with _compare_cancels_lock:
            entry = _compare_cancels.get(payload.cancel_key)
        if entry is None:
            raise HTTPException(status_code=404, detail="对比请求不存在或已完成。")
        cancel_event, client = entry
        cancel_event.set()
        client.abort()
        return {"ok": True}

    app.mount("/static", StaticFiles(directory=static_dir), name="static")
    return app


def available_port(preferred: int) -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        try:
            sock.bind(("127.0.0.1", preferred))
            return preferred
        except OSError:
            sock.bind(("127.0.0.1", 0))
            return int(sock.getsockname()[1])


def existing_app_url(port: int) -> str | None:
    url = f"http://127.0.0.1:{port}/"
    try:
        with urllib.request.urlopen(f"{url}health", timeout=0.6) as response:
            payload = json.loads(response.read().decode("utf-8"))
        if payload.get("app") == "talent-hub":
            return url
    except (OSError, ValueError, json.JSONDecodeError):
        return None
    return None


def configure_app_logging(data_dir: Path) -> Path | None:
    try:
        log_dir = data_dir / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        log_path = log_dir / "app.log"
        handler = RotatingFileHandler(
            log_path,
            maxBytes=2 * 1024 * 1024,
            backupCount=3,
            encoding="utf-8",
        )
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
        )
        logging.basicConfig(level=logging.INFO, handlers=[handler], force=True)
        return log_path
    except OSError:
        logging.basicConfig(handlers=[logging.NullHandler()], force=True)
        return None


def create_server_config(app: FastAPI, port: int) -> uvicorn.Config:
    return uvicorn.Config(
        app,
        host="127.0.0.1",
        port=port,
        log_level="warning",
        log_config=None,
        access_log=False,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="启动招聘工作台")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--data-dir", type=Path)
    args = parser.parse_args()
    data_dir = args.data_dir or app_data_dir()
    configure_app_logging(data_dir)
    existing_url = existing_app_url(args.port)
    if existing_url:
        if not args.no_browser:
            webbrowser.open(existing_url)
        logging.getLogger(__name__).info("Existing app opened at %s", existing_url)
        return
    port = available_port(args.port)
    token = secrets.token_urlsafe(32)
    app = create_app(data_dir, token)
    url = f"http://127.0.0.1:{port}/"
    if not args.no_browser:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    logging.getLogger(__name__).info("App starting at %s", url)
    server = uvicorn.Server(create_server_config(app, port))
    app.state.shutdown_callback = lambda: setattr(server, "should_exit", True)
    server.run()


if __name__ == "__main__":
    main()
