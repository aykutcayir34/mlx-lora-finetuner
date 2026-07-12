"""Arena orchestration: sequential two-side chat generation for the Model Arena.

Reuses `InferenceService.stream_chat` for the actual mlx_lm generate loop
(single-thread MLX executor, LRU(1) model cache, cancel_event) — this module
holds no mlx-specific logic of its own. Sides are generated strictly
sequentially (side "a" fully streams, then side "b") because the inference
service's cache evicts the previous model when a new one is requested and
there is only one Metal GPU to share.
"""

from __future__ import annotations

import threading
from collections.abc import AsyncIterator, Callable
from pathlib import Path

from app.config import Settings
from app.db.repositories import RunsRepo
from app.schemas.arena import ArenaGenerateFrame
from app.services.inference_service import InferenceService


def _model_dir_name(model_id: str) -> str:
    return model_id.replace("/", "__", 1)


class ArenaService:
    def __init__(self, inference_service: InferenceService) -> None:
        self._inference_service = inference_service

    async def run_turn(
        self,
        *,
        settings: Settings,
        frame: ArenaGenerateFrame,
        runs_repo: RunsRepo,
        register_cancel: Callable[[Callable[[], None] | None], None],
    ) -> AsyncIterator[dict]:
        """Runs one arena turn (both sides, sequentially) and yields wire frames.

        `register_cancel` is called once with a zero-arg callback the caller's
        WS receive loop should invoke when a `{"type": "cancel"}` frame
        arrives (and again with `None` once the turn ends, to unregister).
        The callback sets a turn-level "cancelled" flag, distinct from the
        per-side `threading.Event` handed to `InferenceService.stream_chat` —
        that event is unconditionally set in `stream_chat`'s own `finally`
        block once a side finishes normally, so it cannot be reused to detect
        an actual user-initiated cancel.
        """
        active_runs = await runs_repo.list_active()
        if active_runs:
            yield {
                "type": "error",
                "side": None,
                "code": "training_active",
                "message": "a training run is active",
            }
            yield {"type": "done"}
            return

        messages = [m.model_dump() for m in frame.messages]

        turn_cancelled = threading.Event()
        current_worker_event: threading.Event | None = None

        def _cancel() -> None:
            turn_cancelled.set()
            if current_worker_event is not None:
                current_worker_event.set()

        register_cancel(_cancel)
        try:
            for side, spec in (("a", frame.side_a), ("b", frame.side_b)):
                worker_event = threading.Event()
                current_worker_event = worker_event

                model_dir = settings.models_dir / _model_dir_name(spec.model_id)
                if not model_dir.exists():
                    yield {
                        "type": "error",
                        "side": side,
                        "code": "model_not_found",
                        "message": f"model '{spec.model_id}' not found",
                    }
                    continue
                if spec.adapter_path is not None and not Path(spec.adapter_path).exists():
                    yield {
                        "type": "error",
                        "side": side,
                        "code": "model_not_found",
                        "message": f"adapter path '{spec.adapter_path}' not found",
                    }
                    continue

                yield {"type": "side_start", "side": side}
                try:
                    async for out in self._inference_service.stream_chat(
                        model_path=str(model_dir),
                        adapter_path=spec.adapter_path,
                        messages=messages,
                        params=frame.params,
                        cancel_event=worker_event,
                    ):
                        if out["type"] == "token":
                            yield {"type": "token", "side": side, "text": out["text"]}
                        elif out["type"] == "done":
                            yield {"type": "side_done", "side": side, "usage": out["usage"]}
                except Exception as exc:  # noqa: BLE001 - forwarded as a per-side error frame
                    yield {"type": "error", "side": side, "code": "internal", "message": str(exc)}

                if turn_cancelled.is_set():
                    break
        finally:
            register_cancel(None)

        yield {"type": "done"}
