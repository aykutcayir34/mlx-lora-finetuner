# TODO(Wave-1 T4): fuse/gguf/ollama export pipeline.

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.errors import AppError
from app.deps import get_current_user
from app.schemas.export import (
    ExportArtifact,
    ExportJobInfo,
    FuseRequest,
    GGUFRequest,
    OllamaModelfileRequest,
    PreflightReport,
)

router = APIRouter(dependencies=[Depends(get_current_user)])


class ExportArtifactsListResponse(BaseModel):
    artifacts: list[ExportArtifact]


@router.post("/export/fuse", response_model=ExportJobInfo)
def export_fuse(body: FuseRequest) -> ExportJobInfo:
    raise AppError(message="model fuse etme henüz uygulanmadı", code="not_implemented", status_code=501)


@router.get("/export/gguf/preflight", response_model=PreflightReport)
def export_gguf_preflight(model_path: str) -> PreflightReport:
    raise AppError(message="GGUF preflight kontrolü henüz uygulanmadı", code="not_implemented", status_code=501)


@router.post("/export/gguf", response_model=ExportJobInfo)
def export_gguf(body: GGUFRequest) -> ExportJobInfo:
    raise AppError(message="GGUF export henüz uygulanmadı", code="not_implemented", status_code=501)


@router.post("/export/ollama-modelfile", response_model=ExportArtifact)
def export_ollama_modelfile(body: OllamaModelfileRequest) -> ExportArtifact:
    raise AppError(message="Ollama modelfile export henüz uygulanmadı", code="not_implemented", status_code=501)


@router.get("/export/jobs/{export_id}", response_model=ExportJobInfo)
def get_export_job(export_id: str) -> ExportJobInfo:
    raise AppError(message="export job detayı henüz uygulanmadı", code="not_implemented", status_code=501)


@router.get("/export/artifacts", response_model=ExportArtifactsListResponse)
def list_export_artifacts() -> ExportArtifactsListResponse:
    raise AppError(message="export artifact listeleme henüz uygulanmadı", code="not_implemented", status_code=501)
