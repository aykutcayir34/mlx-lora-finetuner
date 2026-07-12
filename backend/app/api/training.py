# TODO(Wave-1 T1): training orchestration (subprocess spawn, WS streaming, cancel).

from fastapi import APIRouter, Depends, WebSocket
from pydantic import BaseModel

from app.core.errors import AppError
from app.deps import get_current_user
from app.schemas.training import MetricEvent, RunSummary, TrainingConfig

router = APIRouter(dependencies=[Depends(get_current_user)])


class RunSummaryListResponse(BaseModel):
    runs: list[RunSummary]


class MetricEventListResponse(BaseModel):
    metrics: list[MetricEvent]


class LogsResponse(BaseModel):
    lines: list[str]


@router.post("/train/jobs", response_model=RunSummary)
def create_train_job(body: TrainingConfig) -> RunSummary:
    raise AppError(message="training job oluşturma henüz uygulanmadı", code="not_implemented", status_code=501)


@router.get("/train/jobs", response_model=RunSummaryListResponse)
def list_train_jobs(
    status: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> RunSummaryListResponse:
    raise AppError(message="training job listeleme henüz uygulanmadı", code="not_implemented", status_code=501)


@router.get("/train/jobs/{run_id}", response_model=RunSummary)
def get_train_job(run_id: str) -> RunSummary:
    raise AppError(message="training job detayı henüz uygulanmadı", code="not_implemented", status_code=501)


@router.post("/train/jobs/{run_id}/cancel", response_model=RunSummary)
def cancel_train_job(run_id: str) -> RunSummary:
    raise AppError(message="training job iptali henüz uygulanmadı", code="not_implemented", status_code=501)


@router.get("/train/jobs/{run_id}/metrics", response_model=MetricEventListResponse)
def get_train_job_metrics(
    run_id: str,
    after_step: int = 0,
    kind: str | None = None,
) -> MetricEventListResponse:
    raise AppError(message="training job metrikleri henüz uygulanmadı", code="not_implemented", status_code=501)


@router.get("/train/jobs/{run_id}/logs", response_model=LogsResponse)
def get_train_job_logs(run_id: str, tail: int = 200) -> LogsResponse:
    raise AppError(message="training job logları henüz uygulanmadı", code="not_implemented", status_code=501)


@router.websocket("/ws/train/{run_id}")
async def ws_train(websocket: WebSocket, run_id: str) -> None:
    await websocket.accept()
    await websocket.close(code=1011, reason="not implemented — Wave-1 training WS akışı")
