import threading

import aiosqlite
import pytest

from app.core.errors import ConflictError, NotFoundError
from app.db.database import init_db
from app.db.repositories import DownloadsRepo
from app.services.model_registry import ModelRegistry
from tests.unit.models.test_downloads import _fake_snapshot_download_factory


async def _make_conn(settings):
    await init_db(settings.db_path)
    conn = await aiosqlite.connect(settings.db_path)
    conn.row_factory = aiosqlite.Row
    return conn


@pytest.mark.asyncio
async def test_cancel_mid_progress_marks_cancelled_and_broadcasts(registry_settings, monkeypatch):
    event = threading.Event()
    monkeypatch.setattr(
        "app.services.model_registry.snapshot_download",
        _fake_snapshot_download_factory(event=event),
    )
    registry = ModelRegistry(registry_settings)
    conn = await _make_conn(registry_settings)
    try:
        info = await registry.start_download("mlx-community/CancelMe", conn)
        state = registry._downloads[info.download_id]

        # A subscriber attached before cancellation should receive the
        # terminal "cancelled" frame once the download thread notices.
        queue = await registry.subscribe(info.download_id, conn)

        cancelled_info = await registry.cancel_download(info.download_id, conn)
        assert cancelled_info.status == "running"
        assert cancelled_info.download_id == info.download_id

        # Let the fake snapshot_download's second update() run — it should now
        # observe the cancel_event and raise DownloadCancelled.
        event.set()
        await state.task

        row = await DownloadsRepo(conn).get(info.download_id)
        assert row["status"] == "cancelled"
        assert row["error"] is None
        assert row["finished_at"] is not None

        # First queued frame is the initial progress snapshot; drain until we
        # find the terminal cancelled frame.
        frames = []
        while True:
            frame = await queue.get()
            if frame is None:
                break
            frames.append(frame)
        assert frames[-1] == {"type": "cancelled"}
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_cancel_already_completed_download_conflicts(registry_settings, monkeypatch):
    monkeypatch.setattr(
        "app.services.model_registry.snapshot_download", _fake_snapshot_download_factory()
    )
    registry = ModelRegistry(registry_settings)
    conn = await _make_conn(registry_settings)
    try:
        info = await registry.start_download("mlx-community/AlreadyDone", conn)
        await registry._downloads[info.download_id].task

        with pytest.raises(ConflictError):
            await registry.cancel_download(info.download_id, conn)
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_cancel_unknown_download_id_not_found(registry_settings):
    registry = ModelRegistry(registry_settings)
    conn = await _make_conn(registry_settings)
    try:
        with pytest.raises(NotFoundError):
            await registry.cancel_download("dl_does_not_exist", conn)
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_cancelled_download_can_be_retried(registry_settings, monkeypatch):
    event = threading.Event()
    monkeypatch.setattr(
        "app.services.model_registry.snapshot_download",
        _fake_snapshot_download_factory(event=event),
    )
    registry = ModelRegistry(registry_settings)
    conn = await _make_conn(registry_settings)
    try:
        first = await registry.start_download("mlx-community/Resumable", conn)
        await registry.cancel_download(first.download_id, conn)
        event.set()
        await registry._downloads[first.download_id].task

        row = await DownloadsRepo(conn).get(first.download_id)
        assert row["status"] == "cancelled"

        # Re-POST after cancel must succeed (not 409) and call snapshot_download again.
        monkeypatch.setattr(
            "app.services.model_registry.snapshot_download", _fake_snapshot_download_factory()
        )
        second = await registry.start_download("mlx-community/Resumable", conn)
        assert second.download_id != first.download_id
        await registry._downloads[second.download_id].task
        row2 = await DownloadsRepo(conn).get(second.download_id)
        assert row2["status"] == "completed"
    finally:
        await conn.close()
