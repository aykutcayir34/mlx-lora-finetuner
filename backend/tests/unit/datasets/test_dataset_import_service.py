import asyncio
import json
import threading
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.db.repositories import DatasetImportsRepo, DatasetsRepo
from app.schemas.datasets import DatasetImportRequest
from app.services.dataset_import_service import DatasetImportService
from app.services.dataset_service import get_dataset_service
from tests.unit.datasets.conftest import FakeBackgroundTasks, make_conn


def _fake_stream_factory(rows: list[dict]):
    def fake_load_dataset_stream(hf_dataset_id, config, split):
        return iter(rows)

    return fake_load_dataset_stream


def _pausing_stream_factory(n_rows: int, pause_at: int, pause_event, resume_event):
    def _gen():
        for i in range(n_rows):
            if i == pause_at:
                pause_event.set()
                resume_event.wait(timeout=5)
            yield {"text": f"row {i}"}

    def fake_load_dataset_stream(hf_dataset_id, config, split):
        return _gen()

    return fake_load_dataset_stream


@pytest.mark.asyncio
async def test_streaming_import_happy_path_honors_max_rows(import_settings, monkeypatch):
    rows = [{"text": f"row {i}"} for i in range(10)]
    monkeypatch.setattr(
        "app.services.dataset_import_service._load_dataset_stream", _fake_stream_factory(rows)
    )

    service = DatasetImportService(import_settings)
    conn = await make_conn(import_settings)
    try:
        bt = FakeBackgroundTasks()
        body = DatasetImportRequest(
            dataset_id="org/name", split="train", max_rows=5, name="my-import"
        )
        accepted = await service.start_import(conn, bt, body)
        await bt.run_all()

        row = await DatasetImportsRepo(conn).get(accepted.import_id)
        assert row["status"] == "completed"
        assert row["rows_written"] == 5
        assert row["dataset_id"] is not None

        datasets = await DatasetsRepo(conn).list_()
        assert len(datasets) == 1
        assert datasets[0]["format"] == "text"
        assert datasets[0]["row_count"] == 5
        assert datasets[0]["name"] == "my-import"
    finally:
        await conn.close()


def _spy_terminal_writes(monkeypatch) -> list[str]:
    """Record the status of every terminal write that actually lands on a
    dataset_imports row (both `finish` and the guarded `finish_if_active`)."""
    statuses: list[str] = []
    orig_finish = DatasetImportsRepo.finish
    orig_finish_if_active = DatasetImportsRepo.finish_if_active

    async def spy_finish(self, id, status, dataset_id, error, finished_at):
        statuses.append(status)
        return await orig_finish(self, id, status, dataset_id, error, finished_at)

    async def spy_finish_if_active(self, id, status, dataset_id, error, finished_at):
        updated = await orig_finish_if_active(self, id, status, dataset_id, error, finished_at)
        if updated:
            statuses.append(status)
        return updated

    monkeypatch.setattr(DatasetImportsRepo, "finish", spy_finish)
    monkeypatch.setattr(DatasetImportsRepo, "finish_if_active", spy_finish_if_active)
    return statuses


@pytest.mark.asyncio
async def test_cancel_mid_stream_leaves_no_local_dataset(import_settings, monkeypatch):
    pause_event = threading.Event()
    resume_event = threading.Event()
    monkeypatch.setattr(
        "app.services.dataset_import_service._load_dataset_stream",
        _pausing_stream_factory(1000, pause_at=20, pause_event=pause_event, resume_event=resume_event),
    )
    terminal_writes = _spy_terminal_writes(monkeypatch)

    service = DatasetImportService(import_settings)
    conn = await make_conn(import_settings)
    try:
        bt = FakeBackgroundTasks()
        body = DatasetImportRequest(dataset_id="org/big-dataset", split="train")
        accepted = await service.start_import(conn, bt, body)

        run_task = asyncio.create_task(bt.run_all())

        # Wait for the fake generator to hit its pause point (row 20) without
        # blocking the event loop, so cancellation can be issued mid-stream.
        await asyncio.to_thread(pause_event.wait, 5)

        # cancel_import only signals the worker; the worker owns the terminal
        # write, so the row is still `running` right after the call.
        cancelled_info = await service.cancel_import(conn, accepted.import_id)
        assert cancelled_info.status == "running"
        assert terminal_writes == []

        resume_event.set()
        await run_task

        # The worker observed the cancel event: exactly one terminal write,
        # and it is `cancelled` — the worker loop exiting afterwards must not
        # flip it back to `completed`.
        row = await DatasetImportsRepo(conn).get(accepted.import_id)
        assert row["status"] == "cancelled"
        assert row["dataset_id"] is None
        assert terminal_writes == ["cancelled"]

        job_dir = service._job_dir(accepted.import_id)
        assert not job_dir.exists()

        datasets = await DatasetsRepo(conn).list_()
        assert datasets == []
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_cancel_already_completed_import_conflicts_and_keeps_status(
    import_settings, monkeypatch
):
    rows = [{"text": f"row {i}"} for i in range(3)]
    monkeypatch.setattr(
        "app.services.dataset_import_service._load_dataset_stream", _fake_stream_factory(rows)
    )

    service = DatasetImportService(import_settings)
    conn = await make_conn(import_settings)
    try:
        bt = FakeBackgroundTasks()
        body = DatasetImportRequest(dataset_id="org/done", split="train")
        accepted = await service.start_import(conn, bt, body)
        await bt.run_all()

        repo = DatasetImportsRepo(conn)
        row = await repo.get(accepted.import_id)
        assert row["status"] == "completed"

        from app.core.errors import ConflictError

        with pytest.raises(ConflictError):
            await service.cancel_import(conn, accepted.import_id)

        # Even a direct guarded terminal write must not clobber the row.
        updated = await repo.finish_if_active(
            accepted.import_id, "cancelled", None, None, "2026-07-15T00:00:00Z"
        )
        assert updated is False

        row = await repo.get(accepted.import_id)
        assert row["status"] == "completed"
        assert row["dataset_id"] is not None
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_cancel_without_live_worker_finalizes_row(import_settings):
    """A `running` row with no live worker in this process (e.g. left over
    from a previous process) must still terminalize on cancel."""
    service = DatasetImportService(import_settings)
    conn = await make_conn(import_settings)
    try:
        repo = DatasetImportsRepo(conn)
        await repo.insert(
            id="di_stale",
            hf_dataset_id="org/stale",
            config=None,
            split="train",
            name="stale",
            max_rows=None,
            status="running",
            started_at="2026-07-15T00:00:00Z",
        )
        job_dir = service._job_dir("di_stale")
        job_dir.mkdir(parents=True, exist_ok=True)
        (job_dir / "output.jsonl").write_text('{"text": "partial"}\n')

        info = await service.cancel_import(conn, "di_stale")
        assert info.status == "cancelled"

        row = await repo.get("di_stale")
        assert row["status"] == "cancelled"
        assert row["finished_at"] is not None
        assert not job_dir.exists()
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_unrecognized_columns_fail_with_column_names_in_error(import_settings, monkeypatch):
    rows = [{"foo": "bar"}, {"foo": "baz"}]
    monkeypatch.setattr(
        "app.services.dataset_import_service._load_dataset_stream", _fake_stream_factory(rows)
    )

    service = DatasetImportService(import_settings)
    conn = await make_conn(import_settings)
    try:
        bt = FakeBackgroundTasks()
        body = DatasetImportRequest(dataset_id="org/unrecognized", split="train")
        accepted = await service.start_import(conn, bt, body)
        await bt.run_all()

        row = await DatasetImportsRepo(conn).get(accepted.import_id)
        assert row["status"] == "failed"
        assert "foo" in row["error"]

        datasets = await DatasetsRepo(conn).list_()
        assert datasets == []
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_non_json_serializable_row_fails_with_clear_message(import_settings, monkeypatch):
    rows = [{"text": "ok row"}, {"image": b"\x00\x01"}]
    monkeypatch.setattr(
        "app.services.dataset_import_service._load_dataset_stream", _fake_stream_factory(rows)
    )

    service = DatasetImportService(import_settings)
    conn = await make_conn(import_settings)
    try:
        bt = FakeBackgroundTasks()
        body = DatasetImportRequest(dataset_id="org/binary-dataset", split="train")
        accepted = await service.start_import(conn, bt, body)
        await bt.run_all()

        row = await DatasetImportsRepo(conn).get(accepted.import_id)
        assert row["status"] == "failed"
        assert "bu dataset metin tabanlı değil" in row["error"]

        datasets = await DatasetsRepo(conn).list_()
        assert datasets == []
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_duplicate_active_import_conflicts(import_settings, monkeypatch):
    pause_event = threading.Event()
    resume_event = threading.Event()
    monkeypatch.setattr(
        "app.services.dataset_import_service._load_dataset_stream",
        _pausing_stream_factory(1000, pause_at=5, pause_event=pause_event, resume_event=resume_event),
    )

    service = DatasetImportService(import_settings)
    conn = await make_conn(import_settings)
    try:
        bt = FakeBackgroundTasks()
        body = DatasetImportRequest(dataset_id="org/dup", split="train")
        accepted = await service.start_import(conn, bt, body)
        run_task = asyncio.create_task(bt.run_all())

        await asyncio.to_thread(pause_event.wait, 5)

        from app.core.errors import ConflictError

        with pytest.raises(ConflictError):
            await service.start_import(conn, FakeBackgroundTasks(), body)

        resume_event.set()
        await run_task

        row = await DatasetImportsRepo(conn).get(accepted.import_id)
        assert row["status"] == "completed"
    finally:
        await conn.close()


# --------------------------------------------------------------------------
# column_map: schema-level validation
# --------------------------------------------------------------------------


def test_column_map_rejects_unknown_canonical_key():
    with pytest.raises(ValidationError, match="prob_lem"):
        DatasetImportRequest(
            dataset_id="org/name", split="train", column_map={"prob_lem": "problem"}
        )


def test_column_map_rejects_empty_dict():
    with pytest.raises(ValidationError, match="boş olamaz"):
        DatasetImportRequest(dataset_id="org/name", split="train", column_map={})


def test_column_map_none_is_accepted():
    body = DatasetImportRequest(dataset_id="org/name", split="train", column_map=None)
    assert body.column_map is None


# --------------------------------------------------------------------------
# column_map: row projection during import
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_column_map_projects_row_and_detects_grpo(import_settings, monkeypatch):
    rows = [
        {"problem": "2+2", "level": "easy", "solution": "4", "type": "arithmetic"},
        {"problem": "3+3", "level": "easy", "solution": "6", "type": "arithmetic"},
    ]
    monkeypatch.setattr(
        "app.services.dataset_import_service._load_dataset_stream", _fake_stream_factory(rows)
    )

    service = DatasetImportService(import_settings)
    conn = await make_conn(import_settings)
    try:
        bt = FakeBackgroundTasks()
        body = DatasetImportRequest(
            dataset_id="org/grpo-source",
            split="train",
            column_map={"prompt": "problem", "answer": "solution"},
        )
        accepted = await service.start_import(conn, bt, body)
        await bt.run_all()

        row = await DatasetImportsRepo(conn).get(accepted.import_id)
        assert row["status"] == "completed"
        assert row["rows_written"] == 2

        datasets = await DatasetsRepo(conn).list_()
        assert len(datasets) == 1
        assert datasets[0]["format"] == "grpo"

        # The registered rows carry the canonical keys and nothing else —
        # "level" and "type" were dropped, not merely renamed around.
        registered = [
            json.loads(line)
            for line in (Path(datasets[0]["path"]) / "raw.jsonl")
            .read_text(encoding="utf-8")
            .splitlines()
            if line.strip()
        ]
        assert registered == [
            {"prompt": "2+2", "answer": "4"},
            {"prompt": "3+3", "answer": "6"},
        ]

        # The scratch copy is removed on success, as before.
        assert not (service._job_dir(accepted.import_id) / "output.jsonl").exists()
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_column_map_projection_drops_extra_columns_that_would_change_format(
    import_settings, monkeypatch
):
    """A row that also happens to carry `chosen`/`rejected` keys must still be
    detected as grpo once column_map projects it down to prompt/answer only —
    proving unmapped columns are actually dropped, not merely ignored."""
    rows = [
        {
            "problem": "2+2",
            "solution": "4",
            "chosen": "should be dropped",
            "rejected": "should be dropped too",
        }
    ]
    monkeypatch.setattr(
        "app.services.dataset_import_service._load_dataset_stream", _fake_stream_factory(rows)
    )

    service = DatasetImportService(import_settings)
    conn = await make_conn(import_settings)
    try:
        bt = FakeBackgroundTasks()
        body = DatasetImportRequest(
            dataset_id="org/grpo-with-dpo-lookalike-columns",
            split="train",
            column_map={"prompt": "problem", "answer": "solution"},
        )
        accepted = await service.start_import(conn, bt, body)
        await bt.run_all()

        row = await DatasetImportsRepo(conn).get(accepted.import_id)
        assert row["status"] == "completed"

        datasets = await DatasetsRepo(conn).list_()
        assert datasets[0]["format"] == "grpo"
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_column_map_missing_source_column_fails_job_with_row_columns(
    import_settings, monkeypatch
):
    rows = [
        {"problem": "2+2", "solution": "4"},
        {"problem": "3+3"},  # missing "solution" on this row
    ]
    monkeypatch.setattr(
        "app.services.dataset_import_service._load_dataset_stream", _fake_stream_factory(rows)
    )

    service = DatasetImportService(import_settings)
    conn = await make_conn(import_settings)
    try:
        bt = FakeBackgroundTasks()
        body = DatasetImportRequest(
            dataset_id="org/missing-column",
            split="train",
            column_map={"prompt": "problem", "answer": "solution"},
        )
        accepted = await service.start_import(conn, bt, body)
        await bt.run_all()

        row = await DatasetImportsRepo(conn).get(accepted.import_id)
        assert row["status"] == "failed"
        assert "solution" in row["error"]
        assert "problem" in row["error"]  # the row's actual columns are named

        datasets = await DatasetsRepo(conn).list_()
        assert datasets == []

        job_dir = service._job_dir(accepted.import_id)
        assert not job_dir.exists()
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_no_column_map_behaves_as_before(import_settings, monkeypatch):
    """Regression: omitting column_map must not alter the raw row written to
    the JSONL (same rows, same keys, as the pre-column_map behavior)."""
    rows = [{"prompt": "hi", "answer": "there"}, {"prompt": "yo", "answer": "sup"}]
    monkeypatch.setattr(
        "app.services.dataset_import_service._load_dataset_stream", _fake_stream_factory(rows)
    )

    service = DatasetImportService(import_settings)
    conn = await make_conn(import_settings)
    try:
        bt = FakeBackgroundTasks()
        body = DatasetImportRequest(dataset_id="org/no-map", split="train")
        assert body.column_map is None
        accepted = await service.start_import(conn, bt, body)
        await bt.run_all()

        row = await DatasetImportsRepo(conn).get(accepted.import_id)
        assert row["status"] == "completed"

        datasets = await DatasetsRepo(conn).list_()
        assert datasets[0]["format"] == "grpo"
    finally:
        await conn.close()


# --------------------------------------------------------------------------
# Format-detection failure keeps the downloaded JSONL (retry doesn't re-download)
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_format_detection_failure_keeps_downloaded_file(import_settings, monkeypatch):
    rows = [{"foo": "bar"}, {"foo": "baz"}]
    monkeypatch.setattr(
        "app.services.dataset_import_service._load_dataset_stream", _fake_stream_factory(rows)
    )

    service = DatasetImportService(import_settings)
    conn = await make_conn(import_settings)
    try:
        bt = FakeBackgroundTasks()
        body = DatasetImportRequest(dataset_id="org/undetectable", split="train")
        accepted = await service.start_import(conn, bt, body)
        await bt.run_all()

        row = await DatasetImportsRepo(conn).get(accepted.import_id)
        assert row["status"] == "failed"

        output_path = service._job_dir(accepted.import_id) / "output.jsonl"
        assert output_path.exists()
        assert output_path.read_text().strip().splitlines() == [
            '{"foo": "bar"}',
            '{"foo": "baz"}',
        ]
        assert str(output_path) in row["error"]

        # in-memory bookkeeping for this import_id must still be dropped
        assert accepted.import_id not in service._cancel_events
        assert accepted.import_id not in service._progress
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_column_map_drops_rows_with_a_null_mapped_value(import_settings, monkeypatch):
    """Detection is key-based, so a null would register rows /validate rejects."""
    rows = [
        {"problem": "2+2", "solution": "4"},
        {"problem": "3+3", "solution": None},
        {"problem": "4+4", "solution": "8"},
    ]
    monkeypatch.setattr(
        "app.services.dataset_import_service._load_dataset_stream", _fake_stream_factory(rows)
    )

    service = DatasetImportService(import_settings)
    conn = await make_conn(import_settings)
    try:
        bt = FakeBackgroundTasks()
        accepted = await service.start_import(
            conn,
            bt,
            DatasetImportRequest(
                dataset_id="org/has-nulls",
                split="train",
                column_map={"prompt": "problem", "answer": "solution"},
            ),
        )
        await bt.run_all()

        row = await DatasetImportsRepo(conn).get(accepted.import_id)
        assert row["status"] == "completed"
        assert row["rows_written"] == 2  # the null row is not counted

        datasets = await DatasetsRepo(conn).list_()
        registered = [
            json.loads(line)
            for line in (Path(datasets[0]["path"]) / "raw.jsonl")
            .read_text(encoding="utf-8")
            .splitlines()
            if line.strip()
        ]
        assert registered == [
            {"prompt": "2+2", "answer": "4"},
            {"prompt": "4+4", "answer": "8"},
        ]
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_all_rows_null_fails_and_says_how_many_were_dropped(import_settings, monkeypatch):
    rows = [{"problem": "2+2", "solution": None}, {"problem": "3+3", "solution": None}]
    monkeypatch.setattr(
        "app.services.dataset_import_service._load_dataset_stream", _fake_stream_factory(rows)
    )

    service = DatasetImportService(import_settings)
    conn = await make_conn(import_settings)
    try:
        bt = FakeBackgroundTasks()
        accepted = await service.start_import(
            conn,
            bt,
            DatasetImportRequest(
                dataset_id="org/all-nulls",
                split="train",
                column_map={"prompt": "problem", "answer": "solution"},
            ),
        )
        await bt.run_all()

        row = await DatasetImportsRepo(conn).get(accepted.import_id)
        assert row["status"] == "failed"
        assert "2 satır" in row["error"]
        assert "null" in row["error"]
        assert not service._job_dir(accepted.import_id).exists()
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_null_values_are_kept_without_a_column_map(import_settings, monkeypatch):
    """Backwards compatibility: an import without column_map is untouched."""
    rows = [{"prompt": "p", "answer": None}]
    monkeypatch.setattr(
        "app.services.dataset_import_service._load_dataset_stream", _fake_stream_factory(rows)
    )

    service = DatasetImportService(import_settings)
    conn = await make_conn(import_settings)
    try:
        bt = FakeBackgroundTasks()
        accepted = await service.start_import(
            conn, bt, DatasetImportRequest(dataset_id="org/raw-nulls", split="train")
        )
        await bt.run_all()

        row = await DatasetImportsRepo(conn).get(accepted.import_id)
        assert row["status"] == "completed"
        assert row["rows_written"] == 1
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_kept_file_and_rows_written_agree(import_settings, monkeypatch):
    """Handing over a file path while under-reporting its length is a lie.

    Row counts are only checkpointed every _PERSIST_ROW_INTERVAL rows, so a
    count that is not a multiple of it exposes whether the failure path
    persists the real total.
    """
    rows = [{"foo": i} for i in range(150)]
    monkeypatch.setattr(
        "app.services.dataset_import_service._load_dataset_stream", _fake_stream_factory(rows)
    )

    service = DatasetImportService(import_settings)
    conn = await make_conn(import_settings)
    try:
        bt = FakeBackgroundTasks()
        accepted = await service.start_import(
            conn, bt, DatasetImportRequest(dataset_id="org/undetectable-150", split="train")
        )
        await bt.run_all()

        row = await DatasetImportsRepo(conn).get(accepted.import_id)
        kept = service._job_dir(accepted.import_id) / "output.jsonl"
        kept_lines = len([ln for ln in kept.read_text().splitlines() if ln.strip()])

        assert row["status"] == "failed"
        assert kept_lines == 150
        assert row["rows_written"] == kept_lines
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_unexpected_error_terminalizes_the_row(import_settings, monkeypatch):
    """No import may end non-terminal — a `running` row can never be cleared.

    `cancel_import` only signals the worker, which is already gone, so the
    duplicate guard would reject this dataset for the life of the install.
    """
    rows = [{"prompt": "p", "answer": "a"}]
    monkeypatch.setattr(
        "app.services.dataset_import_service._load_dataset_stream", _fake_stream_factory(rows)
    )

    async def exploding_upload(*args, **kwargs):
        raise OSError("disk on fire")

    service = DatasetImportService(import_settings)
    conn = await make_conn(import_settings)
    try:
        bt = FakeBackgroundTasks()
        accepted = await service.start_import(
            conn, bt, DatasetImportRequest(dataset_id="org/explodes", split="train")
        )
        monkeypatch.setattr(
            get_dataset_service().__class__, "upload", exploding_upload, raising=True
        )
        await bt.run_all()

        row = await DatasetImportsRepo(conn).get(accepted.import_id)
        assert row["status"] == "failed"
        assert "disk on fire" in row["error"]
        # Not the format-detection path, so nothing is kept.
        assert not service._job_dir(accepted.import_id).exists()
        assert accepted.import_id not in service._cancel_events
        assert accepted.import_id not in service._progress
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_reimport_supersedes_the_previously_kept_file(import_settings, monkeypatch):
    """Kept files are swept by nothing else, so a re-import must drop them."""
    monkeypatch.setattr(
        "app.services.dataset_import_service._load_dataset_stream",
        _fake_stream_factory([{"foo": "bar"}]),
    )

    service = DatasetImportService(import_settings)
    conn = await make_conn(import_settings)
    try:
        bt = FakeBackgroundTasks()
        first = await service.start_import(
            conn, bt, DatasetImportRequest(dataset_id="org/same", split="train")
        )
        await bt.run_all()
        first_kept = service._job_dir(first.import_id) / "output.jsonl"
        assert first_kept.exists()

        bt2 = FakeBackgroundTasks()
        second = await service.start_import(
            conn, bt2, DatasetImportRequest(dataset_id="org/same", split="train")
        )

        assert not first_kept.exists()
        assert not service._job_dir(first.import_id).exists()

        # An unrelated dataset's kept file is left alone.
        await bt2.run_all()
        assert (service._job_dir(second.import_id) / "output.jsonl").exists()
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_dataset_load_failure_still_cleans_up(import_settings, monkeypatch):
    def fake_load_dataset_stream(hf_dataset_id, config, split):
        raise RuntimeError("boom")

    monkeypatch.setattr(
        "app.services.dataset_import_service._load_dataset_stream", fake_load_dataset_stream
    )

    service = DatasetImportService(import_settings)
    conn = await make_conn(import_settings)
    try:
        bt = FakeBackgroundTasks()
        body = DatasetImportRequest(dataset_id="org/unreachable", split="train")
        accepted = await service.start_import(conn, bt, body)
        await bt.run_all()

        row = await DatasetImportsRepo(conn).get(accepted.import_id)
        assert row["status"] == "failed"
        assert "dataset yüklenemedi" in row["error"]

        job_dir = service._job_dir(accepted.import_id)
        assert not job_dir.exists()
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_zero_rows_still_cleans_up(import_settings, monkeypatch):
    monkeypatch.setattr(
        "app.services.dataset_import_service._load_dataset_stream", _fake_stream_factory([])
    )

    service = DatasetImportService(import_settings)
    conn = await make_conn(import_settings)
    try:
        bt = FakeBackgroundTasks()
        body = DatasetImportRequest(dataset_id="org/empty", split="train")
        accepted = await service.start_import(conn, bt, body)
        await bt.run_all()

        row = await DatasetImportsRepo(conn).get(accepted.import_id)
        assert row["status"] == "failed"

        job_dir = service._job_dir(accepted.import_id)
        assert not job_dir.exists()
    finally:
        await conn.close()
