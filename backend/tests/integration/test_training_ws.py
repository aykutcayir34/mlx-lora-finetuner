from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import create_app
from app.training import manager as manager_module
from tests.fixtures.training_helpers import (
    ensure_data_dirs,
    make_worker_argv_factory,
    setup_dataset_sync,
    setup_model_dir,
)


def _config_payload(**overrides) -> dict:
    base = {
        "name": "ws-run",
        "model_id": "mlx-community/Tiny-1",
        "dataset_id": "ds_1",
        "train_mode": "sft",
        "train_type": "lora",
        "batch_size": 1,
        "iters": 3,
    }
    base.update(overrides)
    return base


def test_ws_train_backfills_then_streams_live_then_closes_on_terminal(data_dir):
    manager_module.reset_job_manager()
    application = create_app()

    with TestClient(application) as client:
        settings = get_settings()
        ensure_data_dirs(settings)
        setup_model_dir(settings)
        setup_dataset_sync(settings)

        test_manager = manager_module.JobManager(
            settings=settings,
            worker_argv_factory=make_worker_argv_factory(
                "happy", FAKE_WORKER_ITERS=3, FAKE_WORKER_STEP_DELAY=0.05
            ),
            cancel_grace_seconds=0.3,
        )
        application.dependency_overrides[manager_module.get_job_manager] = lambda: test_manager

        resp = client.post("/api/v1/train/jobs", json=_config_payload())
        assert resp.status_code == 201
        run_id = resp.json()["run_id"]

        with client.websocket_connect(f"/api/v1/ws/train/{run_id}") as ws:
            ws.send_json({"last_step": 0})

            frames = []
            saw_terminal = False
            while not saw_terminal:
                frame = ws.receive_json()
                frames.append(frame)
                if frame["type"] == "status" and frame["status"] in (
                    "completed",
                    "failed",
                    "cancelled",
                ):
                    saw_terminal = True

        assert frames[0]["type"] == "status"
        assert frames[0]["status"] == "running"
        assert any(f["type"] == "metric" for f in frames)
        assert any(f["type"] == "checkpoint" for f in frames)
        assert frames[-1]["type"] == "status"
        assert frames[-1]["status"] == "completed"

        application.dependency_overrides.clear()


def test_ws_train_backfills_persisted_metrics_after_last_step(data_dir):
    manager_module.reset_job_manager()
    application = create_app()

    with TestClient(application) as client:
        settings = get_settings()
        ensure_data_dirs(settings)
        setup_model_dir(settings)
        setup_dataset_sync(settings)

        test_manager = manager_module.JobManager(
            settings=settings,
            worker_argv_factory=make_worker_argv_factory(
                "happy", FAKE_WORKER_ITERS=3, FAKE_WORKER_STEP_DELAY=0.0
            ),
            cancel_grace_seconds=0.3,
        )
        application.dependency_overrides[manager_module.get_job_manager] = lambda: test_manager

        resp = client.post("/api/v1/train/jobs", json=_config_payload())
        run_id = resp.json()["run_id"]

        with client.websocket_connect(f"/api/v1/ws/train/{run_id}") as ws:
            ws.send_json({"last_step": 0})
            frames = []
            saw_terminal = False
            while not saw_terminal:
                frame = ws.receive_json()
                frames.append(frame)
                if frame["type"] == "status" and frame["status"] in (
                    "completed",
                    "failed",
                    "cancelled",
                ):
                    saw_terminal = True

        # Reconnect with last_step=1: should only backfill metrics for step > 1.
        with client.websocket_connect(f"/api/v1/ws/train/{run_id}") as ws:
            ws.send_json({"last_step": 1})
            first = ws.receive_json()
            backfilled = [first]
            while backfilled[-1]["type"] != "status":
                backfilled.append(ws.receive_json())

        metric_frames = [f for f in backfilled if f["type"] == "metric"]
        assert all(f["data"]["step"] > 1 for f in metric_frames)
        # Already-terminal run: server must close right after the status frame.
        assert backfilled[-1]["status"] == "completed"

        application.dependency_overrides.clear()


def test_ws_train_unknown_run_closes_immediately(data_dir):
    manager_module.reset_job_manager()
    application = create_app()

    with TestClient(application) as client:
        settings = get_settings()
        ensure_data_dirs(settings)

        with client.websocket_connect("/api/v1/ws/train/run_missing") as ws:
            ws.send_json({"last_step": 0})
            from starlette.websockets import WebSocketDisconnect

            try:
                ws.receive_json()
                raised = False
            except WebSocketDisconnect:
                raised = True
            assert raised
