import json
from pathlib import Path

import aiosqlite
import pytest

from app.config import get_settings
from app.core.errors import NotFoundError, TrainingActiveError, ValidationAppError
from app.db.database import init_db
from app.db.repositories import DatasetsRepo, RunsRepo
from app.schemas.datasets import DatasetFormat, SplitRequest
from app.services.dataset_service import (
    _compute_split_sizes,
    _detect_row_format,
    get_dataset_service,
)

FIXTURES = Path(__file__).parent.parent / "fixtures" / "datasets"


async def _repo(data_dir) -> DatasetsRepo:
    settings = get_settings()
    await init_db(settings.db_path)
    conn = await aiosqlite.connect(settings.db_path)
    conn.row_factory = aiosqlite.Row
    return conn  # caller wraps in DatasetsRepo/RunsRepo


async def _seed_dataset(
    conn: aiosqlite.Connection,
    dataset_id: str,
    fmt: DatasetFormat,
    fixture_name: str,
    dataset_dir: Path,
) -> None:
    dataset_dir.mkdir(parents=True, exist_ok=True)
    raw_content = (FIXTURES / fixture_name).read_text(encoding="utf-8")
    (dataset_dir / "raw.jsonl").write_text(raw_content, encoding="utf-8")
    row_count = sum(1 for line in raw_content.splitlines() if line.strip())
    repo = DatasetsRepo(conn)
    await repo.insert(
        id=dataset_id,
        name="test-dataset",
        format=fmt.value,
        path=str(dataset_dir),
        row_count=row_count,
        splits_json=None,
        created_at="2026-07-12T00:00:00Z",
    )


# --------------------------------------------------------------------------
# Format sniffing (pure function)
# --------------------------------------------------------------------------


class TestDetectRowFormat:
    def test_chat_detected(self):
        assert _detect_row_format({"messages": []}) == DatasetFormat.CHAT

    def test_completions_detected(self):
        assert _detect_row_format({"prompt": "p", "completion": "c"}) == DatasetFormat.COMPLETIONS

    def test_text_detected(self):
        assert _detect_row_format({"text": "t"}) == DatasetFormat.TEXT

    def test_dpo_detected(self):
        obj = {"prompt": "p", "chosen": "c", "rejected": "r"}
        assert _detect_row_format(obj) == DatasetFormat.DPO

    def test_orpo_detected_via_preference_score(self):
        obj = {"prompt": "p", "chosen": "c", "rejected": "r", "preference_score": 0.5}
        assert _detect_row_format(obj) == DatasetFormat.ORPO

    def test_grpo_detected(self):
        assert _detect_row_format({"prompt": "p", "answer": "a"}) == DatasetFormat.GRPO

    def test_ftpo_detected(self):
        obj = {
            "context_with_chat_template": "c",
            "rejected_decoded": " a",
            "multi_chosen_decoded": [" b"],
        }
        assert _detect_row_format(obj) == DatasetFormat.FTPO

    def test_ftpo_not_detected_when_a_key_is_missing(self):
        obj = {"context_with_chat_template": "c", "multi_chosen_decoded": [" b"]}
        assert _detect_row_format(obj) is None

    def test_unrecognized_keys_return_none(self):
        assert _detect_row_format({"foo": "bar"}) is None

    def test_non_dict_returns_none(self):
        assert _detect_row_format(["not", "a", "dict"]) is None


# --------------------------------------------------------------------------
# Split sizing (pure function)
# --------------------------------------------------------------------------


class TestComputeSplitSizes:
    def test_exact_ratios(self):
        sizes = _compute_split_sizes(10, 0.8, 0.1, 0.1)
        assert sizes == {"train": 8, "valid": 1, "test": 1}
        assert sum(sizes.values()) == 10

    def test_min_one_row_guarantee_for_small_dataset(self):
        sizes = _compute_split_sizes(3, 0.8, 0.1, 0.1)
        assert sum(sizes.values()) == 3
        assert sizes["train"] >= 1
        assert sizes["valid"] >= 1
        assert sizes["test"] >= 1

    def test_zero_ratio_split_is_zero(self):
        sizes = _compute_split_sizes(10, 0.9, 0.1, 0.0)
        assert sizes["test"] == 0
        assert sum(sizes.values()) == 10

    def test_too_few_rows_for_three_nonzero_splits_raises(self):
        with pytest.raises(ValidationAppError):
            _compute_split_sizes(2, 0.34, 0.33, 0.33)


# --------------------------------------------------------------------------
# validate()
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_validate_chat_reports_line_precise_errors(data_dir):
    conn = await _repo(data_dir)
    try:
        settings = get_settings()
        await _seed_dataset(
            conn, "ds_chat", DatasetFormat.CHAT, "chat_broken.jsonl", settings.datasets_dir / "ds_chat"
        )
        service = get_dataset_service()
        report = await service.validate(DatasetsRepo(conn), "ds_chat")

        assert report.total_rows == 6
        assert report.valid_rows == 1
        error_lines = {e.line for e in report.errors}
        assert error_lines == {2, 3, 4, 5, 6}
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_validate_chat_warns_on_empty_assistant_content(data_dir):
    conn = await _repo(data_dir)
    try:
        settings = get_settings()
        await _seed_dataset(
            conn, "ds_chat_ok", DatasetFormat.CHAT, "chat_valid.jsonl", settings.datasets_dir / "ds_chat_ok"
        )
        service = get_dataset_service()
        report = await service.validate(DatasetsRepo(conn), "ds_chat_ok")

        assert report.total_rows == 3
        assert report.valid_rows == 3
        assert any("empty assistant content" in w.message for w in report.warnings)
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_validate_orpo_score_out_of_range_is_error(data_dir):
    conn = await _repo(data_dir)
    try:
        settings = get_settings()
        await _seed_dataset(
            conn, "ds_orpo", DatasetFormat.ORPO, "orpo_broken.jsonl", settings.datasets_dir / "ds_orpo"
        )
        service = get_dataset_service()
        report = await service.validate(DatasetsRepo(conn), "ds_orpo")

        assert report.total_rows == 4
        assert report.valid_rows == 1
        errors_by_line = {e.line: e.message for e in report.errors}
        assert 2 in errors_by_line  # preference_score 1.5 out of [0,1]
        assert 3 in errors_by_line  # missing preference_score
        assert 4 in errors_by_line  # garbage json
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_validate_ftpo_reports_line_precise_errors(data_dir):
    conn = await _repo(data_dir)
    try:
        settings = get_settings()
        await _seed_dataset(
            conn, "ds_ftpo", DatasetFormat.FTPO, "ftpo_broken.jsonl", settings.datasets_dir / "ds_ftpo"
        )
        service = get_dataset_service()
        report = await service.validate(DatasetsRepo(conn), "ds_ftpo")

        assert report.total_rows == 5
        assert report.valid_rows == 1
        errors_by_line = {e.line: e.message for e in report.errors}
        assert 2 in errors_by_line  # missing rejected_decoded
        assert "rejected_decoded" in errors_by_line[2]
        assert 3 in errors_by_line  # multi_chosen_decoded is a str, not a list
        assert "multi_chosen_decoded" in errors_by_line[3]
        assert 4 in errors_by_line  # empty multi_chosen_decoded list
        assert 5 in errors_by_line  # garbage json
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_validate_unknown_dataset_raises_not_found(data_dir):
    conn = await _repo(data_dir)
    try:
        service = get_dataset_service()
        with pytest.raises(NotFoundError):
            await service.validate(DatasetsRepo(conn), "ds_missing")
    finally:
        await conn.close()


# --------------------------------------------------------------------------
# split()
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_split_is_deterministic_by_seed(data_dir):
    conn = await _repo(data_dir)
    try:
        settings = get_settings()
        dataset_dir = settings.datasets_dir / "ds_split"
        dataset_dir.mkdir(parents=True)
        lines = [json.dumps({"text": f"row {i}"}) for i in range(20)]
        (dataset_dir / "raw.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")
        repo = DatasetsRepo(conn)
        await repo.insert(
            id="ds_split",
            name="split-ds",
            format=DatasetFormat.TEXT.value,
            path=str(dataset_dir),
            row_count=20,
            splits_json=None,
            created_at="2026-07-12T00:00:00Z",
        )

        service = get_dataset_service()
        body = SplitRequest(train=0.7, valid=0.2, test=0.1, seed=7, shuffle=True)
        info1 = await service.split(repo, "ds_split", body)
        train1 = (dataset_dir / "data" / "train.jsonl").read_text(encoding="utf-8")
        valid1 = (dataset_dir / "data" / "valid.jsonl").read_text(encoding="utf-8")
        test1 = (dataset_dir / "data" / "test.jsonl").read_text(encoding="utf-8")

        info2 = await service.split(repo, "ds_split", body)
        train2 = (dataset_dir / "data" / "train.jsonl").read_text(encoding="utf-8")
        valid2 = (dataset_dir / "data" / "valid.jsonl").read_text(encoding="utf-8")
        test2 = (dataset_dir / "data" / "test.jsonl").read_text(encoding="utf-8")

        assert train1 == train2
        assert valid1 == valid2
        assert test1 == test2
        assert info1.splits == info2.splits == {"train": 14, "valid": 4, "test": 2}
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_split_overwrites_previous_split(data_dir):
    conn = await _repo(data_dir)
    try:
        settings = get_settings()
        dataset_dir = settings.datasets_dir / "ds_resplit"
        dataset_dir.mkdir(parents=True)
        lines = [json.dumps({"text": f"row {i}"}) for i in range(10)]
        (dataset_dir / "raw.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")
        repo = DatasetsRepo(conn)
        await repo.insert(
            id="ds_resplit",
            name="resplit-ds",
            format=DatasetFormat.TEXT.value,
            path=str(dataset_dir),
            row_count=10,
            splits_json=None,
            created_at="2026-07-12T00:00:00Z",
        )

        service = get_dataset_service()
        await service.split(
            repo, "ds_resplit", SplitRequest(train=1.0, valid=0.0, test=0.0, seed=1, shuffle=False)
        )
        train_first = (dataset_dir / "data" / "train.jsonl").read_text(encoding="utf-8")
        assert len(train_first.strip().splitlines()) == 10

        info = await service.split(
            repo, "ds_resplit", SplitRequest(train=0.5, valid=0.5, test=0.0, seed=1, shuffle=False)
        )
        train_second = (dataset_dir / "data" / "train.jsonl").read_text(encoding="utf-8")
        assert len(train_second.strip().splitlines()) == 5
        assert info.splits == {"train": 5, "valid": 5, "test": 0}
    finally:
        await conn.close()


# --------------------------------------------------------------------------
# preview()
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_preview_pagination_and_bad_split(data_dir):
    conn = await _repo(data_dir)
    try:
        settings = get_settings()
        dataset_dir = settings.datasets_dir / "ds_preview"
        dataset_dir.mkdir(parents=True)
        lines = [json.dumps({"text": f"row {i}"}) for i in range(5)]
        (dataset_dir / "raw.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")
        repo = DatasetsRepo(conn)
        await repo.insert(
            id="ds_preview",
            name="preview-ds",
            format=DatasetFormat.TEXT.value,
            path=str(dataset_dir),
            row_count=5,
            splits_json=None,
            created_at="2026-07-12T00:00:00Z",
        )

        service = get_dataset_service()

        page1 = await service.preview(repo, "ds_preview", "raw", page=1, size=2)
        assert page1.total_rows == 5
        assert [r["text"] for r in page1.rows] == ["row 0", "row 1"]

        last_page = await service.preview(repo, "ds_preview", "raw", page=3, size=2)
        assert [r["text"] for r in last_page.rows] == ["row 4"]

        empty_page = await service.preview(repo, "ds_preview", "raw", page=4, size=2)
        assert empty_page.rows == []
        assert empty_page.total_rows == 5

        with pytest.raises(NotFoundError):
            await service.preview(repo, "ds_preview", "not-a-split", page=1, size=2)

        with pytest.raises(NotFoundError):
            await service.preview(repo, "ds_preview", "train", page=1, size=2)
    finally:
        await conn.close()


# --------------------------------------------------------------------------
# delete()
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_removes_dataset_and_dir(data_dir):
    conn = await _repo(data_dir)
    try:
        settings = get_settings()
        dataset_dir = settings.datasets_dir / "ds_del"
        dataset_dir.mkdir(parents=True)
        (dataset_dir / "raw.jsonl").write_text('{"text": "x"}\n', encoding="utf-8")
        repo = DatasetsRepo(conn)
        runs_repo = RunsRepo(conn)
        await repo.insert(
            id="ds_del",
            name="del-ds",
            format=DatasetFormat.TEXT.value,
            path=str(dataset_dir),
            row_count=1,
            splits_json=None,
            created_at="2026-07-12T00:00:00Z",
        )

        service = get_dataset_service()
        await service.delete(repo, runs_repo, "ds_del")

        assert await repo.get("ds_del") is None
        assert not dataset_dir.exists()
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_delete_conflicts_when_dataset_used_by_active_run(data_dir):
    conn = await _repo(data_dir)
    try:
        settings = get_settings()
        dataset_dir = settings.datasets_dir / "ds_busy"
        dataset_dir.mkdir(parents=True)
        (dataset_dir / "raw.jsonl").write_text('{"text": "x"}\n', encoding="utf-8")
        repo = DatasetsRepo(conn)
        runs_repo = RunsRepo(conn)
        await repo.insert(
            id="ds_busy",
            name="busy-ds",
            format=DatasetFormat.TEXT.value,
            path=str(dataset_dir),
            row_count=1,
            splits_json=None,
            created_at="2026-07-12T00:00:00Z",
        )
        await runs_repo.insert(
            run_id="run_1",
            name="my-run",
            status="running",
            config_json="{}",
            model_id="mlx-community/x",
            dataset_id="ds_busy",
            train_mode="sft",
            created_at="2026-07-12T00:00:00Z",
        )

        service = get_dataset_service()
        with pytest.raises(TrainingActiveError):
            await service.delete(repo, runs_repo, "ds_busy")

        assert await repo.get("ds_busy") is not None
        assert dataset_dir.exists()
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_delete_unknown_dataset_raises_not_found(data_dir):
    conn = await _repo(data_dir)
    try:
        service = get_dataset_service()
        with pytest.raises(NotFoundError):
            await service.delete(DatasetsRepo(conn), RunsRepo(conn), "ds_missing")
    finally:
        await conn.close()
