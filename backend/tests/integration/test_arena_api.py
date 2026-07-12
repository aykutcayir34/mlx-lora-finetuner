"""Integration tests for the /ws/arena WebSocket (docs/api.md "Arena" section).

Mirrors tests/integration/test_inference_api.py's approach: mlx / mlx_lm are
never imported for real — the `app.services.inference_service` module-level
indirection functions are monkeypatched with fakes, and WS tests use
`starlette.testclient.TestClient` against a freshly-built `create_app()`.
"""

import sqlite3
import threading
import time
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from starlette.testclient import TestClient

from app.config import get_settings
from app.main import create_app
from app.services import inference_service as svc
from app.services.arena_service import _model_dir_name

MODEL_A = "mlx-community/SmolLM-135M-Instruct-4bit"
MODEL_B = "mlx-community/Qwen2.5-0.5B-Instruct-4bit"


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _insert_run(db_path, run_id: str, status: str, model_id: str = MODEL_A, name: str = "run") -> None:
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            """
            INSERT INTO runs (
                run_id, name, status, config_json, model_id, dataset_id,
                train_mode, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (run_id, name, status, "{}", model_id, "ds_1", "sft", _utcnow_iso()),
        )
        conn.commit()
    finally:
        conn.close()


def _update_run_status(db_path, run_id: str, status: str) -> None:
    conn = sqlite3.connect(db_path)
    try:
        conn.execute("UPDATE runs SET status = ? WHERE run_id = ?", (status, run_id))
        conn.commit()
    finally:
        conn.close()


def _fake_response(text: str, prompt_tokens: int = 4, generation_tokens: int = 1, generation_tps: float = 9.0):
    return SimpleNamespace(
        text=text, prompt_tokens=prompt_tokens, generation_tokens=generation_tokens, generation_tps=generation_tps
    )


class FakeTokenizer:
    def apply_chat_template(self, messages, add_generation_prompt=True):
        return "PROMPT"


@pytest.fixture(autouse=True)
def _reset_service():
    svc.reset_inference_service()
    yield
    svc.reset_inference_service()


@pytest.fixture
def patched_mlx(monkeypatch):
    monkeypatch.setattr(svc, "_load_fn", lambda model_path, adapter_path: ("model", FakeTokenizer()))
    monkeypatch.setattr(svc, "_make_sampler_fn", lambda temperature, top_p: "sampler")
    monkeypatch.setattr(svc, "_make_logits_processors_fn", lambda repetition_penalty: None)
    monkeypatch.setattr(svc, "_clear_mlx_cache", lambda: None)
    return monkeypatch


def _generate_frame(model_a: str = MODEL_A, model_b: str = MODEL_B) -> dict:
    return {
        "type": "generate",
        "side_a": {"model_id": model_a, "adapter_path": None},
        "side_b": {"model_id": model_b, "adapter_path": None},
        "messages": [{"role": "user", "content": "hi"}],
    }


def _drain_until_done(ws) -> list[dict]:
    frames = []
    while True:
        m = ws.receive_json()
        frames.append(m)
        if m["type"] == "done":
            break
    return frames


def _mkdirs(settings, *model_ids: str) -> None:
    for model_id in model_ids:
        (settings.models_dir / _model_dir_name(model_id)).mkdir(parents=True, exist_ok=True)


def test_happy_path_frame_order(data_dir, patched_mlx):
    settings = get_settings()
    _mkdirs(settings, MODEL_A, MODEL_B)

    def fake_stream_generate(model, tokenizer, prompt, **kwargs):
        yield _fake_response("hi")

    patched_mlx.setattr(svc, "_stream_generate_fn", fake_stream_generate)

    with TestClient(create_app()) as client, client.websocket_connect("/api/v1/ws/arena") as ws:
        ws.send_json(_generate_frame())
        frames = _drain_until_done(ws)

    assert [(f["type"], f.get("side")) for f in frames] == [
        ("side_start", "a"),
        ("token", "a"),
        ("side_done", "a"),
        ("side_start", "b"),
        ("token", "b"),
        ("side_done", "b"),
        ("done", None),
    ]
    assert frames[2]["usage"] == {"prompt_tokens": 4, "completion_tokens": 1, "tokens_per_sec": 9.0}


def test_side_a_model_not_found_continues_to_side_b(data_dir, patched_mlx):
    settings = get_settings()
    _mkdirs(settings, MODEL_B)

    def fake_stream_generate(model, tokenizer, prompt, **kwargs):
        yield _fake_response("hi")

    patched_mlx.setattr(svc, "_stream_generate_fn", fake_stream_generate)

    with TestClient(create_app()) as client, client.websocket_connect("/api/v1/ws/arena") as ws:
        ws.send_json(_generate_frame())
        frames = _drain_until_done(ws)

    assert frames[0]["type"] == "error"
    assert frames[0]["side"] == "a"
    assert frames[0]["code"] == "model_not_found"
    assert frames[1] == {"type": "side_start", "side": "b"}
    assert frames[-1] == {"type": "done"}


def test_training_active_ends_turn_socket_stays_open(data_dir, patched_mlx):
    settings = get_settings()
    db_path = settings.db_path
    _mkdirs(settings, MODEL_A, MODEL_B)

    def fake_stream_generate(model, tokenizer, prompt, **kwargs):
        yield _fake_response("hi")

    patched_mlx.setattr(svc, "_stream_generate_fn", fake_stream_generate)

    with TestClient(create_app()) as client, client.websocket_connect("/api/v1/ws/arena") as ws:
        # the `runs` table only exists once the app's lifespan has run, i.e.
        # after entering the TestClient context.
        _insert_run(db_path, "run_1", status="running")
        ws.send_json(_generate_frame())
        msg = ws.receive_json()
        assert msg == {
            "type": "error",
            "side": None,
            "code": "training_active",
            "message": "a training run is active",
        }
        done = ws.receive_json()
        assert done == {"type": "done"}

        # socket must stay open — mark the run completed and retry.
        _update_run_status(db_path, "run_1", "completed")
        ws.send_json(_generate_frame())
        frames = _drain_until_done(ws)
        assert frames[0] == {"type": "side_start", "side": "a"}


def test_cancel_mid_side_a_skips_side_b(data_dir, patched_mlx):
    settings = get_settings()
    _mkdirs(settings, MODEL_A, MODEL_B)

    gate = threading.Event()

    def fake_stream_generate(model, tokenizer, prompt, **kwargs):
        yield _fake_response("t1")
        gate.wait(timeout=5)
        yield _fake_response("t2")

    patched_mlx.setattr(svc, "_stream_generate_fn", fake_stream_generate)

    with TestClient(create_app()) as client, client.websocket_connect("/api/v1/ws/arena") as ws:
        ws.send_json(_generate_frame())
        assert ws.receive_json() == {"type": "side_start", "side": "a"}
        assert ws.receive_json() == {"type": "token", "side": "a", "text": "t1"}

        ws.send_json({"type": "cancel"})
        time.sleep(0.2)  # let the server-side cancel_event.set() land first
        gate.set()

        frames = _drain_until_done(ws)

    assert [f["type"] for f in frames] == ["side_done", "done"]
    assert all(f.get("side") != "b" for f in frames)


def test_concurrent_generate_rejected(data_dir, patched_mlx):
    settings = get_settings()
    _mkdirs(settings, MODEL_A, MODEL_B)

    gate = threading.Event()

    def fake_stream_generate(model, tokenizer, prompt, **kwargs):
        yield _fake_response("first")
        gate.wait(timeout=5)
        yield _fake_response("second")

    patched_mlx.setattr(svc, "_stream_generate_fn", fake_stream_generate)

    with TestClient(create_app()) as client, client.websocket_connect("/api/v1/ws/arena") as ws:
        ws.send_json(_generate_frame())
        assert ws.receive_json() == {"type": "side_start", "side": "a"}
        assert ws.receive_json() == {"type": "token", "side": "a", "text": "first"}

        ws.send_json(_generate_frame())
        rejection = ws.receive_json()
        assert rejection["type"] == "error"
        assert rejection["side"] is None
        assert rejection["code"] == "internal"

        gate.set()
        frames = _drain_until_done(ws)
        assert frames[-1] == {"type": "done"}


def test_bad_frame_handling(data_dir, patched_mlx):
    with TestClient(create_app()) as client, client.websocket_connect("/api/v1/ws/arena") as ws:
        ws.send_json({"type": "generate", "side_a": {"model_id": "x"}})
        msg = ws.receive_json()
        assert msg["type"] == "error"
        assert msg["side"] is None
        assert msg["code"] == "internal"

        ws.send_json({"type": "unknown"})
        msg2 = ws.receive_json()
        assert msg2["type"] == "error"
        assert msg2["side"] is None
