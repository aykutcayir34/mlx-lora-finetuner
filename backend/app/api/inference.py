# TODO(Wave-1 T3): chat inference (mlx_lm generate loop) ve adapter listeleme.

from fastapi import APIRouter, Depends, WebSocket
from pydantic import BaseModel

from app.core.errors import AppError
from app.deps import get_current_user
from app.schemas.inference import AdapterInfo

router = APIRouter(dependencies=[Depends(get_current_user)])


class AdaptersListResponse(BaseModel):
    adapters: list[AdapterInfo]


@router.get("/adapters", response_model=AdaptersListResponse)
def list_adapters() -> AdaptersListResponse:
    raise AppError(message="adapter listeleme henüz uygulanmadı", code="not_implemented", status_code=501)


@router.websocket("/ws/chat")
async def ws_chat(websocket: WebSocket) -> None:
    await websocket.accept()
    await websocket.close(code=1011, reason="not implemented — Wave-1 chat inference WS akışı")
