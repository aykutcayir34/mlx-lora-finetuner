"""Hugging Face Hub dataset search + streaming/cancellable import.

Streams a remote HF dataset row-by-row (`datasets` lib, `streaming=True`) into
a raw JSONL temp file, then registers it as a regular local dataset via the
existing `DatasetService.upload` (format auto-detected, never duplicated
here). The `datasets` library itself is a heavy, optional-at-import-time
dependency, so it is imported lazily inside `_load_dataset_stream` only —
this module must otherwise stay import-light (importable in CI without the
package installed at collection time, mirroring `app/services/recipe_service.py`
for pypdf/python-docx).

No mlx imports here.
"""

from __future__ import annotations

import asyncio
import json
import re
import shutil
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated

import aiosqlite
from fastapi import BackgroundTasks, Depends, UploadFile
from huggingface_hub import HfApi
from huggingface_hub.utils import HfHubHTTPError

from app.config import Settings, get_settings
from app.core.errors import ConflictError, InternalError, NotFoundError, ValidationAppError
from app.db.repositories import DatasetImportsRepo, DatasetsRepo
from app.schemas.datasets import (
    DatasetImportAccepted,
    DatasetImportInfo,
    DatasetImportRequest,
    HFDatasetSearchResult,
)
from app.services.dataset_service import get_dataset_service

_TERMINAL_STATUSES = ("completed", "failed", "cancelled")
_PERSIST_ROW_INTERVAL = 100

# Sentinel returned by `_safe_next` instead of letting `StopIteration` cross
# the asyncio.to_thread boundary (asyncio explicitly forbids a StopIteration
# being set as a Future's exception).
_STREAM_END = object()


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _new_import_id() -> str:
    return f"di_{uuid.uuid4().hex[:12]}"


def _slugify(hf_dataset_id: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9._-]+", "-", hf_dataset_id)
    return slug.strip("-") or hf_dataset_id


def _safe_next(iterator):
    try:
        return next(iterator)
    except StopIteration:
        return _STREAM_END


def _project_row(row: dict, column_map: dict[str, str]) -> dict:
    """Project `row` to exactly the canonical keys in `column_map`.

    Raises `KeyError(source_col)` if a mapped source column is absent from
    this particular row, so the caller can report both the missing column
    and the row's actual columns.
    """
    projected = {}
    for canonical_key, source_col in column_map.items():
        if source_col not in row:
            raise KeyError(source_col)
        projected[canonical_key] = row[source_col]
    return projected


def _load_dataset_stream(hf_dataset_id: str, config: str | None, split: str):
    import datasets

    return datasets.load_dataset(hf_dataset_id, config, split=split, streaming=True)


class DatasetImportService:
    """Orchestrates HF dataset search + background streaming import lifecycle."""

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        # Keyed by import_id, held for the process lifetime (mirrors
        # ModelRegistry._downloads). Used for cancellation + a more-current
        # rows_written than the throttled DB persistence.
        self._cancel_events: dict[str, threading.Event] = {}
        self._progress: dict[str, int] = {}

    async def _open_conn(self) -> aiosqlite.Connection:
        conn = await aiosqlite.connect(self._settings.db_path)
        conn.row_factory = aiosqlite.Row
        return conn

    def _job_dir(self, import_id: str) -> Path:
        return self._settings.cache_dir / "dataset_imports" / import_id

    # ------------------------------------------------------------------ #
    # Search
    # ------------------------------------------------------------------ #

    def _search_datasets_sync(self, q: str | None, limit: int) -> list:
        api = HfApi(token=self._settings.hf_token)
        return list(api.list_datasets(search=q, limit=limit))

    async def search(
        self, conn: aiosqlite.Connection, q: str | None, limit: int
    ) -> list[HFDatasetSearchResult]:
        try:
            hits = await asyncio.to_thread(self._search_datasets_sync, q, limit)
        except HfHubHTTPError as exc:
            raise InternalError(
                message=f"Hugging Face Hub arama başarısız oldu: {exc}", status_code=502
            ) from exc
        except Exception as exc:  # network errors, timeouts, etc.
            raise InternalError(
                message=f"Hugging Face Hub'a ulaşılamadı: {exc}", status_code=502
            ) from exc

        rows = await DatasetImportsRepo(conn).list_()
        imported_ids = {r["hf_dataset_id"] for r in rows if r["status"] == "completed"}

        results: list[HFDatasetSearchResult] = []
        for hit in hits:
            dataset_id = hit.id
            results.append(
                HFDatasetSearchResult(
                    dataset_id=dataset_id,
                    downloads=hit.downloads or 0,
                    likes=hit.likes or 0,
                    imported=dataset_id in imported_ids,
                )
            )
        return results

    # ------------------------------------------------------------------ #
    # Import lifecycle
    # ------------------------------------------------------------------ #

    async def start_import(
        self,
        conn: aiosqlite.Connection,
        background_tasks: BackgroundTasks,
        body: DatasetImportRequest,
    ) -> DatasetImportAccepted:
        repo = DatasetImportsRepo(conn)
        active = await repo.get_active_by_hf_id(body.dataset_id)
        if active is not None:
            raise ConflictError(message=f"'{body.dataset_id}' zaten import ediliyor")

        # A format-detection failure keeps its downloaded JSONL (see
        # `_run_job`) and nothing else ever sweeps those directories, so
        # re-importing the same dataset is what supersedes them. Without this
        # every failed attempt at the same dataset leaves another copy behind
        # — four tries at an 8800-row dataset, four files.
        for previous_id in await repo.list_ids_by_hf_id(body.dataset_id):
            shutil.rmtree(self._job_dir(previous_id), ignore_errors=True)

        import_id = _new_import_id()
        name = body.name or _slugify(body.dataset_id)
        started_at = _now()

        job_dir = self._job_dir(import_id)
        job_dir.mkdir(parents=True, exist_ok=True)
        output_path = job_dir / "output.jsonl"

        await repo.insert(
            id=import_id,
            hf_dataset_id=body.dataset_id,
            config=body.config,
            split=body.split,
            name=name,
            max_rows=body.max_rows,
            status="running",
            started_at=started_at,
        )

        self._cancel_events[import_id] = threading.Event()
        self._progress[import_id] = 0

        background_tasks.add_task(
            self._run_job,
            import_id,
            body.dataset_id,
            body.config,
            body.split,
            name,
            body.max_rows,
            output_path,
            body.column_map,
        )

        return DatasetImportAccepted(import_id=import_id, dataset_id=body.dataset_id)

    async def _run_job(
        self,
        import_id: str,
        hf_dataset_id: str,
        config: str | None,
        split: str,
        name: str,
        max_rows: int | None,
        output_path: Path,
        column_map: dict[str, str] | None = None,
    ) -> None:
        conn = await self._open_conn()
        repo = DatasetImportsRepo(conn)
        cancel_event = self._cancel_events.get(import_id) or threading.Event()
        try:
            try:
                stream = await asyncio.to_thread(_load_dataset_stream, hf_dataset_id, config, split)
                iterator = iter(stream)
            except Exception as exc:
                await repo.finish_if_active(
                    import_id, "failed", None, f"dataset yüklenemedi: {exc}", _now()
                )
                self._cleanup(import_id)
                return

            count = 0
            try:
                with output_path.open("w", encoding="utf-8") as out:
                    while True:
                        if cancel_event.is_set():
                            break
                        row = await asyncio.to_thread(_safe_next, iterator)
                        if row is _STREAM_END:
                            break
                        if column_map is not None:
                            try:
                                row = _project_row(row, column_map)
                            except KeyError as exc:
                                missing_col = exc.args[0]
                                actual_cols = (
                                    ", ".join(row.keys()) if isinstance(row, dict) else ""
                                )
                                await repo.finish_if_active(
                                    import_id,
                                    "failed",
                                    None,
                                    f"column_map kaynak kolonu bulunamadı: '{missing_col}' "
                                    f"(satırdaki kolonlar: {actual_cols})",
                                    _now(),
                                )
                                self._cleanup(import_id)
                                return
                        try:
                            line = json.dumps(row, ensure_ascii=False)
                        except TypeError:
                            await repo.finish_if_active(
                                import_id,
                                "failed",
                                None,
                                "bu dataset metin tabanlı değil (JSON serileştirilemeyen alan içeriyor)",
                                _now(),
                            )
                            self._cleanup(import_id)
                            return
                        out.write(line + "\n")
                        count += 1
                        self._progress[import_id] = count
                        if count % _PERSIST_ROW_INTERVAL == 0:
                            await repo.update_progress(import_id, count)
                        if max_rows is not None and count >= max_rows:
                            break
            except Exception as exc:
                await repo.finish_if_active(import_id, "failed", None, str(exc), _now())
                self._cleanup(import_id)
                return

            if cancel_event.is_set():
                # The worker (this coroutine) is the single owner of the
                # terminal DB write and the temp-dir cleanup on cancellation;
                # `cancel_import` only sets the event.
                await repo.update_progress(import_id, count)
                await repo.finish_if_active(import_id, "cancelled", None, None, _now())
                self._cleanup(import_id)
                return

            if count == 0:
                await repo.finish_if_active(
                    import_id, "failed", None, "dataset'ten hiç satır okunamadı", _now()
                )
                self._cleanup(import_id)
                return

            dataset_service = get_dataset_service()
            datasets_repo = DatasetsRepo(conn)
            try:
                with output_path.open("rb") as fh:
                    upload_file = UploadFile(file=fh, filename=f"{name}.jsonl")
                    dataset_info = await dataset_service.upload(datasets_repo, upload_file, name)
            except ValidationAppError as exc:
                # `exc.message` already names the offending line, its keys and
                # the accepted formats, so appending the columns again here
                # would only repeat itself.
                #
                # Persist the real count first: row writes are only
                # checkpointed every _PERSIST_ROW_INTERVAL rows, so without
                # this the user is handed the path of a 150-row file while
                # `rows_written` still reads 100.
                await repo.update_progress(import_id, count)
                await repo.finish_if_active(
                    import_id,
                    "failed",
                    None,
                    f"{exc.message} — indirilen satırlar korundu: {output_path}",
                    _now(),
                )
                # Format detection is the one failure mode where the download
                # itself succeeded: keep the JSONL so a retry (e.g. with a
                # `column_map`, or a direct upload of the file) does not need
                # to re-stream the whole dataset. Only drop the in-memory
                # bookkeeping, not the temp dir.
                self._cancel_events.pop(import_id, None)
                self._progress.pop(import_id, None)
                return

            await repo.update_progress(import_id, count)
            await repo.finish_if_active(import_id, "completed", dataset_info.dataset_id, None, _now())
            self._cleanup(import_id)
        except Exception as exc:
            # Every branch above terminalizes the row itself; this catches what
            # none of them expect — a failing DB write, an unwritable cache
            # dir. Without it the row stays `running` forever: this worker is
            # the only thing that ever finalizes it, `cancel_import` merely
            # signals it, and the duplicate guard would then reject this
            # dataset for the life of the install.
            await repo.finish_if_active(
                import_id, "failed", None, f"beklenmeyen hata: {exc}", _now()
            )
            self._cleanup(import_id)
        finally:
            await conn.close()

    def _cleanup(self, import_id: str) -> None:
        shutil.rmtree(self._job_dir(import_id), ignore_errors=True)
        self._cancel_events.pop(import_id, None)
        self._progress.pop(import_id, None)

    def _row_to_info(self, row: dict) -> DatasetImportInfo:
        rows_written = row["rows_written"] or 0
        if row["status"] == "running":
            in_memory = self._progress.get(row["id"])
            if in_memory is not None:
                rows_written = max(rows_written, in_memory)
        return DatasetImportInfo(
            import_id=row["id"],
            hf_dataset_id=row["hf_dataset_id"],
            config=row["config"],
            split=row["split"],
            status=row["status"],
            rows_written=rows_written,
            dataset_id=row["dataset_id"],
            error=row["error"],
            started_at=row["started_at"],
            finished_at=row["finished_at"],
        )

    async def list_imports(self, conn: aiosqlite.Connection) -> list[DatasetImportInfo]:
        rows = await DatasetImportsRepo(conn).list_()
        return [self._row_to_info(row) for row in rows]

    async def cancel_import(self, conn: aiosqlite.Connection, import_id: str) -> DatasetImportInfo:
        repo = DatasetImportsRepo(conn)
        row = await repo.get(import_id)
        if row is None:
            raise NotFoundError(f"import '{import_id}' bulunamadı")
        if row["status"] in _TERMINAL_STATUSES:
            raise ConflictError(message=f"'{import_id}' zaten sonlanmış durumda")

        event = self._cancel_events.get(import_id)
        if event is not None:
            # A live worker in this process owns the terminal DB write and the
            # temp-dir cleanup (see `_run_job`) — writing/cleaning here would
            # race its in-flight writes to `output.jsonl` and its own
            # `finish(...)` (a user-cancelled import could flip back to
            # `completed`, or the writer could crash when its directory
            # disappears under it). Only signal it and report current state;
            # the row flips to `cancelled` once the worker observes the event.
            event.set()
        else:
            # No live worker in this process (e.g. a `running` row left over
            # from a previous process, or the event was already dropped) — the
            # cancel would otherwise never terminalize, so finalize here.
            # `finish_if_active` guards the race where the worker terminalized
            # the row between our status check above and this write.
            await repo.finish_if_active(import_id, "cancelled", None, None, _now())
            self._cleanup(import_id)

        updated = await repo.get(import_id)
        assert updated is not None
        return self._row_to_info(updated)


# Keyed by `id(settings)` so a fresh Settings object (e.g. after
# `get_settings.cache_clear()` between tests) transparently produces a fresh
# DatasetImportService instead of reusing one bound to a stale data
# directory. Mirrors get_recipe_service/get_export_service.
_service_cache: dict[int, DatasetImportService] = {}


def get_dataset_import_service(
    settings: Annotated[Settings, Depends(get_settings)],
) -> DatasetImportService:
    key = id(settings)
    if key not in _service_cache:
        _service_cache.clear()
        _service_cache[key] = DatasetImportService(settings)
    return _service_cache[key]
