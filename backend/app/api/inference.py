# Wave-1 T4: chat inference (mlx_lm generate loop) ve adapter listeleme.

import asyncio
import threading
from pathlib import Path
from typing import Annotated

import aiosqlite
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, ValidationError

from app.config import Settings
from app.db.repositories import RunsRepo
from app.deps import get_current_user, get_db, get_settings
from app.schemas.inference import AdapterInfo, ChatGenerateFrame
from app.services.inference_service import get_inference_service

router = APIRouter(dependencies=[Depends(get_current_user)])


class AdaptersListResponse(BaseModel):
    adapters: list[AdapterInfo]


def _model_dir_name(model_id: str) -> str:
    return model_id.replace("/", "__", 1)


@router.get("/adapters", response_model=AdaptersListResponse)
async def list_adapters(
    conn: Annotated[aiosqlite.Connection, Depends(get_db)],
) -> AdaptersListResponse:
    runs, _total = await RunsRepo(conn).list_(status="completed")
    adapters: list[AdapterInfo] = []
    for run in runs:
        adapter_path = run["adapter_path"]
        if not adapter_path:
            continue
        if not Path(adapter_path).exists():
            continue
        adapters.append(
            AdapterInfo(
                adapter_path=adapter_path,
                run_id=run["run_id"],
                name=run["name"],
                base_model_id=run["model_id"],
                created_at=run["created_at"],
            )
        )
    return AdaptersListResponse(adapters=adapters)


@router.websocket("/ws/chat")
async def ws_chat(
    websocket: WebSocket,
    settings: Annotated[Settings, Depends(get_settings)],
    conn: Annotated[aiosqlite.Connection, Depends(get_db)],
) -> None:
    await websocket.accept()

    generating = False
    cancel_event: threading.Event | None = None
    gen_task: asyncio.Task | None = None
    runs_repo = RunsRepo(conn)
    service = get_inference_service()

    async def _run_generation(frame: ChatGenerateFrame, cancel_event: threading.Event) -> None:
        nonlocal generating
        try:
            model_dir = settings.models_dir / _model_dir_name(frame.model_id)
            if not model_dir.exists():
                await websocket.send_json(
                    {
                        "type": "error",
                        "code": "model_not_found",
                        "message": f"model '{frame.model_id}' not found",
                    }
                )
                return

            if frame.adapter_path is not None and not Path(frame.adapter_path).exists():
                await websocket.send_json(
                    {
                        "type": "error",
                        "code": "model_not_found",
                        "message": f"adapter path '{frame.adapter_path}' not found",
                    }
                )
                return

            active_runs = await runs_repo.list_active()
            if active_runs:
                await websocket.send_json(
                    {
                        "type": "error",
                        "code": "training_active",
                        "message": "a training run is active",
                    }
                )
                return

            async for out_frame in service.stream_chat(
                model_path=str(model_dir),
                adapter_path=frame.adapter_path,
                messages=[m.model_dump() for m in frame.messages],
                params=frame.params,
                cancel_event=cancel_event,
            ):
                await websocket.send_json(out_frame)
        except Exception as exc:  # noqa: BLE001 - forwarded to client as an error frame
            try:
                await websocket.send_json(
                    {"type": "error", "code": "internal", "message": str(exc)}
                )
            except Exception:
                pass
        finally:
            generating = False

    try:
        while True:
            raw = await websocket.receive_json()
            frame_type = raw.get("type")

            if frame_type == "generate":
                if generating:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "code": "internal",
                            "message": "generation in progress",
                        }
                    )
                    continue

                try:
                    frame = ChatGenerateFrame.model_validate(raw)
                except ValidationError as exc:
                    await websocket.send_json(
                        {"type": "error", "code": "internal", "message": str(exc)}
                    )
                    continue

                generating = True
                cancel_event = threading.Event()
                gen_task = asyncio.create_task(_run_generation(frame, cancel_event))
            elif frame_type == "cancel":
                if cancel_event is not None:
                    cancel_event.set()
            else:
                await websocket.send_json(
                    {
                        "type": "error",
                        "code": "internal",
                        "message": f"bilinmeyen frame tipi: {frame_type!r}",
                    }
                )
    except WebSocketDisconnect:
        if cancel_event is not None:
            cancel_event.set()
        if gen_task is not None and not gen_task.done():
            gen_task.cancel()
