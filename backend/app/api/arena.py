# Faz-2 T17 replaces this stub with the side-by-side arena WS (docs/api.md "Arena").

from fastapi import APIRouter, Depends, WebSocket

from app.deps import get_current_user

router = APIRouter(dependencies=[Depends(get_current_user)])


@router.websocket("/ws/arena")
async def arena_ws(websocket: WebSocket) -> None:
    await websocket.accept()
    await websocket.close(code=1011, reason="not implemented (Faz 2)")
