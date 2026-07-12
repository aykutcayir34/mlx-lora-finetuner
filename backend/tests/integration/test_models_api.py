from __future__ import annotations

import json
import threading

import pytest

from app.config import get_settings
from app.db.repositories import RunsRepo
from app.services.model_registry import get_model_registry
from tests.unit.models.test_downloads import _fake_snapshot_download_factory


def _make_model_dir(data_dir, model_id: str, config: dict):
    settings = get_settings()
    org, _, name = model_id.partition("/")
    path = settings.models_dir / f"{org}__{name}"
    path.mkdir(parents=True, exist_ok=True)
    (path / "config.json").write_text(json.dumps(config))
    return path


async def _seed_running_run(db_conn, model_id: str):
    repo = RunsRepo(db_conn)
    await repo.insert(
        "run_active",
        "active-run",
        "running",
        "{}",
        model_id,
        "ds_1",
        "sft",
        "2026-01-01T00:00:00Z",
    )


class _FakeHit:
    def __init__(self, id: str, downloads: int = 0, likes: int = 0):
        self.id = id
        self.downloads = downloads
        self.likes = likes


class _FakeHfApi:
    hits: list = []
    raise_error: Exception | None = None

    def __init__(self, token=None):
        pass

    def list_models(self, **kwargs):
        if _FakeHfApi.raise_error is not None:
            raise _FakeHfApi.raise_error
        return list(_FakeHfApi.hits)


@pytest.fixture(autouse=True)
def _reset_fake_hf_api():
    _FakeHfApi.hits = []
    _FakeHfApi.raise_error = None
    yield


# --------------------------------------------------------------------------
# GET /models
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_models_empty(client):
    response = await client.get("/api/v1/models")
    assert response.status_code == 200
    assert response.json() == {"models": []}


@pytest.mark.asyncio
async def test_list_models_returns_local_models(client, data_dir):
    _make_model_dir(
        data_dir, "mlx-community/SmolLM-135M-Instruct-4bit",
        {"model_type": "llama", "quantization": {"bits": 4, "group_size": 64}},
    )
    response = await client.get("/api/v1/models")
    assert response.status_code == 200
    data = response.json()
    assert len(data["models"]) == 1
    model = data["models"][0]
    assert model["model_id"] == "mlx-community/SmolLM-135M-Instruct-4bit"
    assert model["quantization"] == {"bits": 4, "group_size": 64}
    assert model["model_type"] == "llama"


# --------------------------------------------------------------------------
# GET /models/search
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_search_models_returns_results(client, monkeypatch):
    monkeypatch.setattr("app.services.model_registry.HfApi", _FakeHfApi)
    _FakeHfApi.hits = [_FakeHit(id="mlx-community/Foo", downloads=10, likes=2)]

    response = await client.get("/api/v1/models/search", params={"q": "foo"})
    assert response.status_code == 200
    data = response.json()
    assert data["results"] == [
        {
            "model_id": "mlx-community/Foo",
            "downloads": 10,
            "likes": 2,
            "size_bytes": None,
            "downloaded": False,
        }
    ]


@pytest.mark.asyncio
async def test_search_models_hf_error_is_502(client, monkeypatch):
    monkeypatch.setattr("app.services.model_registry.HfApi", _FakeHfApi)
    _FakeHfApi.raise_error = ConnectionError("no network")

    response = await client.get("/api/v1/models/search")
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "internal"


# --------------------------------------------------------------------------
# POST /models/download, GET /models/downloads
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_download_model_returns_202_and_completes(client, monkeypatch):
    monkeypatch.setattr(
        "app.services.model_registry.snapshot_download", _fake_snapshot_download_factory()
    )

    response = await client.post(
        "/api/v1/models/download", json={"model_id": "mlx-community/ApiTiny"}
    )
    assert response.status_code == 202
    data = response.json()
    assert data["download_id"].startswith("dl_")
    assert data["model_id"] == "mlx-community/ApiTiny"
    assert data["status"] == "running"

    registry = get_model_registry(get_settings())
    await registry._downloads[data["download_id"]].task

    list_response = await client.get("/api/v1/models/downloads")
    assert list_response.status_code == 200
    rows = list_response.json()["downloads"]
    row = next(r for r in rows if r["download_id"] == data["download_id"])
    assert row["status"] == "completed"
    assert row["bytes_done"] == 100
    assert row["files_done"] == 2


@pytest.mark.asyncio
async def test_download_model_conflict_while_running(client, monkeypatch):
    event = threading.Event()
    monkeypatch.setattr(
        "app.services.model_registry.snapshot_download",
        _fake_snapshot_download_factory(event=event),
    )

    first = await client.post(
        "/api/v1/models/download", json={"model_id": "mlx-community/ApiBusy"}
    )
    assert first.status_code == 202

    second = await client.post(
        "/api/v1/models/download", json={"model_id": "mlx-community/ApiBusy"}
    )
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "conflict"

    event.set()
    registry = get_model_registry(get_settings())
    await registry._downloads[first.json()["download_id"]].task


@pytest.mark.asyncio
async def test_download_model_conflict_when_already_downloaded(client, data_dir):
    _make_model_dir(data_dir, "mlx-community/Existing", {"model_type": "llama"})

    response = await client.post(
        "/api/v1/models/download", json={"model_id": "mlx-community/Existing"}
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "conflict"


# --------------------------------------------------------------------------
# DELETE /models/{model_id}
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_model_not_found(client):
    response = await client.delete("/api/v1/models/mlx-community%2FDoesNotExist")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


@pytest.mark.asyncio
async def test_delete_model_training_active_conflict(client, data_dir, db_conn):
    _make_model_dir(data_dir, "mlx-community/InUse", {"model_type": "llama"})
    await _seed_running_run(db_conn, "mlx-community/InUse")

    response = await client.delete("/api/v1/models/mlx-community%2FInUse")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "training_active"


@pytest.mark.asyncio
async def test_delete_model_success(client, data_dir):
    model_dir = _make_model_dir(data_dir, "mlx-community/ToDelete", {"model_type": "llama"})
    assert model_dir.is_dir()

    response = await client.delete("/api/v1/models/mlx-community%2FToDelete")
    assert response.status_code == 204
    assert not model_dir.is_dir()

    list_response = await client.get("/api/v1/models")
    assert list_response.json() == {"models": []}


# --------------------------------------------------------------------------
# WS /ws/downloads/{download_id}
# --------------------------------------------------------------------------


def test_ws_downloads_streams_progress_then_done(data_dir, monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import create_app

    monkeypatch.setattr(
        "app.services.model_registry.snapshot_download", _fake_snapshot_download_factory()
    )

    test_app = create_app()
    with TestClient(test_app) as tc:
        response = tc.post(
            "/api/v1/models/download", json={"model_id": "mlx-community/WsTiny"}
        )
        assert response.status_code == 202
        download_id = response.json()["download_id"]

        frames = []
        with tc.websocket_connect(f"/api/v1/ws/downloads/{download_id}") as ws:
            while True:
                frame = ws.receive_json()
                frames.append(frame)
                if frame["type"] in ("done", "error"):
                    break

        assert frames[-1] == {"type": "done"}
        assert any(f["type"] == "progress" for f in frames)


def test_ws_downloads_unknown_id_gets_error_frame(data_dir):
    from fastapi.testclient import TestClient

    from app.main import create_app

    test_app = create_app()
    with TestClient(test_app) as tc:
        with tc.websocket_connect("/api/v1/ws/downloads/dl_does_not_exist") as ws:
            frame = ws.receive_json()
            assert frame["type"] == "error"


# --------------------------------------------------------------------------
# POST /models/downloads/{download_id}/cancel
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cancel_download_returns_202_then_ws_terminal_cancelled_frame(client, monkeypatch):
    event = threading.Event()
    monkeypatch.setattr(
        "app.services.model_registry.snapshot_download",
        _fake_snapshot_download_factory(event=event),
    )

    response = await client.post(
        "/api/v1/models/download", json={"model_id": "mlx-community/ApiCancelMe"}
    )
    assert response.status_code == 202
    download_id = response.json()["download_id"]

    cancel_response = await client.post(f"/api/v1/models/downloads/{download_id}/cancel")
    assert cancel_response.status_code == 202
    assert cancel_response.json()["status"] == "running"
    assert cancel_response.json()["download_id"] == download_id

    event.set()
    registry = get_model_registry(get_settings())
    await registry._downloads[download_id].task

    list_response = await client.get("/api/v1/models/downloads")
    row = next(
        r for r in list_response.json()["downloads"] if r["download_id"] == download_id
    )
    assert row["status"] == "cancelled"


def test_ws_downloads_streams_progress_then_cancelled(data_dir, monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import create_app

    event = threading.Event()
    monkeypatch.setattr(
        "app.services.model_registry.snapshot_download",
        _fake_snapshot_download_factory(event=event),
    )

    test_app = create_app()
    with TestClient(test_app) as tc:
        response = tc.post(
            "/api/v1/models/download", json={"model_id": "mlx-community/WsCancelMe"}
        )
        assert response.status_code == 202
        download_id = response.json()["download_id"]

        cancel_response = tc.post(f"/api/v1/models/downloads/{download_id}/cancel")
        assert cancel_response.status_code == 202

        event.set()

        frames = []
        with tc.websocket_connect(f"/api/v1/ws/downloads/{download_id}") as ws:
            while True:
                frame = ws.receive_json()
                frames.append(frame)
                if frame["type"] in ("done", "error", "cancelled"):
                    break

        assert frames[-1] == {"type": "cancelled"}


@pytest.mark.asyncio
async def test_cancel_download_already_terminal_is_409(client, monkeypatch):
    monkeypatch.setattr(
        "app.services.model_registry.snapshot_download", _fake_snapshot_download_factory()
    )

    response = await client.post(
        "/api/v1/models/download", json={"model_id": "mlx-community/ApiAlreadyDone"}
    )
    download_id = response.json()["download_id"]
    registry = get_model_registry(get_settings())
    await registry._downloads[download_id].task

    cancel_response = await client.post(f"/api/v1/models/downloads/{download_id}/cancel")
    assert cancel_response.status_code == 409
    assert cancel_response.json()["error"]["code"] == "conflict"


@pytest.mark.asyncio
async def test_cancel_download_unknown_id_is_404(client):
    response = await client.post("/api/v1/models/downloads/dl_does_not_exist/cancel")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


@pytest.mark.asyncio
async def test_cancelled_download_can_be_retried_via_api(client, monkeypatch):
    event = threading.Event()
    monkeypatch.setattr(
        "app.services.model_registry.snapshot_download",
        _fake_snapshot_download_factory(event=event),
    )

    response = await client.post(
        "/api/v1/models/download", json={"model_id": "mlx-community/ApiResumable"}
    )
    download_id = response.json()["download_id"]

    cancel_response = await client.post(f"/api/v1/models/downloads/{download_id}/cancel")
    assert cancel_response.status_code == 202

    event.set()
    registry = get_model_registry(get_settings())
    await registry._downloads[download_id].task

    monkeypatch.setattr(
        "app.services.model_registry.snapshot_download", _fake_snapshot_download_factory()
    )
    retry_response = await client.post(
        "/api/v1/models/download", json={"model_id": "mlx-community/ApiResumable"}
    )
    assert retry_response.status_code == 202
    retry_download_id = retry_response.json()["download_id"]
    assert retry_download_id != download_id

    await registry._downloads[retry_download_id].task
    list_response = await client.get("/api/v1/models/downloads")
    row = next(
        r for r in list_response.json()["downloads"] if r["download_id"] == retry_download_id
    )
    assert row["status"] == "completed"
