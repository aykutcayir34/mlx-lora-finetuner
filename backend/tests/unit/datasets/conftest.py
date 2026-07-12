import aiosqlite
import pytest

from app.config import get_settings
from app.db.database import init_db


@pytest.fixture
def import_settings(tmp_path, monkeypatch):
    monkeypatch.setenv("MLXLF_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    settings = get_settings()
    settings.datasets_dir.mkdir(parents=True, exist_ok=True)
    settings.cache_dir.mkdir(parents=True, exist_ok=True)
    yield settings
    get_settings.cache_clear()


async def make_conn(settings) -> aiosqlite.Connection:
    await init_db(settings.db_path)
    conn = await aiosqlite.connect(settings.db_path)
    conn.row_factory = aiosqlite.Row
    return conn


class FakeBackgroundTasks:
    """Stand-in for fastapi.BackgroundTasks: captures the call instead of
    running it, so tests can await `_run_job` directly (optionally as a
    concurrent asyncio.Task to exercise mid-stream cancellation)."""

    def __init__(self) -> None:
        self.calls: list[tuple] = []

    def add_task(self, func, *args, **kwargs) -> None:
        self.calls.append((func, args, kwargs))

    async def run_all(self) -> None:
        for func, args, kwargs in self.calls:
            await func(*args, **kwargs)
