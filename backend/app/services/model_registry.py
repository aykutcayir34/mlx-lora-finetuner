"""Model registry service: local HF-model directory scan, HF Hub search proxy,
background snapshot downloads with live progress, and deletion.

Owned by Wave-1 T2. No `mlx` imports here — this module must stay importable
without an MLX-capable Apple Silicon runtime (e.g. in CI on any OS).
"""

from __future__ import annotations

import asyncio
import io
import json
import os
import shutil
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

import aiosqlite
from huggingface_hub import HfApi, snapshot_download
from huggingface_hub.utils import HfHubHTTPError
from tqdm import tqdm

from app.config import Settings
from app.core.errors import ConflictError, InternalError, NotFoundError, TrainingActiveError
from app.db.database import get_connection
from app.db.repositories import DownloadsRepo, RunsRepo
from app.schemas.models import DownloadInfo, HFSearchResult, ModelInfo, Quantization

# Minimum interval between DB progress snapshots for a single in-flight download.
_PERSIST_INTERVAL_SECONDS = 0.5


def _dirname_for_model_id(model_id: str) -> str:
    org, _, name = model_id.partition("/")
    if not name:
        # No "/" in model_id — fall back to using the whole string as the name.
        return f"_{org}"
    return f"{org}__{name}"


def _model_id_for_dirname(dirname: str) -> str:
    org, sep, name = dirname.partition("__")
    if not sep:
        return dirname
    return f"{org}/{name}"


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


@dataclass
class _DownloadState:
    model_id: str
    status: str = "running"
    bytes_done: int = 0
    bytes_total: int = 0
    files_done: int = 0
    files_total: int = 0
    error: str | None = None
    subscribers: list[asyncio.Queue] = field(default_factory=list)
    lock: threading.Lock = field(default_factory=threading.Lock)
    loop: asyncio.AbstractEventLoop | None = None
    last_persist_ts: float = 0.0
    task: asyncio.Task | None = None

    def progress_frame(self) -> dict:
        with self.lock:
            return {
                "type": "progress",
                "bytes_done": self.bytes_done,
                "bytes_total": self.bytes_total,
                "files_done": self.files_done,
                "files_total": self.files_total,
            }

    def terminal_frame(self) -> dict | None:
        with self.lock:
            if self.status == "completed":
                return {"type": "done"}
            if self.status == "failed":
                return {"type": "error", "message": self.error or "download failed"}
            return None


class ModelRegistry:
    """Owns the local model directory scan, HF search, and download lifecycle
    for a single `data_dir` (one instance per running app / test)."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._size_cache: dict[str, tuple[float, int]] = {}
        self._downloads: dict[str, _DownloadState] = {}

    # ------------------------------------------------------------------ #
    # Local scan
    # ------------------------------------------------------------------ #

    def _dir_size_bytes(self, model_dir: Path) -> int:
        mtime = model_dir.stat().st_mtime
        cached = self._size_cache.get(str(model_dir))
        if cached is not None and cached[0] == mtime:
            return cached[1]

        total = 0
        for dirpath, _dirnames, filenames in os.walk(model_dir):
            for filename in filenames:
                fp = Path(dirpath) / filename
                try:
                    total += fp.stat().st_size
                except OSError:
                    continue
        self._size_cache[str(model_dir)] = (mtime, total)
        return total

    def _read_model_info(self, model_dir: Path) -> ModelInfo | None:
        config_path = model_dir / "config.json"
        if not config_path.is_file():
            return None
        try:
            config = json.loads(config_path.read_text())
        except (OSError, json.JSONDecodeError):
            config = {}

        quantization = None
        raw_quant = config.get("quantization") if isinstance(config, dict) else None
        if isinstance(raw_quant, dict) and "bits" in raw_quant and "group_size" in raw_quant:
            try:
                quantization = Quantization(
                    bits=int(raw_quant["bits"]), group_size=int(raw_quant["group_size"])
                )
            except (TypeError, ValueError):
                quantization = None

        model_type = config.get("model_type", "unknown") if isinstance(config, dict) else "unknown"

        stat = model_dir.stat()
        return ModelInfo(
            model_id=_model_id_for_dirname(model_dir.name),
            path=str(model_dir.resolve()),
            size_bytes=self._dir_size_bytes(model_dir),
            model_type=model_type,
            quantization=quantization,
            downloaded_at=datetime.fromtimestamp(stat.st_mtime, tz=UTC).isoformat(),
        )

    async def list_local_models(self) -> list[ModelInfo]:
        return await asyncio.to_thread(self._list_local_models_sync)

    def _list_local_models_sync(self) -> list[ModelInfo]:
        models_dir = self._settings.models_dir
        if not models_dir.is_dir():
            return []
        results: list[ModelInfo] = []
        for entry in sorted(models_dir.iterdir()):
            if not entry.is_dir():
                continue
            info = self._read_model_info(entry)
            if info is not None:
                results.append(info)
        return results

    async def _local_model_ids(self) -> set[str]:
        return {m.model_id for m in await self.list_local_models()}

    def _local_model_dir(self, model_id: str) -> Path:
        return self._settings.models_dir / _dirname_for_model_id(model_id)

    # ------------------------------------------------------------------ #
    # HF Hub search
    # ------------------------------------------------------------------ #

    async def search_models(
        self, q: str | None, author: str | None, limit: int
    ) -> list[HFSearchResult]:
        effective_author = author
        if effective_author is None and (q is None or "/" not in q):
            effective_author = "mlx-community"

        try:
            hits = await asyncio.to_thread(
                self._search_models_sync, q, effective_author, limit
            )
        except HfHubHTTPError as exc:
            raise InternalError(
                message=f"Hugging Face Hub arama başarısız oldu: {exc}", status_code=502
            ) from exc
        except Exception as exc:  # network errors, timeouts, etc.
            raise InternalError(
                message=f"Hugging Face Hub'a ulaşılamadı: {exc}", status_code=502
            ) from exc

        local_ids = await self._local_model_ids()
        results: list[HFSearchResult] = []
        for hit in hits:
            model_id = hit.id
            results.append(
                HFSearchResult(
                    model_id=model_id,
                    downloads=hit.downloads or 0,
                    likes=hit.likes or 0,
                    size_bytes=None,
                    downloaded=model_id in local_ids,
                )
            )
        return results

    def _search_models_sync(self, q: str | None, author: str | None, limit: int) -> list:
        api = HfApi(token=self._settings.hf_token)
        return list(
            api.list_models(search=q, author=author, limit=limit)
        )

    def _estimate_repo_size_bytes(self, model_id: str) -> int | None:
        try:
            api = HfApi(token=self._settings.hf_token)
            info = api.model_info(model_id, files_metadata=True)
        except Exception:
            return None
        if not info.siblings:
            return None
        sizes = [s.size for s in info.siblings if s.size is not None]
        if not sizes:
            return None
        return sum(sizes)

    # ------------------------------------------------------------------ #
    # Downloads
    # ------------------------------------------------------------------ #

    async def start_download(
        self, model_id: str, conn: aiosqlite.Connection
    ) -> DownloadInfo:
        downloads_repo = DownloadsRepo(conn)

        active = await downloads_repo.get_active_by_model(model_id)
        if active is not None:
            raise ConflictError(message=f"'{model_id}' zaten indiriliyor")

        if self._local_model_dir(model_id).is_dir():
            local_ids = await self._local_model_ids()
            if model_id in local_ids:
                raise ConflictError(message=f"'{model_id}' zaten indirilmiş")

        estimated_size = await asyncio.to_thread(self._estimate_repo_size_bytes, model_id)
        if estimated_size is not None:
            self._settings.models_dir.mkdir(parents=True, exist_ok=True)
            free_bytes = shutil.disk_usage(self._settings.models_dir).free
            if free_bytes < estimated_size:
                raise ConflictError(
                    message=(
                        f"Yetersiz disk alanı: gereken ~{estimated_size} bayt, "
                        f"kullanılabilir {free_bytes} bayt"
                    ),
                    detail={"estimated_size_bytes": estimated_size, "free_bytes": free_bytes},
                )

        download_id = f"dl_{uuid.uuid4().hex[:12]}"
        started_at = _now_iso()
        await downloads_repo.insert(
            download_id=download_id,
            model_id=model_id,
            status="running",
            bytes_done=0,
            bytes_total=0,
            files_done=0,
            files_total=0,
            started_at=started_at,
        )

        state = _DownloadState(model_id=model_id, loop=asyncio.get_running_loop())
        self._downloads[download_id] = state
        # Keep a strong reference on the state so the task isn't GC'd mid-flight,
        # and so callers (WS handler, tests) can await it if needed.
        state.task = asyncio.create_task(self._run_download(download_id, model_id))

        return DownloadInfo(
            download_id=download_id,
            model_id=model_id,
            status="running",
            bytes_done=0,
            bytes_total=0,
            files_done=0,
            files_total=0,
            error=None,
            started_at=started_at,
            finished_at=None,
        )

    async def _run_download(self, download_id: str, model_id: str) -> None:
        state = self._downloads[download_id]
        target_dir = self._local_model_dir(model_id)
        target_dir.mkdir(parents=True, exist_ok=True)

        conn = await get_connection(self._settings.db_path)
        try:
            tqdm_class = self._make_tqdm_class(download_id)
            try:
                await asyncio.to_thread(
                    snapshot_download,
                    repo_id=model_id,
                    local_dir=str(target_dir),
                    tqdm_class=tqdm_class,
                    token=self._settings.hf_token,
                )
            except Exception as exc:
                with state.lock:
                    state.status = "failed"
                    state.error = str(exc)
                await DownloadsRepo(conn).finish(
                    download_id, status="failed", finished_at=_now_iso(), error=str(exc)
                )
                self._broadcast_terminal(download_id)
                return

            with state.lock:
                state.status = "completed"
            self._size_cache.pop(str(target_dir), None)
            await DownloadsRepo(conn).update_progress(
                download_id,
                bytes_done=state.bytes_done,
                bytes_total=state.bytes_total or state.bytes_done,
                files_done=state.files_done,
                files_total=state.files_total or state.files_done,
            )
            await DownloadsRepo(conn).finish(
                download_id, status="completed", finished_at=_now_iso(), error=None
            )
            self._broadcast_terminal(download_id)
        finally:
            await conn.close()

    def _make_tqdm_class(self, download_id: str) -> type[tqdm]:
        registry = self

        class _ProgressTqdm(tqdm):
            def __init__(self, *args, **kwargs):
                desc = kwargs.get("desc") or ""
                unit = kwargs.get("unit")
                if unit == "B" and desc == "Downloading bytes":
                    self._mlxlf_kind = "bytes"
                elif "Fetching" in desc and desc.endswith("files"):
                    self._mlxlf_kind = "files"
                else:
                    self._mlxlf_kind = None
                self._mlxlf_total = None
                kwargs.setdefault("file", io.StringIO())
                super().__init__(*args, **kwargs)

            @property
            def total(self):  # type: ignore[override]
                return self._mlxlf_total

            @total.setter
            def total(self, value):
                self._mlxlf_total = value
                if self._mlxlf_kind == "bytes":
                    registry._set_total(download_id, "bytes_total", value)
                elif self._mlxlf_kind == "files":
                    registry._set_total(download_id, "files_total", value)

            def update(self, n=1):
                result = super().update(n)
                if self._mlxlf_kind == "bytes":
                    registry._add_done(download_id, "bytes_done", n or 0)
                elif self._mlxlf_kind == "files":
                    registry._add_done(download_id, "files_done", n or 0)
                return result

        return _ProgressTqdm

    def _set_total(self, download_id: str, field_name: str, value) -> None:
        state = self._downloads.get(download_id)
        if state is None:
            return
        with state.lock:
            setattr(state, field_name, int(value or 0))
        self._notify(download_id)

    def _add_done(self, download_id: str, field_name: str, n) -> None:
        state = self._downloads.get(download_id)
        if state is None:
            return
        with state.lock:
            setattr(state, field_name, getattr(state, field_name) + int(n))
        self._notify(download_id)

    def _notify(self, download_id: str) -> None:
        state = self._downloads.get(download_id)
        if state is None or state.loop is None:
            return
        state.loop.call_soon_threadsafe(self._deliver_progress, download_id)

    def _deliver_progress(self, download_id: str) -> None:
        state = self._downloads.get(download_id)
        if state is None:
            return
        frame = state.progress_frame()
        for queue in list(state.subscribers):
            queue.put_nowait(frame)

        now = time.monotonic()
        if now - state.last_persist_ts >= _PERSIST_INTERVAL_SECONDS:
            state.last_persist_ts = now
            asyncio.ensure_future(self._persist_progress(download_id))

    async def _persist_progress(self, download_id: str) -> None:
        state = self._downloads.get(download_id)
        if state is None:
            return
        frame = state.progress_frame()
        conn = await get_connection(self._settings.db_path)
        try:
            await DownloadsRepo(conn).update_progress(
                download_id,
                bytes_done=frame["bytes_done"],
                bytes_total=frame["bytes_total"],
                files_done=frame["files_done"],
                files_total=frame["files_total"],
            )
        finally:
            await conn.close()

    def _broadcast_terminal(self, download_id: str) -> None:
        state = self._downloads.get(download_id)
        if state is None:
            return
        frame = state.terminal_frame()
        if frame is None:
            return
        for queue in list(state.subscribers):
            queue.put_nowait(frame)
            queue.put_nowait(None)
        state.subscribers.clear()

    async def list_downloads(self, conn: aiosqlite.Connection) -> list[DownloadInfo]:
        rows = await DownloadsRepo(conn).list_()
        results: list[DownloadInfo] = []
        for row in rows:
            state = self._downloads.get(row["download_id"])
            if state is not None and row["status"] == "running":
                frame = state.progress_frame()
                bytes_done, bytes_total = frame["bytes_done"], frame["bytes_total"]
                files_done, files_total = frame["files_done"], frame["files_total"]
            else:
                bytes_done = row["bytes_done"] or 0
                bytes_total = row["bytes_total"] or 0
                files_done = row["files_done"] or 0
                files_total = row["files_total"] or 0
            results.append(
                DownloadInfo(
                    download_id=row["download_id"],
                    model_id=row["model_id"],
                    status=row["status"],
                    bytes_done=bytes_done,
                    bytes_total=bytes_total,
                    files_done=files_done,
                    files_total=files_total,
                    error=row["error"],
                    started_at=row["started_at"],
                    finished_at=row["finished_at"],
                )
            )
        return results

    # ------------------------------------------------------------------ #
    # WS subscription
    # ------------------------------------------------------------------ #

    async def subscribe(self, download_id: str, conn: aiosqlite.Connection) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue()
        state = self._downloads.get(download_id)
        if state is not None:
            with state.lock:
                terminal = state.status in ("completed", "failed")
                frame = {
                    "type": "progress",
                    "bytes_done": state.bytes_done,
                    "bytes_total": state.bytes_total,
                    "files_done": state.files_done,
                    "files_total": state.files_total,
                }
                if not terminal:
                    state.subscribers.append(queue)
            queue.put_nowait(frame)
            if terminal:
                term_frame = state.terminal_frame()
                if term_frame is not None:
                    queue.put_nowait(term_frame)
                queue.put_nowait(None)
            return queue

        row = await DownloadsRepo(conn).get(download_id)
        if row is None:
            queue.put_nowait({"type": "error", "message": f"unknown download_id '{download_id}'"})
            queue.put_nowait(None)
            return queue

        if row["status"] == "completed":
            queue.put_nowait({"type": "done"})
        elif row["status"] == "failed":
            queue.put_nowait({"type": "error", "message": row["error"] or "download failed"})
        else:
            queue.put_nowait(
                {
                    "type": "progress",
                    "bytes_done": row["bytes_done"] or 0,
                    "bytes_total": row["bytes_total"] or 0,
                    "files_done": row["files_done"] or 0,
                    "files_total": row["files_total"] or 0,
                }
            )
        queue.put_nowait(None)
        return queue

    def unsubscribe(self, download_id: str, queue: asyncio.Queue) -> None:
        state = self._downloads.get(download_id)
        if state is None:
            return
        with state.lock:
            if queue in state.subscribers:
                state.subscribers.remove(queue)

    # ------------------------------------------------------------------ #
    # Delete
    # ------------------------------------------------------------------ #

    async def delete_model(self, model_id: str, conn: aiosqlite.Connection) -> None:
        model_dir = self._local_model_dir(model_id)
        if not model_dir.is_dir():
            raise NotFoundError(message=f"model '{model_id}' bulunamadı")

        active_runs = await RunsRepo(conn).list_active()
        for run in active_runs:
            if run["model_id"] == model_id:
                raise TrainingActiveError(
                    message=f"'{model_id}' modeli aktif bir training job tarafından kullanılıyor"
                )

        await asyncio.to_thread(shutil.rmtree, model_dir)
        self._size_cache.pop(str(model_dir), None)


_registries: dict[Path, ModelRegistry] = {}


def get_model_registry(settings: Settings) -> ModelRegistry:
    """Per-`data_dir` singleton (there's exactly one `data_dir` in production;
    tests get a fresh registry per `tmp_path`)."""
    key = settings.data_dir
    registry = _registries.get(key)
    if registry is None:
        registry = ModelRegistry(settings)
        _registries[key] = registry
    return registry
