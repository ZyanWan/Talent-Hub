"""电话确认任务的持久化存储。"""

from __future__ import annotations

from pathlib import Path

from .repository import JsonStore, safe_filename


ALLOWED_AUDIO_SUFFIXES = {".m4a", ".wav", ".mp3", ".ogg", ".opus"}


class CallRepository(JsonStore):
    """电话确认任务的持久化存储：复用 JsonStore 通用仓储逻辑。"""

    def __init__(self, root: Path) -> None:
        super().__init__(root, subdir="calls", metadata_name="record.json", temp_prefix="record-")

    def create(self, title: str = "", job_title: str = "", soft_skill_focus: str = "",
               job_id: str = "", soft_skill_dimensions: list[str] | None = None,
               title_mode: str | None = None) -> dict:
        return super().create(
            title=title, job_title=job_title, soft_skill_focus=soft_skill_focus,
            job_id=job_id, soft_skill_dimensions=soft_skill_dimensions or [],
            title_mode=title_mode,
        )

    def _new_record(self, record_id: str, now: str, title: str = "", job_title: str = "",
                     soft_skill_focus: str = "", job_id: str = "",
                     soft_skill_dimensions: list[str] | None = None,
                     title_mode: str | None = None) -> dict:
        clean_title = title.strip()
        resolved_title_mode = title_mode or ("custom" if clean_title else "auto")
        return {
            "id": record_id,
            "title": clean_title or f"{now[:10]} 电话确认",
            "title_mode": resolved_title_mode,
            "job_title": job_title.strip(),
            "job_id": job_id.strip(),
            "soft_skill_focus": soft_skill_focus.strip(),
            "soft_skill_dimensions": list(soft_skill_dimensions or []),
            "status": "draft",
            "stage": "等待上传",
            "progress": 0,
            "created_at": now,
            "updated_at": now,
            "archived_at": None,
            "audio_hashes": {},
            "items": [],
            "errors": [],
            "feishu_baseline_item_ids": [],
            "feishu_baseline_version": 1,
            "feishu_baseline_at": now,
        }

    def _make_dirs(self, record_dir: Path) -> None:
        (record_dir / "audio").mkdir(parents=True)
        (record_dir / "transcripts").mkdir(parents=True)
        (record_dir / "summaries").mkdir(parents=True)

    def call_dir(self, call_id: str) -> Path:
        return self._item_dir(call_id)

    def _ensure_feishu_baseline(self, record: dict) -> dict:
        if "feishu_baseline_version" in record:
            return record
        if record.get("status") not in {"done", "failed", "cancelled"}:
            record["feishu_baseline_item_ids"] = []
            record["feishu_baseline_version"] = 1
            record["feishu_baseline_at"] = None
            self.save(record, preserve_updated_at=True)
            return record
        baseline = [
            item.get("id") for item in record.get("items", [])
            if item.get("status") == "done" and (item.get("summary") or {}).get("narrative")
            and "feishu_push_status" not in item
        ]
        record["feishu_baseline_item_ids"] = sorted(filter(None, baseline))
        record["feishu_baseline_version"] = 1
        from .repository import utc_now
        record["feishu_baseline_at"] = utc_now()
        self.save(record, preserve_updated_at=True)
        return record

    def get(self, call_id: str) -> dict:
        with self._lock:
            return self._ensure_feishu_baseline(super().get(call_id))

    def list_calls(self, *, archived: bool, limit: int | None = None, offset: int = 0) -> list[dict]:
        return [self._ensure_feishu_baseline(record) for record in self.list_records(archived=archived, limit=limit, offset=offset)]

    def reserve_audio(self, call_id: str, original_name: str) -> tuple[str, Path]:
        filename = safe_filename(original_name)
        suffix = Path(filename).suffix.lower()
        if suffix not in ALLOWED_AUDIO_SUFFIXES:
            raise ValueError(f"不支持的文件格式：{suffix or '无扩展名'}")
        directory = self.call_dir(call_id) / "audio"
        directory.mkdir(parents=True, exist_ok=True)
        stem = Path(filename).stem
        index = 2
        candidate = filename
        while (directory / candidate).exists():
            candidate = f"{stem} ({index}){suffix}"
            index += 1
        return candidate, directory / candidate

    def add_item(self, call_id: str, audio_filename: str) -> dict:
        base = Path(audio_filename).stem
        with self._lock:
            record = self.get(call_id)
            existing_ids = {entry.get("id") for entry in record.get("items", [])}
            item_id = base
            index = 2
            while item_id in existing_ids:
                item_id = f"{base}-{index}"
                index += 1
            item = {
                "id": item_id,
                "audio_file": audio_filename,
                "candidate_name": Path(audio_filename).stem,
                "status": "queued",
                "stage": "等待处理",
                "progress": 0,
                "error": "",
                "transcript_file": "",
                "summary": None,
                "feishu_push_status": "pending",
                "feishu_pushed_at": None,
            }
            record["items"] = [*record.get("items", []), item]
            self.save(record)
            return record

    def update_item(self, call_id: str, item_id: str, **changes) -> dict:
        """原子更新单个条目：锁内读取最新记录、修改指定条目并保存，避免覆盖他条目状态。"""
        with self._lock:
            record = self.get(call_id)
            item = next(
                (entry for entry in record.get("items", []) if entry.get("id") == item_id),
                None,
            )
            if item is None:
                raise KeyError(item_id)
            item.update(changes)
            self.save(record)
            return record
