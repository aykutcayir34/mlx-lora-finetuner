import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.config import get_settings

INDEX_HTML = "<!doctype html><html><body>spa-index</body></html>"
APP_JS = "console.log('spa');"


@pytest_asyncio.fixture
async def static_client(data_dir, tmp_path, monkeypatch):
    """Client for an app created with a populated MLXLF_STATIC_DIR."""
    static_dir = tmp_path / "dist"
    (static_dir / "assets").mkdir(parents=True)
    (static_dir / "index.html").write_text(INDEX_HTML)
    (static_dir / "assets" / "app.js").write_text(APP_JS)

    monkeypatch.setenv("MLXLF_STATIC_DIR", str(static_dir))
    get_settings.cache_clear()

    from app.main import create_app

    application = create_app()
    async with application.router.lifespan_context(application):
        transport = ASGITransport(app=application)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_root_returns_404_without_static_dir(client):
    # Default dev/test behavior: no built frontend, nothing mounted at "/".
    response = await client.get("/")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_root_serves_index_html(static_client):
    response = await static_client.get("/")
    assert response.status_code == 200
    assert response.text == INDEX_HTML
    assert response.headers["content-type"].startswith("text/html")


@pytest.mark.asyncio
async def test_asset_served_with_content_type(static_client):
    response = await static_client.get("/assets/app.js")
    assert response.status_code == 200
    assert response.text == APP_JS
    assert "javascript" in response.headers["content-type"]


@pytest.mark.asyncio
async def test_deep_link_falls_back_to_index_html(static_client):
    response = await static_client.get("/training")
    assert response.status_code == 200
    assert response.text == INDEX_HTML
    assert response.headers["content-type"].startswith("text/html")


@pytest.mark.asyncio
async def test_unknown_api_path_returns_json_404_not_index(static_client):
    response = await static_client.get("/api/v1/nonexistent")
    assert response.status_code == 404
    assert response.headers["content-type"] == "application/json"
    assert response.json() == {"detail": "Not Found"}


@pytest.mark.asyncio
async def test_api_routes_still_work_with_static_mount(static_client):
    response = await static_client.get("/api/v1/system/health")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"
    assert response.json()["status"] == "ok"
