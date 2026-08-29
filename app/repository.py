from __future__ import annotations

import json
import os
import re
import shutil
import tempfile
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path


ALLOWED_SUFFIXES = {
    ".pdf", ".docx", ".txt", ".md", ".markdown",
    ".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def safe_filename(name: str) -> str:
    candidate = Path(name).name.strip()
    candidate = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", candidate)
    candidate = candidate.rstrip(". ")
    return candidate[:120] or "未命名文件"


class JsonStore:
    """通用任务仓储：每个任务一个独立目录，元数据以 JSON 原子写入，锁内并发安全。

    子类只需提供：子目录名、元数据文件名、临时文件前缀、初始记录结构与目录结构。
    """

    def __init__(self, root: Path, *, subdir: str, metadata_name: str, temp_prefix: str) -> None:
        self.root = root / subdir
        self.root.mkdir(parents=True, exist_ok=True)
        self._metadata_name = metadata_name
        self._temp_prefix = temp_prefix
        self._lock = threading.RLock()

    def _new_record(self, record_id: str, now: str, **kwargs) -> dict:
        raise NotImplementedError

    def _make_dirs(self, record_dir: Path) -> None:
        record_dir.mkdir(parents=True)

    def _item_dir(self, record_id: str) -> Path:
        if not re.fullmatch(r"[a-f0-9]{32}", record_id):
            raise ValueError("无效的任务编号")
        return self.root / record_id

    def metadata_path(self, record_id: str) -> Path:
        return self._item_dir(record_id) / self._metadata_name

    def create(self, **kwargs) -> dict:
        with self._lock:
            record_id = uuid.uuid4().hex
            now = utc_now()
            record = self._new_record(record_id, now, **kwargs)
            self._make_dirs(self._item_dir(record_id))
            self.save(record)
            return record

    def get(self, record_id: str) -> dict:
        with self._lock:
            path = self.metadata_path(record_id)
            if not path.exists():
                raise FileNotFoundError(record_id)
            record = json.loads(path.read_text(encoding="utf-8"))
            record.setdefault("archived_at", None)
            return record

    def save(self, record: dict, *, preserve_updated_at: bool = False) -> None:
        with self._lock:
            if not preserve_updated_at:
                record["updated_at"] = utc_now()
            directory = self._item_dir(record["id"])
            directory.mkdir(parents=True, exist_ok=True)
            descriptor, temp_name = tempfile.mkstemp(
                prefix=self._temp_prefix, suffix=".tmp", dir=directory,
            )
            os.close(descriptor)
            temp_path = Path(temp_name)
            try:
                temp_path.write_text(
                    json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8",
                )
                os.replace(temp_path, self.metadata_path(record["id"]))
            finally:
                temp_path.unlink(missing_ok=True)

    def update(self, record_id: str, **changes) -> dict:
        with self._lock:
            record = self.get(record_id)
            record.update(changes)
            self.save(record)
            return record

    def list_records(
        self, *, archived: bool, limit: int | None = None, offset: int = 0,
    ) -> list[dict]:
        records: list[dict] = []
        with self._lock:
            for path in self.root.glob(f"*/{self._metadata_name}"):
                try:
                    record = json.loads(path.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    continue
                record.setdefault("archived_at", None)
                if bool(record["archived_at"]) == archived:
                    records.append(record)
        records.sort(key=lambda item: item.get("updated_at", ""), reverse=True)
        start = max(0, offset)
        return records[start:] if limit is None else records[start:start + max(0, limit)]

    def archive(self, record_id: str) -> dict:
        with self._lock:
            record = self.get(record_id)
            if record.get("status") in {"queued", "running"}:
                raise RuntimeError("任务运行中，不能归档。")
            if record.get("archived_at"):
                return record
            record["archived_at"] = utc_now()
            self.save(record)
            return record

    def restore(self, record_id: str) -> dict:
        with self._lock:
            record = self.get(record_id)
            if not record.get("archived_at"):
                return record
            record["archived_at"] = None
            self.save(record)
            return record

    def delete(self, record_id: str) -> None:
        with self._lock:
            record = self.get(record_id)
            if record.get("status") in {"queued", "running"}:
                raise RuntimeError("任务运行中，不能删除。")
            root = self.root.resolve()
            target = self._item_dir(record_id).resolve()
            if target.parent != root:
                raise ValueError("任务目录路径无效。")
            shutil.rmtree(target)


class JobRepository(JsonStore):
    def __init__(self, root: Path) -> None:
        super().__init__(root, subdir="jobs", metadata_name="job.json", temp_prefix="job-")

    def create(self, title: str = "") -> dict:
        return super().create(title=title)

    def _new_record(self, record_id: str, now: str, title: str = "") -> dict:
        return {
            "id": record_id,
            "title": title.strip() or "待命名岗位",
            "status": "draft",
            "stage": "等待上传",
            "progress": 0,
            "created_at": now,
            "updated_at": now,
            "archived_at": None,
            "jd_file": "",
            "criteria_jd_file": "",
            "resume_files": [],
            "resume_hashes": {},
            "completed": 0,
            "total": 0,
            "reviewed": 0,
            "elapsed_seconds": 0,
            "errors": [],
            "results": [],
            "output_file": "",
            "criteria_file": "",
            "feishu_notification_version": 1,
            "feishu_criteria_fingerprint": "",
            "feishu_notified_resume_hashes": [],
            "feishu_baseline_resume_hashes": [],
            "feishu_notified_at": None,
            "feishu_rescreen_pending": False,
            "feishu_baseline_at": now,
        }

    def _make_dirs(self, record_dir: Path) -> None:
        (record_dir / "resumes").mkdir(parents=True)
        (record_dir / "parsed").mkdir(parents=True)

    def job_dir(self, job_id: str) -> Path:
        return self._item_dir(job_id)

    def list_jobs(self, *, archived: bool, limit: int | None = None, offset: int = 0) -> list[dict]:
        return self.list_records(archived=archived, limit=limit, offset=offset)

    def list_recent(self, limit: int = 20) -> list[dict]:
        return self.list_jobs(archived=False, limit=limit)

    def job_size(self, job_id: str) -> int:
        directory = self.job_dir(job_id)
        if not self.metadata_path(job_id).exists():
            raise FileNotFoundError(job_id)
        total = 0
        for root, _directories, filenames in os.walk(directory, followlinks=False):
            for filename in filenames:
                try:
                    total += (Path(root) / filename).stat(follow_symlinks=False).st_size
                except OSError:
                    continue
        return total

    def storage_stats(self) -> dict[str, int]:
        active = self.list_jobs(archived=False)
        archived = self.list_jobs(archived=True)
        total_bytes = 0
        for job in [*active, *archived]:
            try:
                total_bytes += self.job_size(job["id"])
            except FileNotFoundError:
                continue
        return {
            "jobs_bytes": total_bytes,
            "job_count": len(active) + len(archived),
            "archived_count": len(archived),
        }

    def resume_path(self, job_id: str, filename: str) -> Path:
        job = self.get(job_id)
        if filename not in job.get("resume_files", []):
            raise FileNotFoundError(filename)
        directory = (self.job_dir(job_id) / "resumes").resolve()
        target = (directory / filename).resolve()
        if target.parent != directory or not target.is_file():
            raise FileNotFoundError(filename)
        return target

    def reserve_upload(self, job_id: str, category: str, original_name: str) -> tuple[str, Path]:
        filename = safe_filename(original_name)
        suffix = Path(filename).suffix.lower()
        if suffix not in ALLOWED_SUFFIXES:
            raise ValueError(f"不支持的文件格式：{suffix or '无扩展名'}")
        directory = self.job_dir(job_id) / category
        directory.mkdir(parents=True, exist_ok=True)
        stem = Path(filename).stem
        index = 2
        candidate = filename
        while (directory / candidate).exists():
            candidate = f"{stem} ({index}){suffix}"
            index += 1
        return candidate, directory / candidate
