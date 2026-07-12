"""Model registry API: local scan, HF Hub search, download lifecycle, deletion.

Wave-1 T2. Business logic lives in `app.services.model_registry.ModelRegistry`;
this module only wires HTTP/WS routes to it.
"""

from typing import Annotated

import aiosqlite
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from app.config import Settings
from app.deps import get_current_user, get_db, get_settings
from app.schemas.models import DownloadInfo, DownloadRequest, HFSearchResult, ModelInfo
from app.services.model_registry import ModelRegistry, get_model_registry

router = APIRouter(dependencies=[Depends(get_current_user)])


class ModelsListResponse(BaseModel):
    models: list[ModelInfo]


class HFSearchResponse(BaseModel):
    results: list[HFSearchResult]


class DownloadsListResponse(BaseModel):
    downloads: list[DownloadInfo]


def _registry(settings: Annotated[Settings, Depends(get_settings)]) -> ModelRegistry:
    return get_model_registry(settings)


@router.get("/models", response_model=ModelsListResponse)
async def list_models(
    registry: Annotated[ModelRegistry, Depends(_registry)],
) -> ModelsListResponse:
    return ModelsListResponse(models=await registry.list_local_models())


@router.get("/models/search", response_model=HFSearchResponse)
async def search_models(
    registry: Annotated[ModelRegistry, Depends(_registry)],
    q: str | None = None,
    author: str | None = None,
    limit: int = 20,
) -> HFSearchResponse:
    results = await registry.search_models(q=q, author=author, limit=limit)
    return HFSearchResponse(results=results)


@router.post("/models/download", response_model=DownloadInfo, status_code=202)
async def download_model(
    body: DownloadRequest,
    registry: Annotated[ModelRegistry, Depends(_registry)],
    conn: Annotated[aiosqlite.Connection, Depends(get_db)],
) -> DownloadInfo:
    return await registry.start_download(body.model_id, conn)


@router.get("/models/downloads", response_model=DownloadsListResponse)
async def list_downloads(
    registry: Annotated[ModelRegistry, Depends(_registry)],
    conn: Annotated[aiosqlite.Connection, Depends(get_db)],
) -> DownloadsListResponse:
    return DownloadsListResponse(downloads=await registry.list_downloads(conn))


@router.post(
    "/models/downloads/{download_id}/cancel", response_model=DownloadInfo, status_code=202
)
async def cancel_download(
    download_id: str,
    registry: Annotated[ModelRegistry, Depends(_registry)],
    conn: Annotated[aiosqlite.Connection, Depends(get_db)],
) -> DownloadInfo:
    return await registry.cancel_download(download_id, conn)


@router.delete("/models/{model_id:path}", status_code=204)
async def delete_model(
    model_id: str,
    registry: Annotated[ModelRegistry, Depends(_registry)],
    conn: Annotated[aiosqlite.Connection, Depends(get_db)],
) -> None:
    await registry.delete_model(model_id, conn)


@router.websocket("/ws/downloads/{download_id}")
async def ws_downloads(
    websocket: WebSocket,
    download_id: str,
    settings: Annotated[Settings, Depends(get_settings)],
) -> None:
    await websocket.accept()
    registry = get_model_registry(settings)
    conn = await aiosqlite.connect(settings.db_path)
    try:
        queue = await registry.subscribe(download_id, conn)
    finally:
        await conn.close()

    try:
        while True:
            frame = await queue.get()
            if frame is None:
                break
            try:
                await websocket.send_json(frame)
            except WebSocketDisconnect:
                break
            if frame.get("type") in ("done", "error", "cancelled"):
                break
    finally:
        registry.unsubscribe(download_id, queue)
        try:
            await websocket.close()
        except RuntimeError:
            pass
