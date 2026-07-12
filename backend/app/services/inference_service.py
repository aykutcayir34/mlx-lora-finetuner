"""Chat inference business logic (mlx_lm generate loop + model/adapter cache).

No `mlx` / `mlx_lm` imports at module scope — CI runs on Linux without mlx
installed, so this module must stay importable regardless. All mlx entry
points are routed through the `_*_fn` indirection functions below so tests
can monkeypatch them without a real mlx installation.
"""

from __future__ import annotations

import asyncio
import contextlib
import threading
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from collections.abc import AsyncIterator
from typing import Any

from app.schemas.inference import GenerationParams


def _load_fn(model_path: str, adapter_path: str | None):
    import mlx_lm

    return mlx_lm.load(model_path, adapter_path=adapter_path)


def _stream_generate_fn(model, tokenizer, prompt, **kwargs):
    import mlx_lm

    return mlx_lm.stream_generate(model, tokenizer, prompt, **kwargs)


def _make_sampler_fn(temperature: float, top_p: float):
    from mlx_lm.sample_utils import make_sampler

    return make_sampler(temp=temperature, top_p=top_p)


def _make_logits_processors_fn(repetition_penalty: float | None):
    if repetition_penalty is None:
        return None
    from mlx_lm.sample_utils import make_logits_processors

    return make_logits_processors(repetition_penalty=repetition_penalty)


def _clear_mlx_cache() -> None:
    import mlx.core as mx

    mx.clear_cache()


class InferenceService:
    """Holds a size-1 LRU cache of loaded (model, tokenizer) pairs and runs
    the mlx_lm generate loop on a single dedicated worker thread.

    MLX arrays/streams are affinitized to the thread that materializes them:
    loading a model (especially with a LoRA adapter) on one thread and
    generating on another fails with "There is no Stream(cpu, 0) in current
    thread". A single-thread executor guarantees load and generate always
    share one thread, and serializes requests (one model on the GPU anyway).
    """

    def __init__(self) -> None:
        self._cache: OrderedDict[tuple[str, str | None], tuple[Any, Any]] = OrderedDict()
        self._cache_lock = threading.Lock()
        self._mlx_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="mlx-inference")

    def _load_model_sync(self, model_path: str, adapter_path: str | None) -> tuple[Any, Any]:
        key = (model_path, adapter_path)
        with self._cache_lock:
            if key in self._cache:
                self._cache.move_to_end(key)
                return self._cache[key]

            evicted = bool(self._cache)
            self._cache.clear()
            if evicted:
                _clear_mlx_cache()

            model, tokenizer = _load_fn(model_path, adapter_path)
            self._cache[key] = (model, tokenizer)
            return model, tokenizer

    async def get_model(self, model_path: str, adapter_path: str | None) -> tuple[Any, Any]:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            self._mlx_executor, self._load_model_sync, model_path, adapter_path
        )

    async def stream_chat(
        self,
        *,
        model_path: str,
        adapter_path: str | None,
        messages: list[dict],
        params: GenerationParams,
        cancel_event: threading.Event,
    ) -> AsyncIterator[dict]:
        model, tokenizer = await self.get_model(model_path, adapter_path)

        loop = asyncio.get_running_loop()
        queue: asyncio.Queue = asyncio.Queue()

        def _worker() -> None:
            try:
                prompt = tokenizer.apply_chat_template(messages, add_generation_prompt=True)
                sampler = _make_sampler_fn(params.temperature, params.top_p)
                logits_processors = _make_logits_processors_fn(params.repetition_penalty)

                last_response = None
                for response in _stream_generate_fn(
                    model,
                    tokenizer,
                    prompt,
                    max_tokens=params.max_tokens,
                    sampler=sampler,
                    logits_processors=logits_processors,
                ):
                    last_response = response
                    if cancel_event.is_set():
                        break
                    loop.call_soon_threadsafe(queue.put_nowait, ("token", response))
                loop.call_soon_threadsafe(queue.put_nowait, ("done", last_response))
            except Exception as exc:  # noqa: BLE001 - forwarded to the consumer coroutine
                loop.call_soon_threadsafe(queue.put_nowait, ("error", exc))

        # Same single-thread executor as get_model: MLX requires generation to
        # run on the thread that loaded the weights (see class docstring).
        future = self._mlx_executor.submit(_worker)
        try:
            while True:
                kind, payload = await queue.get()
                if kind == "token":
                    yield {"type": "token", "text": payload.text}
                elif kind == "done":
                    if payload is None:
                        usage = {"prompt_tokens": 0, "completion_tokens": 0, "tokens_per_sec": 0.0}
                    else:
                        usage = {
                            "prompt_tokens": payload.prompt_tokens,
                            "completion_tokens": payload.generation_tokens,
                            "tokens_per_sec": payload.generation_tps,
                        }
                    yield {"type": "done", "usage": usage}
                    return
                elif kind == "error":
                    raise payload
        finally:
            cancel_event.set()
            # _worker traps all exceptions, so this only waits for the token
            # loop to notice the cancel event; never raises.
            with contextlib.suppress(asyncio.TimeoutError):
                await asyncio.wait_for(asyncio.wrap_future(future), timeout=2)


_inference_service: InferenceService | None = None


def get_inference_service() -> InferenceService:
    global _inference_service
    if _inference_service is None:
        _inference_service = InferenceService()
    return _inference_service


def reset_inference_service() -> None:
    global _inference_service
    _inference_service = None
