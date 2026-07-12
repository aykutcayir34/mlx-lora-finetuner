# TODO(Wave-1 T?): model indirme/arama/silme iş mantığı — HF Hub entegrasyonu.

from fastapi import APIRouter, Depends, WebSocket
from pydantic import BaseModel

from app.core.errors import AppError
from app.deps import get_current_user
from app.schemas.models import DownloadInfo, DownloadRequest, HFSearchResult, ModelInfo

router = APIRouter(dependencies=[Depends(get_current_user)])


class ModelsListResponse(BaseModel):
    models: list[ModelInfo]


class HFSearchResponse(BaseModel):
    results: list[HFSearchResult]


class DownloadsListResponse(BaseModel):
    downloads: list[DownloadInfo]


@router.get("/models", response_model=ModelsListResponse)
def list_models() -> ModelsListResponse:
    raise AppError(message="model listeleme henüz uygulanmadı", code="not_implemented", status_code=501)


@router.get("/models/search", response_model=HFSearchResponse)
def search_models(
    q: str | None = None,
    author: str | None = None,
    limit: int = 20,
) -> HFSearchResponse:
    raise AppError(message="HF Hub model arama henüz uygulanmadı", code="not_implemented", status_code=501)


@router.post("/models/download")
def download_model(body: DownloadRequest) -> DownloadInfo:
    raise AppError(message="model indirme henüz uygulanmadı", code="not_implemented", status_code=501)


@router.get("/models/downloads", response_model=DownloadsListResponse)
def list_downloads() -> DownloadsListResponse:
    raise AppError(message="indirme listesi henüz uygulanmadı", code="not_implemented", status_code=501)


@router.delete("/models/{model_id}")
def delete_model(model_id: str) -> None:
    raise AppError(message="model silme henüz uygulanmadı", code="not_implemented", status_code=501)


@router.websocket("/ws/downloads/{download_id}")
async def ws_downloads(websocket: WebSocket, download_id: str) -> None:
    await websocket.accept()
    await websocket.close(code=1011, reason="not implemented — Wave-1 model indirme WS akışı")
