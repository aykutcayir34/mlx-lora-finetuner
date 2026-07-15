"""Unit tests for app.services.arena_service.ArenaService.

Exercises the sequential side-a/side-b orchestration against a fake
InferenceService (no mlx involved) and a fake RunsRepo, per docs/api.md
"Arena": frame ORDER, per-side model_not_found continuing to the other
side, training_active ending the turn, and cancel mid-side-a skipping b.
"""

from types import SimpleNamespace

import pytest

from app.schemas.arena import ArenaGenerateFrame, ArenaSideSpec
from app.schemas.inference import ChatMessage, GenerationParams
from app.services.arena_service import ArenaService


class FakeRunsRepo:
    def __init__(self, active: list[dict] | None = None) -> None:
        self._active = active or []

    async def list_active(self) -> list[dict]:
        return self._active


class FakeInferenceService:
    """Maps model_path -> list of token texts to stream, then a done usage."""

    def __init__(self, tokens_by_path: dict[str, list[str]]) -> None:
        self._tokens_by_path = tokens_by_path
        self.calls: list[str] = []

    async def stream_chat(self, *, model_path, adapter_path, messages, params, cancel_event):
        self.calls.append(model_path)
        tokens = self._tokens_by_path.get(model_path, [])
        for text in tokens:
            if cancel_event.is_set():
                break
            yield {"type": "token", "text": text}
        usage = {"prompt_tokens": 1, "completion_tokens": len(tokens), "tokens_per_sec": 1.0}
        yield {"type": "done", "usage": usage}


def _frame(model_a: str = "org/model-a", model_b: str = "org/model-b") -> ArenaGenerateFrame:
    return ArenaGenerateFrame(
        type="generate",
        side_a=ArenaSideSpec(model_id=model_a),
        side_b=ArenaSideSpec(model_id=model_b),
        messages=[ChatMessage(role="user", content="hi")],
        params=GenerationParams(),
    )


@pytest.mark.asyncio
async def test_happy_path_frame_order(tmp_path):
    (tmp_path / "org__model-a").mkdir()
    (tmp_path / "org__model-b").mkdir()
    settings = SimpleNamespace(models_dir=tmp_path)
    fake = FakeInferenceService(
        {
            str(tmp_path / "org__model-a"): ["Hi", "!"],
            str(tmp_path / "org__model-b"): ["Yo"],
        }
    )
    service = ArenaService(fake)

    frames = [
        f
        async for f in service.run_turn(
            settings=settings,
            frame=_frame(),
            runs_repo=FakeRunsRepo(),
            register_cancel=lambda cb: None,
        )
    ]

    assert [f["type"] for f in frames] == [
        "side_start",
        "token",
        "token",
        "side_done",
        "side_start",
        "token",
        "side_done",
        "done",
    ]
    assert frames[0]["side"] == "a"
    assert frames[3]["side"] == "a"
    assert frames[3]["usage"] == {"prompt_tokens": 1, "completion_tokens": 2, "tokens_per_sec": 1.0}
    assert frames[4]["side"] == "b"
    assert frames[6]["side"] == "b"
    assert fake.calls == [str(tmp_path / "org__model-a"), str(tmp_path / "org__model-b")]


@pytest.mark.asyncio
async def test_side_a_model_not_found_continues_to_side_b(tmp_path):
    (tmp_path / "org__model-b").mkdir()
    settings = SimpleNamespace(models_dir=tmp_path)
    fake = FakeInferenceService({str(tmp_path / "org__model-b"): ["ok"]})
    service = ArenaService(fake)

    frames = [
        f
        async for f in service.run_turn(
            settings=settings,
            frame=_frame(),
            runs_repo=FakeRunsRepo(),
            register_cancel=lambda cb: None,
        )
    ]

    assert frames[0] == {
        "type": "error",
        "side": "a",
        "code": "model_not_found",
        "message": "model 'org/model-a' not found",
    }
    assert frames[1] == {"type": "side_start", "side": "b"}
    assert frames[-1] == {"type": "done"}
    assert fake.calls == [str(tmp_path / "org__model-b")]


@pytest.mark.asyncio
async def test_training_active_ends_turn_before_side_a(tmp_path):
    settings = SimpleNamespace(models_dir=tmp_path)
    fake = FakeInferenceService({})
    service = ArenaService(fake)

    frames = [
        f
        async for f in service.run_turn(
            settings=settings,
            frame=_frame(),
            runs_repo=FakeRunsRepo(active=[{"run_id": "run_1"}]),
            register_cancel=lambda cb: None,
        )
    ]

    assert frames == [
        {
            "type": "error",
            "side": None,
            "code": "training_active",
            "message": "a training run is active",
        },
        {"type": "done"},
    ]
    assert fake.calls == []


@pytest.mark.asyncio
async def test_cancel_mid_side_a_skips_side_b(tmp_path):
    (tmp_path / "org__model-a").mkdir()
    (tmp_path / "org__model-b").mkdir()
    settings = SimpleNamespace(models_dir=tmp_path)
    fake = FakeInferenceService(
        {
            str(tmp_path / "org__model-a"): ["t1", "t2", "t3"],
            str(tmp_path / "org__model-b"): ["should-not-appear"],
        }
    )
    service = ArenaService(fake)

    registered_callbacks: list = []
    frames = []
    async for f in service.run_turn(
        settings=settings,
        frame=_frame(),
        runs_repo=FakeRunsRepo(),
        register_cancel=lambda cb: registered_callbacks.append(cb),
    ):
        frames.append(f)
        if f["type"] == "token" and f["side"] == "a":
            registered_callbacks[-1]()

    assert [f["type"] for f in frames] == ["side_start", "token", "side_done", "done"]
    assert fake.calls == [str(tmp_path / "org__model-a")]


class ExplodingInferenceService:
    """Raises an internal exception (with sensitive detail) mid-generation."""

    def __init__(self, secret: str) -> None:
        self._secret = secret

    async def stream_chat(self, *, model_path, adapter_path, messages, params, cancel_event):
        raise RuntimeError(self._secret)
        yield  # pragma: no cover — makes this an async generator


@pytest.mark.asyncio
async def test_unexpected_side_error_is_generic(tmp_path):
    (tmp_path / "org__model-a").mkdir()
    (tmp_path / "org__model-b").mkdir()
    settings = SimpleNamespace(models_dir=tmp_path)
    secret = "mlx blew up at /Users/someone/.cache/private-path"
    service = ArenaService(ExplodingInferenceService(secret))

    frames = [
        f
        async for f in service.run_turn(
            settings=settings,
            frame=_frame(),
            runs_repo=FakeRunsRepo(),
            register_cancel=lambda cb: None,
        )
    ]

    errors = [f for f in frames if f["type"] == "error"]
    assert [e["side"] for e in errors] == ["a", "b"]
    for error in errors:
        assert error["code"] == "internal"
        assert error["message"] == "internal error"
        assert secret not in error["message"]
    assert frames[-1] == {"type": "done"}
