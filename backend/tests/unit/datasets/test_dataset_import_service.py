import asyncio
import threading

import pytest

from app.db.repositories import DatasetImportsRepo, DatasetsRepo
from app.schemas.datasets import DatasetImportRequest
from app.services.dataset_import_service import DatasetImportService
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


@pytest.mark.asyncio
async def test_cancel_mid_stream_leaves_no_local_dataset(import_settings, monkeypatch):
    pause_event = threading.Event()
    resume_event = threading.Event()
    monkeypatch.setattr(
        "app.services.dataset_import_service._load_dataset_stream",
        _pausing_stream_factory(1000, pause_at=20, pause_event=pause_event, resume_event=resume_event),
    )

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

        cancelled_info = await service.cancel_import(conn, accepted.import_id)
        assert cancelled_info.status == "cancelled"

        resume_event.set()
        await run_task

        row = await DatasetImportsRepo(conn).get(accepted.import_id)
        assert row["status"] == "cancelled"
        assert row["dataset_id"] is None

        job_dir = service._job_dir(accepted.import_id)
        assert not job_dir.exists()

        datasets = await DatasetsRepo(conn).list_()
        assert datasets == []
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
