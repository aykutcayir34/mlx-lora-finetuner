import threading
import types
from pathlib import Path

import aiosqlite
import pytest

from app.core.errors import ConflictError
from app.db.database import init_db
from app.db.repositories import DownloadsRepo
from app.services.model_registry import ModelRegistry
from tests.unit.models.conftest import write_local_model


async def _make_conn(settings):
    await init_db(settings.db_path)
    conn = await aiosqlite.connect(settings.db_path)
    conn.row_factory = aiosqlite.Row
    return conn


def _fake_snapshot_download_factory(config_json: bytes = b'{"model_type": "llama"}', event: threading.Event | None = None):
    def fake_snapshot_download(*, repo_id, local_dir, tqdm_class, token=None):
        files_bar = tqdm_class(total=2, desc="Fetching 2 files", unit="it")
        bytes_bar = tqdm_class(total=100, desc="Downloading bytes", unit="B", unit_scale=True)

        bytes_bar.update(50)
        files_bar.update(1)
        if event is not None:
            event.wait(timeout=5)
        bytes_bar.update(50)
        files_bar.update(1)
        bytes_bar.close()
        files_bar.close()

        Path(local_dir).mkdir(parents=True, exist_ok=True)
        (Path(local_dir) / "config.json").write_bytes(config_json)
        return local_dir

    return fake_snapshot_download


@pytest.mark.asyncio
async def test_download_success_updates_db_and_creates_local_model(registry_settings, monkeypatch):
    monkeypatch.setattr(
        "app.services.model_registry.snapshot_download", _fake_snapshot_download_factory()
    )
    registry = ModelRegistry(registry_settings)
    conn = await _make_conn(registry_settings)
    try:
        info = await registry.start_download("mlx-community/Tiny", conn)
        assert info.status == "running"
        assert info.download_id.startswith("dl_")

        state = registry._downloads[info.download_id]
        await state.task

        row = await DownloadsRepo(conn).get(info.download_id)
        assert row["status"] == "completed"
        assert row["bytes_done"] == 100
        assert row["bytes_total"] == 100
        assert row["files_done"] == 2
        assert row["files_total"] == 2
        assert row["finished_at"] is not None

        local_models = await registry.list_local_models()
        assert any(m.model_id == "mlx-community/Tiny" for m in local_models)
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_download_failure_marks_failed_with_error(registry_settings, monkeypatch):
    def boom(*, repo_id, local_dir, tqdm_class, token=None):
        raise RuntimeError("network exploded")

    monkeypatch.setattr("app.services.model_registry.snapshot_download", boom)
    registry = ModelRegistry(registry_settings)
    conn = await _make_conn(registry_settings)
    try:
        info = await registry.start_download("mlx-community/Broken", conn)
        state = registry._downloads[info.download_id]
        await state.task

        row = await DownloadsRepo(conn).get(info.download_id)
        assert row["status"] == "failed"
        assert "network exploded" in row["error"]
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_failed_download_can_be_retried(registry_settings, monkeypatch):
    def boom(*, repo_id, local_dir, tqdm_class, token=None):
        raise RuntimeError("first attempt fails")

    monkeypatch.setattr("app.services.model_registry.snapshot_download", boom)
    registry = ModelRegistry(registry_settings)
    conn = await _make_conn(registry_settings)
    try:
        first = await registry.start_download("mlx-community/Retryable", conn)
        await registry._downloads[first.download_id].task
        row = await DownloadsRepo(conn).get(first.download_id)
        assert row["status"] == "failed"

        # Re-POST after failure must succeed (not 409) and use snapshot_download again.
        monkeypatch.setattr(
            "app.services.model_registry.snapshot_download", _fake_snapshot_download_factory()
        )
        second = await registry.start_download("mlx-community/Retryable", conn)
        assert second.download_id != first.download_id
        await registry._downloads[second.download_id].task
        row2 = await DownloadsRepo(conn).get(second.download_id)
        assert row2["status"] == "completed"
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_download_conflicts_while_running(registry_settings, monkeypatch):
    event = threading.Event()
    monkeypatch.setattr(
        "app.services.model_registry.snapshot_download",
        _fake_snapshot_download_factory(event=event),
    )
    registry = ModelRegistry(registry_settings)
    conn = await _make_conn(registry_settings)
    try:
        first = await registry.start_download("mlx-community/Busy", conn)

        with pytest.raises(ConflictError):
            await registry.start_download("mlx-community/Busy", conn)

        event.set()
        await registry._downloads[first.download_id].task
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_download_conflicts_when_already_downloaded(registry_settings, monkeypatch):
    write_local_model(
        registry_settings.models_dir,
        "mlx-community",
        "AlreadyHere",
        {"model_type": "llama"},
    )
    registry = ModelRegistry(registry_settings)
    conn = await _make_conn(registry_settings)
    try:
        with pytest.raises(ConflictError):
            await registry.start_download("mlx-community/AlreadyHere", conn)
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_disk_preflight_blocks_download_when_insufficient_space(registry_settings, monkeypatch):
    registry = ModelRegistry(registry_settings)
    monkeypatch.setattr(registry, "_estimate_repo_size_bytes", lambda model_id: 10**15)
    monkeypatch.setattr(
        "app.services.model_registry.shutil.disk_usage",
        lambda path: types.SimpleNamespace(total=10**16, used=0, free=10**6),
    )
    conn = await _make_conn(registry_settings)
    try:
        with pytest.raises(ConflictError):
            await registry.start_download("mlx-community/TooBig", conn)
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_disk_preflight_skipped_when_size_unknown(registry_settings, monkeypatch):
    registry = ModelRegistry(registry_settings)
    monkeypatch.setattr(registry, "_estimate_repo_size_bytes", lambda model_id: None)
    monkeypatch.setattr(
        "app.services.model_registry.snapshot_download", _fake_snapshot_download_factory()
    )
    conn = await _make_conn(registry_settings)
    try:
        info = await registry.start_download("mlx-community/UnknownSize", conn)
        await registry._downloads[info.download_id].task
        row = await DownloadsRepo(conn).get(info.download_id)
        assert row["status"] == "completed"
    finally:
        await conn.close()
