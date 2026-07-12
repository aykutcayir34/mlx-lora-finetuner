"""Unit tests for app.services.inference_service.

mlx / mlx_lm are never imported here — all mlx entry points are reached
through the module-level `_load_fn` / `_stream_generate_fn` / ... indirection
functions, which are monkeypatched with fakes.
"""

import asyncio
import threading
from types import SimpleNamespace

import pytest

from app.schemas.inference import GenerationParams
from app.services import inference_service as svc


def _fake_response(text: str, prompt_tokens: int = 5, generation_tokens: int = 1, generation_tps: float = 10.0):
    return SimpleNamespace(
        text=text,
        prompt_tokens=prompt_tokens,
        generation_tokens=generation_tokens,
        generation_tps=generation_tps,
    )


class TestLruCache:
    def test_eviction_on_key_change_calls_clear_and_reload(self, monkeypatch):
        load_calls: list[tuple[str, str | None]] = []
        clear_calls: list[bool] = []

        def fake_load(model_path, adapter_path):
            load_calls.append((model_path, adapter_path))
            return (f"model:{model_path}", f"tok:{model_path}")

        def fake_clear():
            clear_calls.append(True)

        monkeypatch.setattr(svc, "_load_fn", fake_load)
        monkeypatch.setattr(svc, "_clear_mlx_cache", fake_clear)

        service = svc.InferenceService()

        model1, tok1 = service._load_model_sync("model-a", None)
        assert load_calls == [("model-a", None)]
        assert clear_calls == []

        model2, tok2 = service._load_model_sync("model-b", None)
        assert load_calls == [("model-a", None), ("model-b", None)]
        assert clear_calls == [True]
        assert model2 != model1

    def test_same_key_does_not_reload(self, monkeypatch):
        load_calls: list[tuple[str, str | None]] = []

        def fake_load(model_path, adapter_path):
            load_calls.append((model_path, adapter_path))
            return (f"model:{model_path}", f"tok:{model_path}")

        monkeypatch.setattr(svc, "_load_fn", fake_load)
        monkeypatch.setattr(svc, "_clear_mlx_cache", lambda: None)

        service = svc.InferenceService()

        first = service._load_model_sync("model-a", "/adapter")
        second = service._load_model_sync("model-a", "/adapter")

        assert load_calls == [("model-a", "/adapter")]
        assert first == second


class TestStreamChat:
    @pytest.mark.asyncio
    async def test_streaming_yields_tokens_then_done_with_usage(self, monkeypatch):
        monkeypatch.setattr(svc, "_load_fn", lambda model_path, adapter_path: ("model", "tok"))
        monkeypatch.setattr(svc, "_make_sampler_fn", lambda temperature, top_p: "sampler")
        monkeypatch.setattr(svc, "_make_logits_processors_fn", lambda repetition_penalty: None)

        class FakeTokenizer:
            def apply_chat_template(self, messages, add_generation_prompt=True):
                assert add_generation_prompt is True
                return "PROMPT"

        def fake_load(model_path, adapter_path):
            return ("model", FakeTokenizer())

        monkeypatch.setattr(svc, "_load_fn", fake_load)

        responses = [
            _fake_response("Hel", prompt_tokens=3, generation_tokens=1, generation_tps=11.0),
            _fake_response("lo", prompt_tokens=3, generation_tokens=2, generation_tps=12.0),
            _fake_response("!", prompt_tokens=3, generation_tokens=3, generation_tps=13.0),
        ]

        def fake_stream_generate(model, tokenizer, prompt, **kwargs):
            assert prompt == "PROMPT"
            assert kwargs["max_tokens"] == 512
            for r in responses:
                yield r

        monkeypatch.setattr(svc, "_stream_generate_fn", fake_stream_generate)

        service = svc.InferenceService()
        cancel_event = threading.Event()

        out_frames = []
        async for frame in service.stream_chat(
            model_path="model-a",
            adapter_path=None,
            messages=[{"role": "user", "content": "hi"}],
            params=GenerationParams(),
            cancel_event=cancel_event,
        ):
            out_frames.append(frame)

        assert out_frames[:-1] == [
            {"type": "token", "text": "Hel"},
            {"type": "token", "text": "lo"},
            {"type": "token", "text": "!"},
        ]
        assert out_frames[-1] == {
            "type": "done",
            "usage": {"prompt_tokens": 3, "completion_tokens": 3, "tokens_per_sec": 13.0},
        }

    @pytest.mark.asyncio
    async def test_cancel_mid_stream_stops_and_yields_partial_done(self, monkeypatch):
        class FakeTokenizer:
            def apply_chat_template(self, messages, add_generation_prompt=True):
                return "PROMPT"

        monkeypatch.setattr(svc, "_load_fn", lambda model_path, adapter_path: ("model", FakeTokenizer()))
        monkeypatch.setattr(svc, "_make_sampler_fn", lambda temperature, top_p: "sampler")
        monkeypatch.setattr(svc, "_make_logits_processors_fn", lambda repetition_penalty: None)

        def fake_stream_generate(model, tokenizer, prompt, **kwargs):
            # An effectively unbounded stream — the service's own cancel_event
            # check (not the fake generator) is what stops iteration.
            i = 0
            while True:
                i += 1
                yield _fake_response(f"tok{i}", prompt_tokens=7, generation_tokens=i, generation_tps=5.0)

        monkeypatch.setattr(svc, "_stream_generate_fn", fake_stream_generate)

        service = svc.InferenceService()
        cancel_event = threading.Event()

        out_frames = []

        async def _consume():
            async for frame in service.stream_chat(
                model_path="model-a",
                adapter_path=None,
                messages=[{"role": "user", "content": "hi"}],
                params=GenerationParams(),
                cancel_event=cancel_event,
            ):
                out_frames.append(frame)
                if frame["type"] == "token" and len(out_frames) >= 3:
                    cancel_event.set()

        await asyncio.wait_for(_consume(), timeout=5)

        assert out_frames[-1]["type"] == "done"
        token_frames = [f for f in out_frames if f["type"] == "token"]
        # Cancellation cuts the (otherwise infinite) stream short.
        assert 0 < len(token_frames) < 1000
        usage = out_frames[-1]["usage"]
        assert usage["prompt_tokens"] == 7
        assert usage["completion_tokens"] >= 1
