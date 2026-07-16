import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.config import get_settings


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("MLXLF_DATA_DIR", str(tmp_path))
    # Point the static dir at a path that doesn't exist so tests are hermetic
    # even when the repo has a built `frontend/dist` (which create_app would
    # otherwise auto-detect and mount). Static-serving tests override this.
    monkeypatch.setenv("MLXLF_STATIC_DIR", str(tmp_path / "no-static"))
    get_settings.cache_clear()
    yield tmp_path
    get_settings.cache_clear()


@pytest_asyncio.fixture
async def app(data_dir):
    from app.main import create_app

    application = create_app()
    async with application.router.lifespan_context(application):
        yield application


@pytest_asyncio.fixture
async def client(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest_asyncio.fixture
async def db_conn(data_dir):
    import aiosqlite

    settings = get_settings()
    async with aiosqlite.connect(settings.db_path) as conn:
        conn.row_factory = aiosqlite.Row
        yield conn
