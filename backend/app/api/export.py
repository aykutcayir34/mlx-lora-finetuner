from typing import Annotated, Literal

import aiosqlite
from fastapi import APIRouter, BackgroundTasks, Depends
from pydantic import BaseModel

from app.deps import get_current_user, get_db
from app.schemas.export import (
    ExportArtifact,
    ExportJobInfo,
    FuseRequest,
    GGUFRequest,
    OllamaModelfileRequest,
    PreflightReport,
)
from app.services.export_service import ExportService, get_export_service

router = APIRouter(dependencies=[Depends(get_current_user)])


class ExportStartResponse(BaseModel):
    export_id: str
    kind: Literal["fuse", "gguf"]


class ModelfileResponse(BaseModel):
    modelfile: str
    path: str


class ExportArtifactsListResponse(BaseModel):
    artifacts: list[ExportArtifact]


@router.post("/export/fuse", response_model=ExportStartResponse, status_code=202)
async def export_fuse(
    body: FuseRequest,
    background_tasks: BackgroundTasks,
    conn: Annotated[aiosqlite.Connection, Depends(get_db)],
    service: Annotated[ExportService, Depends(get_export_service)],
) -> dict:
    return await service.start_fuse(conn, body, background_tasks)


@router.get("/export/gguf/preflight", response_model=PreflightReport)
async def export_gguf_preflight(
    model_path: str,
    service: Annotated[ExportService, Depends(get_export_service)],
) -> PreflightReport:
    return await service.preflight_gguf(model_path)


@router.post("/export/gguf", response_model=ExportStartResponse, status_code=202)
async def export_gguf(
    body: GGUFRequest,
    background_tasks: BackgroundTasks,
    conn: Annotated[aiosqlite.Connection, Depends(get_db)],
    service: Annotated[ExportService, Depends(get_export_service)],
) -> dict:
    return await service.start_gguf(conn, body, background_tasks)


@router.post("/export/ollama-modelfile", response_model=ModelfileResponse)
async def export_ollama_modelfile(
    body: OllamaModelfileRequest,
    conn: Annotated[aiosqlite.Connection, Depends(get_db)],
    service: Annotated[ExportService, Depends(get_export_service)],
) -> dict:
    return await service.render_modelfile(conn, body)


@router.get("/export/jobs/{export_id}", response_model=ExportJobInfo)
async def get_export_job(
    export_id: str,
    conn: Annotated[aiosqlite.Connection, Depends(get_db)],
    service: Annotated[ExportService, Depends(get_export_service)],
) -> ExportJobInfo:
    return await service.get_job(conn, export_id)


@router.get("/export/artifacts", response_model=ExportArtifactsListResponse)
async def list_export_artifacts(
    conn: Annotated[aiosqlite.Connection, Depends(get_db)],
    service: Annotated[ExportService, Depends(get_export_service)],
) -> ExportArtifactsListResponse:
    artifacts = await service.list_artifacts(conn)
    return ExportArtifactsListResponse(artifacts=artifacts)
