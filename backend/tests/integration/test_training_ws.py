import asyncio

from fastapi.testclient import TestClient

from app.config import get_settings
from app.core.ws import get_ws_manager
from app.main import create_app
from app.schemas.training import JobStatus, MetricEvent, RunSummary, TrainingConfig
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


def _metric(run_id: str, step: int) -> MetricEvent:
    return MetricEvent(run_id=run_id, step=step, kind="train", loss=1.0 / step, ts="2026-07-15T00:00:00Z")


class _BackfillRaceManager:
    """Fake JobManager whose `get_metrics` broadcasts extra metric frames to
    the run topic before returning, simulating the pump persisting-and-
    broadcasting metrics exactly in the backfill window. With the old handler
    ordering (backfill read, status, THEN subscribe) any frame broadcast here
    reached no subscriber and was lost; with subscribe-first it is buffered
    and de-duplicated against the backfill."""

    def __init__(self, run: RunSummary, backfill: list[MetricEvent], live: list[MetricEvent]):
        self._run = run
        self._backfill = backfill
        self._live = live
        self._done = asyncio.Event()

    async def get_run(self, run_id: str) -> RunSummary:
        return self._run

    async def get_metrics(self, run_id: str, after_step: int = 0, kind: str | None = None):
        ws_manager = get_ws_manager()
        for metric in self._live:
            await ws_manager.broadcast(
                f"train/{run_id}", {"type": "metric", "data": metric.model_dump()}
            )
        return [m for m in self._backfill if m.step > after_step]

    def done_event(self, run_id: str) -> asyncio.Event:
        return self._done


def test_ws_train_metric_broadcast_during_backfill_is_not_lost_or_duplicated(data_dir):
    manager_module.reset_job_manager()
    application = create_app()

    run_id = "run_backfill_race"
    run = RunSummary(
        run_id=run_id,
        name="ws-run",
        status=JobStatus.RUNNING,
        config=TrainingConfig.model_validate(_config_payload()),
        created_at="2026-07-15T00:00:00Z",
        started_at="2026-07-15T00:00:01Z",
    )
    backfill = [_metric(run_id, step) for step in (1, 2, 3)]
    # Broadcast mid-window: step 3 overlaps the backfill (must not be
    # duplicated), step 4 is new (was lost with the old ordering).
    live = [_metric(run_id, 3), _metric(run_id, 4)]
    fake_manager = _BackfillRaceManager(run, backfill, live)

    with TestClient(application) as client:
        settings = get_settings()
        ensure_data_dirs(settings)
        application.dependency_overrides[manager_module.get_job_manager] = lambda: fake_manager

        with client.websocket_connect(f"/api/v1/ws/train/{run_id}") as ws:
            ws.send_json({"last_step": 0})

            frames = []
            metric_steps = []
            while True:
                frame = ws.receive_json()
                frames.append(frame)
                if frame["type"] == "metric":
                    metric_steps.append(frame["data"]["step"])
                    if frame["data"]["step"] == 4:
                        break

        # No loss: every step arrived. No duplicates: the overlapping step 3
        # was delivered exactly once.
        assert sorted(metric_steps) == [1, 2, 3, 4]
        assert [f["status"] for f in frames if f["type"] == "status"] == ["running"]

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
