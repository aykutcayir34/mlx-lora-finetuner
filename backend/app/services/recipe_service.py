"""Data Recipes: deterministic document→dataset conversion (no LLM in the loop).

pdf/docx/txt/md uploads are extracted to plain text, chunked (character-based
with overlap, preferring paragraph boundaries), and emitted as `text` rows.
csv uploads are read via the stdlib `csv` module and emitted as `completions`
or `chat` rows. The produced JSONL is registered as a regular dataset via the
existing `DatasetService` (reused, not duplicated) so it shows up in
`GET /datasets` with the correct format auto-detected.

Extraction libraries (pypdf, python-docx) are imported lazily inside the
functions that use them to keep the app import-light.
"""

from __future__ import annotations

import asyncio
import csv
import json
import re
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated

import aiosqlite
from fastapi import BackgroundTasks, Depends, UploadFile
from pydantic import BaseModel

from app.config import Settings, get_settings
from app.core.errors import NotFoundError, ValidationAppError
from app.db.repositories import DatasetsRepo, RecipeJobsRepo
from app.services.dataset_service import get_dataset_service

_DOC_EXTS = {".pdf", ".docx", ".txt", ".md"}
_CSV_EXT = ".csv"
_ALLOWED_EXTS = _DOC_EXTS | {_CSV_EXT}
_DOC_OUTPUT_FORMAT = "text"
_CSV_OUTPUT_FORMATS = ("completions", "chat")
_MIN_CHUNK_SIZE = 100


class RecipeJobInfo(BaseModel):
    recipe_job_id: str
    status: str
    rows_emitted: int
    preview_rows: list[dict]
    dataset_id: str | None
    error: str | None


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _new_job_id() -> str:
    return f"rj_{uuid.uuid4().hex[:12]}"


def _file_ext(filename: str | None) -> str:
    return Path(filename or "").suffix.lower()


# --------------------------------------------------------------------------
# Extraction (pdf/docx/txt/md -> plain text)
# --------------------------------------------------------------------------


def _extract_pdf_text(path: Path) -> str:
    from pypdf import PdfReader

    reader = PdfReader(str(path))
    pages = [page.extract_text() or "" for page in reader.pages]
    return "\n\n".join(pages)


def _extract_docx_text(path: Path) -> str:
    import docx

    document = docx.Document(str(path))
    paragraphs = [p.text for p in document.paragraphs]
    return "\n\n".join(paragraphs)


def _extract_plain_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def extract_text(path: Path, ext: str) -> str:
    if ext == ".pdf":
        return _extract_pdf_text(path)
    if ext == ".docx":
        return _extract_docx_text(path)
    return _extract_plain_text(path)


# --------------------------------------------------------------------------
# Chunking (character-based with overlap, paragraph-boundary aware)
# --------------------------------------------------------------------------


def chunk_text(text: str, chunk_size: int, chunk_overlap: int) -> list[str]:
    """Split `text` into chunks of at most `chunk_size` chars.

    Prefers splitting on paragraph boundaries (blank lines); a paragraph
    longer than `chunk_size` on its own is windowed directly. Each chunk
    after the first is seeded with the last `chunk_overlap` chars of the
    previous chunk so no context is lost across a split.
    """
    text = text.strip()
    if not text:
        return []
    if chunk_overlap >= chunk_size:
        chunk_overlap = 0

    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    if not paragraphs:
        return []

    chunks: list[str] = []
    current = ""

    def flush() -> None:
        nonlocal current
        if current:
            chunks.append(current)
            current = current[-chunk_overlap:] if chunk_overlap else ""

    for para in paragraphs:
        if len(para) > chunk_size:
            flush()
            start = 0
            while start < len(para):
                end = start + chunk_size
                chunks.append(para[start:end])
                start = end - chunk_overlap if chunk_overlap else end
            current = ""
            continue

        candidate = f"{current}\n\n{para}" if current else para
        if len(candidate) > chunk_size:
            flush()
            candidate = f"{current}\n\n{para}" if current else para
        current = candidate

    if current:
        chunks.append(current)
    return chunks


# --------------------------------------------------------------------------
# CSV reading + emitters
# --------------------------------------------------------------------------


def read_csv_rows(path: Path) -> tuple[list[str], list[dict]]:
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        fieldnames = list(reader.fieldnames or [])
        rows = list(reader)
    return fieldnames, rows


def emit_csv_rows(
    rows: list[dict],
    output_format: str,
    prompt_column: str,
    completion_column: str,
    system_prompt: str | None,
) -> list[dict]:
    emitted: list[dict] = []
    for row in rows:
        prompt = (row.get(prompt_column) or "").strip()
        completion = (row.get(completion_column) or "").strip()
        if not prompt or not completion:
            continue
        if output_format == "completions":
            emitted.append({"prompt": prompt, "completion": completion})
        else:  # chat
            messages = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})
            messages.append({"role": "user", "content": prompt})
            messages.append({"role": "assistant", "content": completion})
            emitted.append({"messages": messages})
    return emitted


class RecipeService:
    """Orchestrates document upload -> background conversion -> dataset registration."""

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()

    async def _open_conn(self) -> aiosqlite.Connection:
        conn = await aiosqlite.connect(self._settings.db_path)
        conn.row_factory = aiosqlite.Row
        return conn

    def _validate_request(
        self,
        ext: str,
        output_format: str,
        chunk_size: int,
        chunk_overlap: int,
        prompt_column: str | None,
        completion_column: str | None,
    ) -> None:
        if ext not in _ALLOWED_EXTS:
            raise ValidationAppError(
                f"unsupported file type '{ext or '(none)'}'; expected one of "
                f"{sorted(_ALLOWED_EXTS)}"
            )
        if ext in _DOC_EXTS:
            if output_format != _DOC_OUTPUT_FORMAT:
                raise ValidationAppError(
                    f"output_format must be '{_DOC_OUTPUT_FORMAT}' for '{ext}' uploads "
                    f"(got '{output_format}')"
                )
            if chunk_size < _MIN_CHUNK_SIZE:
                raise ValidationAppError(f"chunk_size must be >= {_MIN_CHUNK_SIZE}")
            if chunk_overlap < 0 or chunk_overlap >= chunk_size:
                raise ValidationAppError("chunk_overlap must be >= 0 and less than chunk_size")
        else:  # csv
            if output_format not in _CSV_OUTPUT_FORMATS:
                raise ValidationAppError(
                    f"output_format must be one of {list(_CSV_OUTPUT_FORMATS)} for csv uploads "
                    f"(got '{output_format}')"
                )
            if not prompt_column or not completion_column:
                raise ValidationAppError(
                    "prompt_column and completion_column are required for csv uploads"
                )

    async def start_convert(
        self,
        conn: aiosqlite.Connection,
        background_tasks: BackgroundTasks,
        file: UploadFile,
        name: str,
        output_format: str,
        chunk_size: int,
        chunk_overlap: int,
        prompt_column: str | None,
        completion_column: str | None,
        system_prompt: str | None,
    ) -> dict:
        settings = self._settings
        ext = _file_ext(file.filename)
        self._validate_request(
            ext, output_format, chunk_size, chunk_overlap, prompt_column, completion_column
        )

        job_id = _new_job_id()
        job_dir = settings.cache_dir / "recipe_jobs" / job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        upload_path = job_dir / f"upload{ext}"

        try:
            with upload_path.open("wb") as out:
                while True:
                    data = await file.read(1024 * 1024)
                    if not data:
                        break
                    out.write(data)
        finally:
            await file.close()

        if ext == _CSV_EXT:
            fieldnames, _rows = read_csv_rows(upload_path)
            missing = [
                col for col in (prompt_column, completion_column) if col not in fieldnames
            ]
            if missing:
                shutil.rmtree(job_dir, ignore_errors=True)
                raise ValidationAppError(
                    f"csv is missing required column(s): {', '.join(missing)} "
                    f"(available columns: {', '.join(fieldnames)})"
                )

        created_at = _now()
        await RecipeJobsRepo(conn).insert(job_id, name, "running", created_at)

        background_tasks.add_task(
            self._run_job,
            job_id,
            name,
            upload_path,
            ext,
            output_format,
            chunk_size,
            chunk_overlap,
            prompt_column,
            completion_column,
            system_prompt,
        )
        return {"recipe_job_id": job_id, "name": name}

    def _build_rows(
        self,
        upload_path: Path,
        ext: str,
        output_format: str,
        chunk_size: int,
        chunk_overlap: int,
        prompt_column: str | None,
        completion_column: str | None,
        system_prompt: str | None,
    ) -> list[dict]:
        if ext == _CSV_EXT:
            _fieldnames, rows = read_csv_rows(upload_path)
            assert prompt_column is not None and completion_column is not None
            return emit_csv_rows(rows, output_format, prompt_column, completion_column, system_prompt)
        text = extract_text(upload_path, ext)
        chunks = chunk_text(text, chunk_size, chunk_overlap)
        return [{"text": chunk} for chunk in chunks]

    async def _run_job(
        self,
        job_id: str,
        name: str,
        upload_path: Path,
        ext: str,
        output_format: str,
        chunk_size: int,
        chunk_overlap: int,
        prompt_column: str | None,
        completion_column: str | None,
        system_prompt: str | None,
    ) -> None:
        conn = await self._open_conn()
        try:
            repo = RecipeJobsRepo(conn)
            try:
                rows = await asyncio.to_thread(
                    self._build_rows,
                    upload_path,
                    ext,
                    output_format,
                    chunk_size,
                    chunk_overlap,
                    prompt_column,
                    completion_column,
                    system_prompt,
                )
            except Exception as exc:  # parsing itself failed (e.g. corrupt file)
                await repo.finish(job_id, "failed", 0, None, None, str(exc))
                return

            if not rows:
                await repo.finish(
                    job_id, "failed", 0, None, None, "no rows could be extracted from the document"
                )
                return

            output_path = upload_path.parent / "output.jsonl"
            with output_path.open("w", encoding="utf-8") as out:
                for row in rows:
                    out.write(json.dumps(row, ensure_ascii=False) + "\n")

            dataset_service = get_dataset_service()
            datasets_repo = DatasetsRepo(conn)
            with output_path.open("rb") as fh:
                upload_file = UploadFile(file=fh, filename=f"{name}.jsonl")
                dataset_info = await dataset_service.upload(datasets_repo, upload_file, name)

            preview_rows = rows[:5]
            await repo.finish(
                job_id,
                "completed",
                len(rows),
                json.dumps(preview_rows, ensure_ascii=False),
                dataset_info.dataset_id,
                None,
            )
        finally:
            await conn.close()

    async def get_job(self, conn: aiosqlite.Connection, job_id: str) -> RecipeJobInfo:
        row = await RecipeJobsRepo(conn).get(job_id)
        if row is None:
            raise NotFoundError(f"recipe job '{job_id}' not found")
        preview_rows = json.loads(row["preview_json"]) if row["preview_json"] else []
        return RecipeJobInfo(
            recipe_job_id=row["id"],
            status=row["status"],
            rows_emitted=row["rows_emitted"] or 0,
            preview_rows=preview_rows,
            dataset_id=row["dataset_id"],
            error=row["error"],
        )


# Keyed by `id(settings)` so a fresh Settings object (e.g. after
# `get_settings.cache_clear()` between tests, or a real MLXLF_DATA_DIR
# change) transparently produces a fresh RecipeService instead of reusing
# one bound to a stale data directory. Mirrors get_export_service.
_service_cache: dict[int, RecipeService] = {}


def get_recipe_service(settings: Annotated[Settings, Depends(get_settings)]) -> RecipeService:
    key = id(settings)
    if key not in _service_cache:
        _service_cache.clear()
        _service_cache[key] = RecipeService(settings)
    return _service_cache[key]
