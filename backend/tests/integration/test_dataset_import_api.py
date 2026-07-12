import asyncio
import threading
from dataclasses import dataclass

import pytest

from app.db.repositories import DatasetImportsRepo


@dataclass
class _FakeDatasetHit:
    id: str
    downloads: int | None = 0
    likes: int | None = 0


class _FakeHfApi:
    """Stand-in for huggingface_hub.HfApi.list_datasets, mirrors the model
    search fake in tests/unit/models/test_search.py."""

    last_kwargs: dict | None = None
    hits: list[_FakeDatasetHit] = []

    def __init__(self, token=None):
        self.token = token

    def list_datasets(self, **kwargs):
        _FakeHfApi.last_kwargs = kwargs
        return list(_FakeHfApi.hits)


@pytest.fixture(autouse=True)
def _reset_fake_api():
    _FakeHfApi.last_kwargs = None
    _FakeHfApi.hits = []
    yield


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


async def _poll_import_by_hf_id(client, hf_dataset_id: str, attempts: int = 200):
    for _ in range(attempts):
        response = await client.get("/api/v1/datasets/imports")
        imports = response.json()["imports"]
        match = next((i for i in imports if i["hf_dataset_id"] == hf_dataset_id), None)
        if match is not None:
            return match
        await asyncio.sleep(0.01)
    raise AssertionError(f"import for '{hf_dataset_id}' never appeared")


# --------------------------------------------------------------------------
# Search
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_search_datasets_returns_hits_with_imported_flag(client, db_conn, monkeypatch):
    monkeypatch.setattr("app.services.dataset_import_service.HfApi", _FakeHfApi)
    _FakeHfApi.hits = [
        _FakeDatasetHit(id="mlx-community/wikisql", downloads=1234, likes=5),
        _FakeDatasetHit(id="mlx-community/other", downloads=3, likes=1),
    ]
    await DatasetImportsRepo(db_conn).insert(
        id="di_prior",
        hf_dataset_id="mlx-community/wikisql",
        config=None,
        split="train",
        name="wikisql",
        max_rows=None,
        status="completed",
        started_at="2026-07-12T00:00:00Z",
    )

    response = await client.get("/api/v1/datasets/search?q=wikisql&limit=20")
    assert response.status_code == 200
    results = {r["dataset_id"]: r for r in response.json()["results"]}
    assert results["mlx-community/wikisql"]["imported"] is True
    assert results["mlx-community/wikisql"]["downloads"] == 1234
    assert results["mlx-community/other"]["imported"] is False
    assert _FakeHfApi.last_kwargs["search"] == "wikisql"
    assert _FakeHfApi.last_kwargs["limit"] == 20


# --------------------------------------------------------------------------
# Import: happy path
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_import_dataset_completes_and_appears_in_local_datasets(client, monkeypatch):
    rows = [{"text": f"row {i}"} for i in range(3)]
    monkeypatch.setattr(
        "app.services.dataset_import_service._load_dataset_stream", _fake_stream_factory(rows)
    )

    response = await client.post(
        "/api/v1/datasets/import",
        json={"dataset_id": "mlx-community/tiny-text", "split": "train"},
    )
    assert response.status_code == 202
    body = response.json()
    assert body["dataset_id"] == "mlx-community/tiny-text"
    assert body["import_id"].startswith("di_")

    match = await _poll_import_by_hf_id(client, "mlx-community/tiny-text")
    assert match["status"] == "completed"
    assert match["rows_written"] == 3
    assert match["dataset_id"] is not None

    datasets_resp = await client.get("/api/v1/datasets")
    local_ids = [d["dataset_id"] for d in datasets_resp.json()["datasets"]]
    assert match["dataset_id"] in local_ids


# --------------------------------------------------------------------------
# Import: 409 duplicate while running
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_duplicate_import_while_running_is_409(client, monkeypatch):
    pause_event = threading.Event()
    resume_event = threading.Event()
    monkeypatch.setattr(
        "app.services.dataset_import_service._load_dataset_stream",
        _pausing_stream_factory(1000, pause_at=5, pause_event=pause_event, resume_event=resume_event),
    )

    first_task = asyncio.create_task(
        client.post(
            "/api/v1/datasets/import",
            json={"dataset_id": "mlx-community/busy-dataset", "split": "train"},
        )
    )

    match = await _poll_import_by_hf_id(client, "mlx-community/busy-dataset")
    assert match["status"] == "running"

    second_response = await client.post(
        "/api/v1/datasets/import",
        json={"dataset_id": "mlx-community/busy-dataset", "split": "train"},
    )
    assert second_response.status_code == 409
    assert second_response.json()["error"]["code"] == "conflict"

    resume_event.set()
    first_response = await first_task
    assert first_response.status_code == 202


# --------------------------------------------------------------------------
# Cancel
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cancel_import_then_double_cancel_and_unknown_id(client, monkeypatch):
    pause_event = threading.Event()
    resume_event = threading.Event()
    monkeypatch.setattr(
        "app.services.dataset_import_service._load_dataset_stream",
        _pausing_stream_factory(1000, pause_at=5, pause_event=pause_event, resume_event=resume_event),
    )

    import_task = asyncio.create_task(
        client.post(
            "/api/v1/datasets/import",
            json={"dataset_id": "mlx-community/cancel-me", "split": "train"},
        )
    )

    match = await _poll_import_by_hf_id(client, "mlx-community/cancel-me")
    import_id = match["import_id"]

    cancel_response = await client.post(f"/api/v1/datasets/imports/{import_id}/cancel")
    assert cancel_response.status_code == 202
    assert cancel_response.json()["status"] == "cancelled"

    second_cancel = await client.post(f"/api/v1/datasets/imports/{import_id}/cancel")
    assert second_cancel.status_code == 409
    assert second_cancel.json()["error"]["code"] == "conflict"

    unknown_cancel = await client.post("/api/v1/datasets/imports/di_does_not_exist/cancel")
    assert unknown_cancel.status_code == 404
    assert unknown_cancel.json()["error"]["code"] == "not_found"

    resume_event.set()
    await import_task

    datasets_resp = await client.get("/api/v1/datasets")
    names = [d["name"] for d in datasets_resp.json()["datasets"]]
    assert "cancel-me" not in names
