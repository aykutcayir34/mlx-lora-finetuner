import asyncio

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import get_settings
from app.main import create_app
from app.training import manager as manager_module
from tests.fixtures.training_helpers import (
    ensure_data_dirs,
    make_worker_argv_factory,
    setup_dataset,
    setup_model_dir,
)


def _config_payload(**overrides) -> dict:
    base = {
        "name": "my-run",
        "model_id": "mlx-community/Tiny-1",
        "dataset_id": "ds_1",
        "train_mode": "sft",
        "train_type": "lora",
        "batch_size": 1,
        "iters": 3,
    }
    base.update(overrides)
    return base


@pytest.fixture
async def training_app(data_dir):
    manager_module.reset_job_manager()
    application = create_app()
    async with application.router.lifespan_context(application):
        settings = get_settings()
        ensure_data_dirs(settings)
        setup_model_dir(settings)
        await setup_dataset(settings)

        test_manager = manager_module.JobManager(
            settings=settings,
            worker_argv_factory=make_worker_argv_factory(
                "happy", FAKE_WORKER_ITERS=3, FAKE_WORKER_STEP_DELAY=0.0
            ),
            cancel_grace_seconds=0.3,
        )
        application.dependency_overrides[manager_module.get_job_manager] = lambda: test_manager
        yield application, test_manager
        application.dependency_overrides.clear()


@pytest.fixture
async def training_client(training_app):
    application, _ = training_app
    transport = ASGITransport(app=application)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.mark.asyncio
async def test_create_job_returns_201_running(training_client):
    resp = await training_client.post("/api/v1/train/jobs", json=_config_payload())
    assert resp.status_code == 201
    data = resp.json()
    assert data["status"] == "running"
    assert data["run_id"].startswith("run_")
    assert data["config"]["name"] == "my-run"


@pytest.mark.asyncio
async def test_second_job_returns_409_training_active(training_client):
    first = await training_client.post("/api/v1/train/jobs", json=_config_payload())
    assert first.status_code == 201

    resp = await training_client.post("/api/v1/train/jobs", json=_config_payload(name="second"))
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "training_active"


@pytest.mark.asyncio
async def test_model_not_found_returns_404(training_client):
    resp = await training_client.post(
        "/api/v1/train/jobs", json=_config_payload(model_id="mlx-community/does-not-exist")
    )
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "not_found"


@pytest.mark.asyncio
async def test_dataset_not_found_returns_404(training_client):
    resp = await training_client.post(
        "/api/v1/train/jobs", json=_config_payload(dataset_id="ds_missing")
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_missing_run_returns_404(training_client):
    resp = await training_client.get("/api/v1/train/jobs/run_missing")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "not_found"


@pytest.mark.asyncio
async def test_run_lifecycle_detail_list_metrics_logs(training_app, training_client):
    _application, test_manager = training_app

    created = await training_client.post("/api/v1/train/jobs", json=_config_payload())
    run_id = created.json()["run_id"]

    detail = await training_client.get(f"/api/v1/train/jobs/{run_id}")
    assert detail.status_code == 200
    assert detail.json()["run_id"] == run_id

    listing = await training_client.get("/api/v1/train/jobs")
    assert listing.status_code == 200
    body = listing.json()
    assert body["total"] == 1
    assert body["runs"][0]["run_id"] == run_id

    task = test_manager._pump_tasks.get(run_id)
    if task is not None:
        await asyncio.wait_for(task, timeout=5)

    metrics = await training_client.get(
        f"/api/v1/train/jobs/{run_id}/metrics", params={"after_step": 1}
    )
    assert metrics.status_code == 200
    metric_rows = metrics.json()["metrics"]
    assert all(m["step"] > 1 for m in metric_rows)
    assert all(m["run_id"] == run_id for m in metric_rows)

    logs = await training_client.get(f"/api/v1/train/jobs/{run_id}/logs")
    assert logs.status_code == 200
    assert isinstance(logs.json()["lines"], list)
    assert len(logs.json()["lines"]) > 0

    final_detail = await training_client.get(f"/api/v1/train/jobs/{run_id}")
    assert final_detail.json()["status"] == "completed"


@pytest.mark.asyncio
async def test_cancel_returns_202_and_eventually_cancelled(training_app, training_client):
    _application, test_manager = training_app

    created = await training_client.post("/api/v1/train/jobs", json=_config_payload(iters=1000))
    run_id = created.json()["run_id"]

    cancel_resp = await training_client.post(f"/api/v1/train/jobs/{run_id}/cancel")
    assert cancel_resp.status_code == 202
    assert cancel_resp.json()["run_id"] == run_id

    await asyncio.wait_for(test_manager.done_event(run_id).wait(), timeout=5)

    final = await training_client.get(f"/api/v1/train/jobs/{run_id}")
    assert final.json()["status"] == "cancelled"


@pytest.mark.asyncio
async def test_cancel_missing_run_returns_404(training_client):
    resp = await training_client.post("/api/v1/train/jobs/run_missing/cancel")
    assert resp.status_code == 404
