"""Integration tests for the /adapters REST endpoint and /ws/chat WebSocket.

mlx / mlx_lm are never imported for real here (CI may run without mlx
installed) — the `app.services.inference_service` module-level indirection
functions are monkeypatched with fakes for every WS test.

WS tests use `starlette.testclient.TestClient` (sync, supports
`websocket_connect`) with a freshly-built `create_app()` instance rather
than the async `app` conftest fixture, to avoid running the lifespan
context twice. The REST test uses the conftest `client`/`data_dir`
fixtures as usual.
"""

import sqlite3
import threading
import time
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from starlette.testclient import TestClient

from app.api.inference import _model_dir_name
from app.config import get_settings
from app.main import create_app
from app.services import inference_service as svc

MODEL_ID = "mlx-community/SmolLM-135M-Instruct-4bit"


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _insert_run(
    db_path,
    run_id: str,
    status: str,
    model_id: str = MODEL_ID,
    adapter_path: str | None = None,
    name: str = "run",
) -> None:
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            """
            INSERT INTO runs (
                run_id, name, status, config_json, model_id, dataset_id,
                train_mode, created_at, adapter_path
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (run_id, name, status, "{}", model_id, "ds_1", "sft", _utcnow_iso(), adapter_path),
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
        text=text,
        prompt_tokens=prompt_tokens,
        generation_tokens=generation_tokens,
        generation_tps=generation_tps,
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


def _generate_frame(model_id: str = MODEL_ID, adapter_path: str | None = None) -> dict:
    return {
        "type": "generate",
        "model_id": model_id,
        "adapter_path": adapter_path,
        "messages": [{"role": "user", "content": "hi"}],
    }


def test_training_active_then_success(data_dir, patched_mlx):
    settings = get_settings()

    with TestClient(create_app()) as client:
        db_path = settings.db_path
        _insert_run(db_path, "run_1", status="running")

        model_dir = settings.models_dir / _model_dir_name(MODEL_ID)
        model_dir.mkdir(parents=True, exist_ok=True)

        def fake_stream_generate(model, tokenizer, prompt, **kwargs):
            yield _fake_response("hi")

        patched_mlx.setattr(svc, "_stream_generate_fn", fake_stream_generate)

        with client.websocket_connect("/api/v1/ws/chat") as ws:
            ws.send_json(_generate_frame())
            msg = ws.receive_json()
            assert msg["type"] == "error"
            assert msg["code"] == "training_active"

            # socket must stay open — mark the run completed and retry.
            _update_run_status(db_path, "run_1", "completed")
            ws.send_json(_generate_frame())

            frames = []
            while True:
                m = ws.receive_json()
                frames.append(m)
                if m["type"] == "done":
                    break

            assert frames[0] == {"type": "token", "text": "hi"}
            assert frames[-1]["type"] == "done"
            assert frames[-1]["usage"] == {
                "prompt_tokens": 4,
                "completion_tokens": 1,
                "tokens_per_sec": 9.0,
            }


def test_model_not_found(data_dir, patched_mlx):
    with TestClient(create_app()) as client:
        with client.websocket_connect("/api/v1/ws/chat") as ws:
            ws.send_json(_generate_frame(model_id="mlx-community/does-not-exist"))
            msg = ws.receive_json()
            assert msg["type"] == "error"
            assert msg["code"] == "model_not_found"


def test_missing_adapter_path(data_dir, patched_mlx):
    settings = get_settings()
    with TestClient(create_app()) as client:
        model_dir = settings.models_dir / _model_dir_name(MODEL_ID)
        model_dir.mkdir(parents=True, exist_ok=True)

        with client.websocket_connect("/api/v1/ws/chat") as ws:
            ws.send_json(_generate_frame(adapter_path=str(settings.data_dir / "no-such-adapter")))
            msg = ws.receive_json()
            assert msg["type"] == "error"
            assert msg["code"] == "model_not_found"


def test_concurrent_generate_rejected(data_dir, patched_mlx):
    settings = get_settings()
    with TestClient(create_app()) as client:
        model_dir = settings.models_dir / _model_dir_name(MODEL_ID)
        model_dir.mkdir(parents=True, exist_ok=True)

        gate = threading.Event()

        def fake_stream_generate(model, tokenizer, prompt, **kwargs):
            yield _fake_response("first")
            gate.wait(timeout=5)
            yield _fake_response("second")

        patched_mlx.setattr(svc, "_stream_generate_fn", fake_stream_generate)

        with client.websocket_connect("/api/v1/ws/chat") as ws:
            ws.send_json(_generate_frame())
            first = ws.receive_json()
            assert first == {"type": "token", "text": "first"}

            ws.send_json(_generate_frame())
            rejection = ws.receive_json()
            assert rejection["type"] == "error"
            assert rejection["code"] == "internal"

            gate.set()

            frames = []
            while True:
                m = ws.receive_json()
                frames.append(m)
                if m["type"] == "done":
                    break

            assert {"type": "token", "text": "second"} in frames
            assert frames[-1]["type"] == "done"


def test_cancel_stops_stream(data_dir, patched_mlx):
    settings = get_settings()
    with TestClient(create_app()) as client:
        model_dir = settings.models_dir / _model_dir_name(MODEL_ID)
        model_dir.mkdir(parents=True, exist_ok=True)

        gate = threading.Event()

        def fake_stream_generate(model, tokenizer, prompt, **kwargs):
            yield _fake_response("t1")
            gate.wait(timeout=5)
            yield _fake_response("t2")

        patched_mlx.setattr(svc, "_stream_generate_fn", fake_stream_generate)

        with client.websocket_connect("/api/v1/ws/chat") as ws:
            ws.send_json(_generate_frame())
            first = ws.receive_json()
            assert first == {"type": "token", "text": "t1"}

            ws.send_json({"type": "cancel"})
            time.sleep(0.2)  # let the server-side cancel_event.set() land first
            gate.set()

            done = ws.receive_json()
            assert done["type"] == "done"


@pytest.mark.asyncio
async def test_list_adapters(data_dir, client):
    settings = get_settings()
    db_path = settings.db_path

    existing_adapter = settings.data_dir / "adapters" / "good"
    existing_adapter.mkdir(parents=True, exist_ok=True)
    missing_adapter = str(settings.data_dir / "adapters" / "missing")

    _insert_run(
        db_path, "run_ok", status="completed", adapter_path=str(existing_adapter), name="good-run"
    )
    _insert_run(db_path, "run_null", status="completed", adapter_path=None, name="null-run")
    _insert_run(
        db_path, "run_missing", status="completed", adapter_path=missing_adapter, name="missing-run"
    )

    response = await client.get("/api/v1/adapters")
    assert response.status_code == 200

    body = response.json()
    assert len(body["adapters"]) == 1
    entry = body["adapters"][0]
    assert entry["adapter_path"] == str(existing_adapter)
    assert entry["run_id"] == "run_ok"
    assert entry["name"] == "good-run"
    assert entry["base_model_id"] == MODEL_ID
    assert "created_at" in entry
