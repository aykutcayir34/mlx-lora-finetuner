# Faz-2 T17: side-by-side model arena WS (docs/api.md "Arena" section).

import asyncio
import logging
from collections.abc import Callable
from typing import Annotated

import aiosqlite
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from app.config import Settings
from app.db.repositories import RunsRepo
from app.deps import get_current_user, get_db, get_settings
from app.schemas.arena import ArenaGenerateFrame
from app.services.arena_service import ArenaService
from app.services.inference_service import get_inference_service

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(get_current_user)])


@router.websocket("/ws/arena")
async def ws_arena(
    websocket: WebSocket,
    settings: Annotated[Settings, Depends(get_settings)],
    conn: Annotated[aiosqlite.Connection, Depends(get_db)],
) -> None:
    await websocket.accept()

    generating = False
    cancel_callback: Callable[[], None] | None = None
    gen_task: asyncio.Task | None = None
    runs_repo = RunsRepo(conn)
    arena_service = ArenaService(get_inference_service())

    def _register_cancel(callback: Callable[[], None] | None) -> None:
        nonlocal cancel_callback
        cancel_callback = callback

    async def _run_turn(frame: ArenaGenerateFrame) -> None:
        nonlocal generating
        try:
            async for out_frame in arena_service.run_turn(
                settings=settings,
                frame=frame,
                runs_repo=runs_repo,
                register_cancel=_register_cancel,
            ):
                await websocket.send_json(out_frame)
        except Exception:  # noqa: BLE001 - reported to the client as a generic error frame
            # Log the real exception server-side; never leak its text
            # (filesystem paths etc.) to the client.
            logger.exception("unexpected error during arena turn")
            try:
                await websocket.send_json(
                    {"type": "error", "side": None, "code": "internal", "message": "internal error"}
                )
            except Exception:
                pass
        finally:
            generating = False
            _register_cancel(None)

    try:
        while True:
            raw = await websocket.receive_json()
            frame_type = raw.get("type")

            if frame_type == "generate":
                if generating:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "side": None,
                            "code": "internal",
                            "message": "generation in progress",
                        }
                    )
                    continue

                try:
                    frame = ArenaGenerateFrame.model_validate(raw)
                except ValidationError as exc:
                    await websocket.send_json(
                        {"type": "error", "side": None, "code": "internal", "message": str(exc)}
                    )
                    continue

                generating = True
                gen_task = asyncio.create_task(_run_turn(frame))
            elif frame_type == "cancel":
                if cancel_callback is not None:
                    cancel_callback()
            else:
                await websocket.send_json(
                    {
                        "type": "error",
                        "side": None,
                        "code": "internal",
                        "message": f"bilinmeyen frame tipi: {frame_type!r}",
                    }
                )
    except WebSocketDisconnect:
        if cancel_callback is not None:
            cancel_callback()
        if gen_task is not None and not gen_task.done():
            gen_task.cancel()
