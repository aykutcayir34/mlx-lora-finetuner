"""Test-only helpers shared by the JobManager/worker/training-API tests.

Not a pytest plugin — plain importable helpers, kept out of `tests/conftest.py`
(frozen) per the Wave-1 T1 task instructions.
"""

from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path
from typing import Callable

import aiosqlite

from app.config import Settings
from app.db.repositories import DatasetsRepo

FAKE_WORKER_PATH = Path(__file__).parent / "fake_worker.py"

_CHAT_ROW = {
    "messages": [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "hello"},
    ]
}


def make_worker_argv_factory(scenario: str = "happy", **env_overrides: object) -> Callable[[], list[str]]:
    """Build a `worker_argv_factory` pointing JobManager at `fake_worker.py`.

    Sets `FAKE_WORKER_*` env vars right before returning argv, which is
    called synchronously immediately before `subprocess.Popen`, so the
    child inherits them.
    """

    def factory() -> list[str]:
        import os

        os.environ["FAKE_WORKER_SCENARIO"] = scenario
        for key, value in env_overrides.items():
            os.environ[str(key)] = str(value)
        return [sys.executable, str(FAKE_WORKER_PATH)]

    return factory


def setup_model_dir(settings: Settings, model_id: str = "mlx-community/Tiny-1") -> Path:
    model_dir = settings.models_dir / model_id.replace("/", "__")
    model_dir.mkdir(parents=True, exist_ok=True)
    (model_dir / "config.json").write_text("{}")
    return model_dir


async def setup_dataset(
    settings: Settings,
    dataset_id: str = "ds_1",
    fmt: str = "chat",
    name: str = "my-data",
) -> None:
    """Async variant (aiosqlite) for tests already running inside asyncio."""
    data_dir = _write_dataset_files(settings, dataset_id)
    async with aiosqlite.connect(settings.db_path) as conn:
        await DatasetsRepo(conn).insert(
            id=dataset_id,
            name=name,
            format=fmt,
            path=str(data_dir.parent),
            row_count=1,
            splits_json=json.dumps({"train": 1, "valid": 1, "test": 0}),
            created_at="2026-07-12T00:00:00Z",
        )


def setup_dataset_sync(
    settings: Settings,
    dataset_id: str = "ds_1",
    fmt: str = "chat",
    name: str = "my-data",
) -> None:
    """Sync variant (stdlib sqlite3) for tests driven by `TestClient` (no event loop)."""
    data_dir = _write_dataset_files(settings, dataset_id)
    conn = sqlite3.connect(settings.db_path)
    try:
        conn.execute(
            """
            INSERT INTO datasets (id, name, format, path, row_count, splits_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                dataset_id,
                name,
                fmt,
                str(data_dir.parent),
                1,
                json.dumps({"train": 1, "valid": 1, "test": 0}),
                "2026-07-12T00:00:00Z",
            ),
        )
        conn.commit()
    finally:
        conn.close()


def _write_dataset_files(settings: Settings, dataset_id: str) -> Path:
    data_dir = settings.datasets_dir / dataset_id / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "train.jsonl").write_text(json.dumps(_CHAT_ROW) + "\n")
    (data_dir / "valid.jsonl").write_text(json.dumps(_CHAT_ROW) + "\n")
    return data_dir


def ensure_data_dirs(settings: Settings) -> None:
    for directory in (
        settings.data_dir,
        settings.models_dir,
        settings.datasets_dir,
        settings.runs_dir,
        settings.exports_dir,
        settings.cache_dir,
        settings.rewards_dir,
    ):
        directory.mkdir(parents=True, exist_ok=True)
