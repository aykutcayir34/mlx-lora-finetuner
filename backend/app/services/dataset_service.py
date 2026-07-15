"""Dataset upload / format-sniffing / validation / split / preview business logic.

No mlx imports here — this module only deals with JSONL files on disk and the
`datasets` SQLite table via `DatasetsRepo`/`RunsRepo`. Everything reads the
raw file line by line so large datasets never get fully loaded into memory.
"""

from __future__ import annotations

import json
import random
import shutil
import uuid
from functools import lru_cache
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import UploadFile
from pydantic import BaseModel, Field, ValidationError, model_validator

from app.config import get_settings
from app.core.errors import NotFoundError, TrainingActiveError, ValidationAppError
from app.db.repositories import DatasetsRepo, RunsRepo
from app.schemas.datasets import (
    DatasetFormat,
    DatasetInfo,
    LineIssue,
    PreviewPage,
    SplitRequest,
    ValidationReport,
)

_ALLOWED_SPLITS = ("raw", "train", "valid", "test")
_MAX_SEQ_LENGTH = 2048
_TOKEN_CHAR_RATIO = 4
_SNIFF_SAMPLE_SIZE = 20


# --------------------------------------------------------------------------
# Per-format row models (used only for /validate — never exposed via schemas).
# --------------------------------------------------------------------------


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str


class ChatRow(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1)

    @model_validator(mode="after")
    def _require_assistant_turn(self) -> "ChatRow":
        if not any(m.role == "assistant" for m in self.messages):
            raise ValueError("at least one assistant turn is required")
        return self


class CompletionsRow(BaseModel):
    prompt: str = Field(min_length=1)
    completion: str = Field(min_length=1)


class TextRow(BaseModel):
    text: str = Field(min_length=1)


class DpoRow(BaseModel):
    prompt: str = Field(min_length=1)
    chosen: str = Field(min_length=1)
    rejected: str = Field(min_length=1)


class OrpoRow(DpoRow):
    preference_score: float = Field(ge=0.0, le=1.0)


class GrpoRow(BaseModel):
    prompt: str = Field(min_length=1)
    answer: str = Field(min_length=1)
    system: str | None = None


class FtpoRow(BaseModel):
    """Final-token preference row (mlx-lm-lora FTPODataset).

    `rejected_decoded` must tokenize to exactly one token and every
    `multi_chosen_decoded` entry to one token each — that needs the model's
    tokenizer, which validation never loads, so only the structure is checked
    here (like every other format).
    """

    context_with_chat_template: str = Field(min_length=1)
    rejected_decoded: str = Field(min_length=1)
    multi_chosen_decoded: list[str] = Field(min_length=1)


_ROW_MODELS: dict[DatasetFormat, type[BaseModel]] = {
    DatasetFormat.CHAT: ChatRow,
    DatasetFormat.COMPLETIONS: CompletionsRow,
    DatasetFormat.TEXT: TextRow,
    DatasetFormat.DPO: DpoRow,
    DatasetFormat.ORPO: OrpoRow,
    DatasetFormat.GRPO: GrpoRow,
    DatasetFormat.FTPO: FtpoRow,
}


def _detect_row_format(obj: object) -> DatasetFormat | None:
    """Detect a single parsed JSON row's format by its keys.

    Checked in a fixed, deterministic priority order. dpo/orpo share
    prompt+chosen+rejected — orpo is distinguished by the extra
    preference_score key.
    """
    if not isinstance(obj, dict):
        return None
    keys = set(obj.keys())
    if "messages" in keys:
        return DatasetFormat.CHAT
    if {"context_with_chat_template", "rejected_decoded", "multi_chosen_decoded"} <= keys:
        return DatasetFormat.FTPO
    if {"prompt", "chosen", "rejected"} <= keys:
        return DatasetFormat.ORPO if "preference_score" in keys else DatasetFormat.DPO
    if {"prompt", "completion"} <= keys:
        return DatasetFormat.COMPLETIONS
    if {"prompt", "answer"} <= keys:
        return DatasetFormat.GRPO
    if "text" in keys:
        return DatasetFormat.TEXT
    return None


def _format_pydantic_error(exc: ValidationError) -> str:
    parts = []
    for err in exc.errors():
        loc = ".".join(str(part) for part in err["loc"])
        parts.append(f"{loc}: {err['msg']}" if loc else err["msg"])
    return "; ".join(parts)


def _row_char_count(fmt: DatasetFormat, row: BaseModel) -> int:
    if fmt == DatasetFormat.CHAT:
        return sum(len(m.content) for m in row.messages)  # type: ignore[attr-defined]
    if fmt == DatasetFormat.COMPLETIONS:
        return len(row.prompt) + len(row.completion)  # type: ignore[attr-defined]
    if fmt == DatasetFormat.TEXT:
        return len(row.text)  # type: ignore[attr-defined]
    if fmt in (DatasetFormat.DPO, DatasetFormat.ORPO):
        return len(row.prompt) + len(row.chosen) + len(row.rejected)  # type: ignore[attr-defined]
    if fmt == DatasetFormat.GRPO:
        total = len(row.prompt) + len(row.answer)  # type: ignore[attr-defined]
        system = row.system  # type: ignore[attr-defined]
        if system:
            total += len(system)
        return total
    if fmt == DatasetFormat.FTPO:
        return len(row.context_with_chat_template) + len(row.rejected_decoded) + sum(  # type: ignore[attr-defined]
            len(s)
            for s in row.multi_chosen_decoded  # type: ignore[attr-defined]
        )
    return 0


def _row_warnings(fmt: DatasetFormat, row: BaseModel, line_no: int) -> list[LineIssue]:
    warnings: list[LineIssue] = []
    if fmt == DatasetFormat.CHAT:
        for m in row.messages:  # type: ignore[attr-defined]
            if m.role == "assistant" and not m.content.strip():
                warnings.append(LineIssue(line=line_no, message="empty assistant content"))

    estimated_tokens = _row_char_count(fmt, row) / _TOKEN_CHAR_RATIO
    if estimated_tokens > _MAX_SEQ_LENGTH * _TOKEN_CHAR_RATIO:
        warnings.append(
            LineIssue(
                line=line_no,
                message=(
                    "row likely exceeds max_seq_length "
                    f"(estimated ~{int(estimated_tokens)} tokens)"
                ),
            )
        )
    return warnings


def _compute_split_sizes(total: int, train: float, valid: float, test: float) -> dict[str, int]:
    """Largest-remainder split sizing with a min-1-row guarantee per nonzero ratio."""
    raw = {"train": train * total, "valid": valid * total, "test": test * total}
    sizes = {name: int(value) for name, value in raw.items()}
    remainder = total - sum(sizes.values())
    fracs = sorted(raw.items(), key=lambda kv: kv[1] - int(kv[1]), reverse=True)
    i = 0
    while remainder > 0 and fracs:
        name = fracs[i % len(fracs)][0]
        sizes[name] += 1
        remainder -= 1
        i += 1

    ratios = {"train": train, "valid": valid, "test": test}
    for name, ratio in ratios.items():
        if ratio > 0 and sizes[name] == 0:
            donor = max(sizes, key=lambda k: sizes[k])
            if sizes[donor] <= 1:
                raise ValidationAppError(
                    "dataset has too few rows to satisfy the requested split ratios"
                )
            sizes[donor] -= 1
            sizes[name] += 1
    return sizes


def _new_dataset_id() -> str:
    return f"ds_{uuid.uuid4().hex[:12]}"


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _iter_nonblank_lines(path: Path):
    with path.open("r", encoding="utf-8") as f:
        for line_no, raw_line in enumerate(f, start=1):
            stripped = raw_line.strip()
            if stripped:
                yield line_no, stripped


class DatasetService:
    """Stateless dataset business logic. Fetches settings fresh on every call."""

    def _row_to_info(self, record: dict) -> DatasetInfo:
        splits = json.loads(record["splits_json"]) if record["splits_json"] else None
        return DatasetInfo(
            dataset_id=record["id"],
            name=record["name"],
            format=DatasetFormat(record["format"]),
            path=record["path"],
            row_count=record["row_count"] or 0,
            splits=splits,
            created_at=record["created_at"],
        )

    async def _get_or_404(self, repo: DatasetsRepo, dataset_id: str) -> dict:
        record = await repo.get(dataset_id)
        if record is None:
            raise NotFoundError(f"dataset '{dataset_id}' not found")
        return record

    async def list_datasets(self, repo: DatasetsRepo) -> list[DatasetInfo]:
        records = await repo.list_()
        return [self._row_to_info(r) for r in records]

    def _sniff_format(self, raw_path: Path) -> DatasetFormat | None:
        detected: DatasetFormat | None = None
        sampled = 0
        for _, line in _iter_nonblank_lines(raw_path):
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            fmt = _detect_row_format(obj)
            if fmt is None:
                return None
            if detected is None:
                detected = fmt
            elif fmt != detected:
                return None
            sampled += 1
            if sampled >= _SNIFF_SAMPLE_SIZE:
                break
        return detected

    async def upload(
        self, repo: DatasetsRepo, file: UploadFile, name: str | None
    ) -> DatasetInfo:
        settings = get_settings()
        dataset_id = _new_dataset_id()
        dataset_dir = settings.datasets_dir / dataset_id
        dataset_dir.mkdir(parents=True, exist_ok=True)
        raw_path = dataset_dir / "raw.jsonl"

        try:
            with raw_path.open("wb") as out:
                while True:
                    chunk = await file.read(1024 * 1024)
                    if not chunk:
                        break
                    out.write(chunk)
        finally:
            await file.close()

        row_count = sum(1 for _ in _iter_nonblank_lines(raw_path))
        if row_count == 0:
            shutil.rmtree(dataset_dir, ignore_errors=True)
            raise ValidationAppError("uploaded file has no parseable rows")

        fmt = self._sniff_format(raw_path)
        if fmt is None:
            shutil.rmtree(dataset_dir, ignore_errors=True)
            raise ValidationAppError(
                "could not detect a consistent dataset format from the uploaded file"
            )

        resolved_name = name or Path(file.filename or dataset_id).stem
        created_at = _utcnow_iso()
        await repo.insert(
            id=dataset_id,
            name=resolved_name,
            format=fmt.value,
            path=str(dataset_dir),
            row_count=row_count,
            splits_json=None,
            created_at=created_at,
        )
        return DatasetInfo(
            dataset_id=dataset_id,
            name=resolved_name,
            format=fmt,
            path=str(dataset_dir),
            row_count=row_count,
            splits=None,
            created_at=created_at,
        )

    async def validate(self, repo: DatasetsRepo, dataset_id: str) -> ValidationReport:
        record = await self._get_or_404(repo, dataset_id)
        fmt = DatasetFormat(record["format"])
        model_cls = _ROW_MODELS[fmt]
        raw_path = Path(record["path"]) / "raw.jsonl"

        errors: list[LineIssue] = []
        warnings: list[LineIssue] = []
        total_rows = 0
        valid_rows = 0

        for line_no, line in _iter_nonblank_lines(raw_path):
            total_rows += 1
            try:
                obj = json.loads(line)
            except json.JSONDecodeError as exc:
                errors.append(LineIssue(line=line_no, message=f"invalid JSON: {exc.msg}"))
                continue
            try:
                row = model_cls.model_validate(obj)
            except ValidationError as exc:
                errors.append(LineIssue(line=line_no, message=_format_pydantic_error(exc)))
                continue
            valid_rows += 1
            warnings.extend(_row_warnings(fmt, row, line_no))

        return ValidationReport(
            dataset_id=dataset_id,
            format=fmt,
            valid_rows=valid_rows,
            total_rows=total_rows,
            errors=errors,
            warnings=warnings,
        )

    async def split(
        self, repo: DatasetsRepo, dataset_id: str, body: SplitRequest
    ) -> DatasetInfo:
        record = await self._get_or_404(repo, dataset_id)
        dataset_dir = Path(record["path"])
        raw_path = dataset_dir / "raw.jsonl"

        lines = [line for _, line in _iter_nonblank_lines(raw_path)]
        total = len(lines)
        if total == 0:
            raise ValidationAppError("dataset has no rows to split")

        order = list(range(total))
        if body.shuffle:
            random.Random(body.seed).shuffle(order)

        sizes = _compute_split_sizes(total, body.train, body.valid, body.test)

        data_dir = dataset_dir / "data"
        data_dir.mkdir(parents=True, exist_ok=True)

        idx = 0
        splits_written: dict[str, int] = {}
        for split_name in ("train", "valid", "test"):
            n = sizes[split_name]
            chunk_indices = order[idx : idx + n]
            idx += n
            out_path = data_dir / f"{split_name}.jsonl"
            with out_path.open("w", encoding="utf-8") as out:
                for i in chunk_indices:
                    out.write(lines[i] + "\n")
            splits_written[split_name] = n

        splits_json = json.dumps(splits_written)
        await repo.update_splits(dataset_id, record["row_count"], splits_json)

        return DatasetInfo(
            dataset_id=dataset_id,
            name=record["name"],
            format=DatasetFormat(record["format"]),
            path=str(dataset_dir),
            row_count=record["row_count"] or 0,
            splits=splits_written,
            created_at=record["created_at"],
        )

    async def preview(
        self, repo: DatasetsRepo, dataset_id: str, split: str, page: int, size: int
    ) -> PreviewPage:
        if page < 1 or size < 1:
            raise ValidationAppError("page and size must both be >= 1")

        record = await self._get_or_404(repo, dataset_id)
        if split not in _ALLOWED_SPLITS:
            raise NotFoundError(f"unknown split '{split}'")

        dataset_dir = Path(record["path"])
        path = (
            dataset_dir / "raw.jsonl"
            if split == "raw"
            else dataset_dir / "data" / f"{split}.jsonl"
        )
        if not path.exists():
            raise NotFoundError(f"split '{split}' not found for dataset '{dataset_id}'")

        start = (page - 1) * size
        end = start + size
        rows: list[dict] = []
        total_rows = 0
        for _, line in _iter_nonblank_lines(path):
            if start <= total_rows < end:
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError:
                    rows.append({"_raw": line, "_error": "invalid JSON"})
            total_rows += 1

        return PreviewPage(rows=rows, page=page, size=size, total_rows=total_rows)

    async def delete(
        self, datasets_repo: DatasetsRepo, runs_repo: RunsRepo, dataset_id: str
    ) -> None:
        record = await self._get_or_404(datasets_repo, dataset_id)

        active_runs = await runs_repo.list_active()
        if any(run["dataset_id"] == dataset_id for run in active_runs):
            raise TrainingActiveError(
                f"dataset '{dataset_id}' is referenced by an active training run"
            )

        shutil.rmtree(Path(record["path"]), ignore_errors=True)
        await datasets_repo.delete(dataset_id)


@lru_cache
def get_dataset_service() -> DatasetService:
    return DatasetService()
