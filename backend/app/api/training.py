"""Training job orkestrasyonu: POST/GET /train/jobs*, WS /ws/train/{run_id}.

İş mantığının tamamı `app.training.manager.JobManager`'da; bu router sadece
HTTP/WS sözleşmesini (docs/api.md) JobManager metodlarına bağlar.
"""

from __future__ import annotations

import asyncio
from typing import Annotated

from fastapi import APIRouter, Depends, File, Response, UploadFile, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from app.core.errors import NotFoundError, ValidationAppError
from app.core.ws import get_ws_manager
from app.deps import get_current_user
from app.schemas.training import JobStatus, MetricEvent, RunSummary, TrainingConfig
from app.services.config_yaml import parse_config_yaml, render_config_yaml
from app.training.manager import JobManager, get_job_manager

router = APIRouter(dependencies=[Depends(get_current_user)])

TERMINAL_STATUSES = {JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED}

# A config export is a few KiB of YAML; anything bigger than this is not one.
MAX_CONFIG_IMPORT_BYTES = 256 * 1024


class RunSummaryListResponse(BaseModel):
    runs: list[RunSummary]
    total: int


class MetricEventListResponse(BaseModel):
    metrics: list[MetricEvent]


class LogsResponse(BaseModel):
    lines: list[str]


@router.post("/train/jobs", response_model=RunSummary, status_code=201)
async def create_train_job(
    body: TrainingConfig,
    manager: Annotated[JobManager, Depends(get_job_manager)],
) -> RunSummary:
    return await manager.create_job(body)


@router.get("/train/jobs", response_model=RunSummaryListResponse)
async def list_train_jobs(
    manager: Annotated[JobManager, Depends(get_job_manager)],
    status: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> RunSummaryListResponse:
    runs, total = await manager.list_runs(status=status, limit=limit, offset=offset)
    return RunSummaryListResponse(runs=runs, total=total)


@router.get("/train/jobs/{run_id}", response_model=RunSummary)
async def get_train_job(
    run_id: str,
    manager: Annotated[JobManager, Depends(get_job_manager)],
) -> RunSummary:
    return await manager.get_run(run_id)


@router.post("/train/jobs/{run_id}/cancel", response_model=RunSummary, status_code=202)
async def cancel_train_job(
    run_id: str,
    manager: Annotated[JobManager, Depends(get_job_manager)],
) -> RunSummary:
    return await manager.cancel(run_id)


@router.get("/train/jobs/{run_id}/metrics", response_model=MetricEventListResponse)
async def get_train_job_metrics(
    run_id: str,
    manager: Annotated[JobManager, Depends(get_job_manager)],
    after_step: int = 0,
    kind: str | None = None,
) -> MetricEventListResponse:
    metrics = await manager.get_metrics(run_id, after_step=after_step, kind=kind)
    return MetricEventListResponse(metrics=metrics)


@router.get("/train/jobs/{run_id}/logs", response_model=LogsResponse)
async def get_train_job_logs(
    run_id: str,
    manager: Annotated[JobManager, Depends(get_job_manager)],
    tail: int = 200,
) -> LogsResponse:
    lines = await manager.get_logs(run_id, tail=tail)
    return LogsResponse(lines=lines)


@router.get("/train/jobs/{run_id}/config.yaml")
async def get_train_job_config_yaml(
    run_id: str,
    manager: Annotated[JobManager, Depends(get_job_manager)],
) -> Response:
    run = await manager.get_run(run_id)  # NotFoundError -> 404, as GET /train/jobs/{run_id}
    return Response(
        content=render_config_yaml(run),
        media_type="application/x-yaml",
        headers={"Content-Disposition": f'attachment; filename="{run_id}-config.yaml"'},
    )


@router.post("/train/configs/import", response_model=TrainingConfig)
async def import_train_config(file: UploadFile = File(...)) -> TrainingConfig:
    # Read one byte past the cap so an oversize upload is detected without
    # buffering an arbitrarily large body.
    raw = await file.read(MAX_CONFIG_IMPORT_BYTES + 1)
    if len(raw) > MAX_CONFIG_IMPORT_BYTES:
        raise ValidationAppError(
            f"uploaded config file is too large (max {MAX_CONFIG_IMPORT_BYTES // 1024} KiB)"
        )
    return parse_config_yaml(raw)


async def _watch_for_disconnect(websocket: WebSocket) -> None:
    try:
        while True:
            await websocket.receive()
    except WebSocketDisconnect:
        return


class _BackfillBuffer:
    """Topic subscriber standing in for the raw websocket while the persisted
    metric backfill is being read and sent.

    Subscribing only AFTER reading the backfill loses any metric that is
    persisted-and-broadcast in between; subscribing BEFORE means live frames
    can overlap the backfill. So the socket subscribes this buffer first:
    frames broadcast during the backfill window are queued, then `drain`
    forwards them — dropping metric frames the backfill already covered —
    and switches to direct passthrough for all later broadcasts.
    """

    def __init__(self, websocket: WebSocket) -> None:
        self._websocket = websocket
        self._queue: list[dict] = []
        self._live = False

    async def send_json(self, message: dict) -> None:
        if self._live:
            await self._websocket.send_json(message)
        else:
            self._queue.append(message)

    async def drain(self, sent_metric_keys: set[tuple[str, int]], last_step: int) -> None:
        while self._queue:
            message = self._queue.pop(0)
            if message.get("type") == "metric":
                data = message.get("data") or {}
                step = data.get("step")
                if (data.get("kind"), step) in sent_metric_keys:
                    continue  # already sent in the backfill
                if isinstance(step, int) and step <= last_step:
                    continue  # client already had it before reconnecting
            await self._websocket.send_json(message)
        # No awaits between the empty-queue check and going live, so no frame
        # can slip into the queue and be stranded.
        self._live = True


@router.websocket("/ws/train/{run_id}")
async def ws_train(
    websocket: WebSocket,
    run_id: str,
    manager: Annotated[JobManager, Depends(get_job_manager)],
) -> None:
    await websocket.accept()

    try:
        first_frame = await websocket.receive_json()
    except WebSocketDisconnect:
        return

    last_step = 0
    if isinstance(first_frame, dict):
        try:
            last_step = int(first_frame.get("last_step") or 0)
        except (TypeError, ValueError):
            last_step = 0

    ws_manager = get_ws_manager()
    topic = f"train/{run_id}"
    buffer = _BackfillBuffer(websocket)
    # Subscribe BEFORE reading run state + persisted metrics: a metric
    # persisted-and-broadcast between the two would otherwise never reach
    # this client. Overlap is de-duplicated in `drain`.
    await ws_manager.subscribe(topic, buffer)

    try:
        try:
            run = await manager.get_run(run_id)
        except NotFoundError:
            await websocket.close(code=1008, reason="run not found")
            return

        metrics = await manager.get_metrics(run_id, after_step=last_step)
        sent_metric_keys: set[tuple[str, int]] = set()
        for metric in metrics:
            await websocket.send_json({"type": "metric", "data": metric.model_dump()})
            sent_metric_keys.add((metric.kind, metric.step))

        await websocket.send_json(
            {"type": "status", "status": run.status.value, "error": run.error}
        )

        if run.status in TERMINAL_STATUSES:
            await websocket.close()
            return

        await buffer.drain(sent_metric_keys, last_step)

        disconnect_task = asyncio.create_task(_watch_for_disconnect(websocket))
        done_task = asyncio.create_task(manager.done_event(run_id).wait())
        try:
            await asyncio.wait(
                {disconnect_task, done_task}, return_when=asyncio.FIRST_COMPLETED
            )
        finally:
            for task in (disconnect_task, done_task):
                if not task.done():
                    task.cancel()
    finally:
        await ws_manager.unsubscribe(topic, buffer)

    try:
        await websocket.close()
    except RuntimeError:
        # Already closed by the client disconnecting.
        pass
