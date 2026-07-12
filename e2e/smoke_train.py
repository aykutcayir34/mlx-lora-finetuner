"""End-to-end smoke test against the real MLX runtime (Wave-3 T13).

Drives the actual FastAPI app in-process (starlette TestClient, lifespan on)
through the full studio flow: download model -> upload/split dataset ->
train (SFT/LoRA) while streaming metrics over WS -> chat with the trained
adapter over WS -> fuse (de-quantized) -> optionally GGUF-convert.

No mocks, no stubs — this is the real mlx-lm-lora training/inference path.

Usage:
    cd backend
    MLXLF_E2E_DATA_DIR=/path/to/reusable/data/dir uv run python ../e2e/smoke_train.py

Env vars:
    MLXLF_E2E_DATA_DIR  Reuse an existing MLXLF data dir (keeps a previously
                         downloaded model, skipping the ~1 min download).
                         If unset, a temp dir is created and removed on exit.
    MLXLF_E2E_GGUF=1     Also run the GGUF preflight + conversion step
                         (requires llama.cpp's convert script to be usable;
                         skipped by default).

Exit code 0 on success, 1 on any failed assertion.
"""

from __future__ import annotations

import json
import math
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

MODEL_ID = "mlx-community/SmolLM-135M-Instruct-4bit"
API = "/api/v1"
FIXTURE_PATH = Path(__file__).parent / "fixtures" / "tiny_sft.jsonl"

_created_tmp_dir: str | None = None
if not os.environ.get("MLXLF_DATA_DIR"):
    data_dir_env = os.environ.get("MLXLF_E2E_DATA_DIR")
    if data_dir_env:
        Path(data_dir_env).mkdir(parents=True, exist_ok=True)
        os.environ["MLXLF_DATA_DIR"] = data_dir_env
    else:
        _created_tmp_dir = tempfile.mkdtemp(prefix="mlxlf-e2e-")
        os.environ["MLXLF_DATA_DIR"] = _created_tmp_dir

from starlette.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


def log_step(msg: str) -> None:
    print(f"\n=== {msg} ===")


def ok(msg: str) -> None:
    print(f"  ✅ {msg}")


class SmokeFailure(AssertionError):
    pass


def ensure_model(client: TestClient) -> None:
    log_step("STEP 1: model")
    models = client.get(f"{API}/models").json()["models"]
    if any(m["model_id"] == MODEL_ID for m in models):
        ok(f"model already present: {MODEL_ID}")
        return

    r = client.post(f"{API}/models/download", json={"model_id": MODEL_ID})
    if r.status_code != 202:
        raise SmokeFailure(f"POST /models/download failed: {r.status_code} {r.text}")

    deadline = time.time() + 600
    dl = None
    while time.time() < deadline:
        dls = client.get(f"{API}/models/downloads").json()["downloads"]
        dl = next((d for d in dls if d["model_id"] == MODEL_ID), None)
        if dl is None:
            time.sleep(3)
            continue
        if dl["status"] == "completed":
            break
        if dl["status"] == "failed":
            raise SmokeFailure(f"model download failed: {dl}")
        time.sleep(3)
    else:
        raise SmokeFailure("model download timed out after 600s")
    ok(f"model downloaded: {MODEL_ID}")


def upload_and_split_dataset(client: TestClient) -> str:
    log_step("STEP 2: dataset upload + split")
    with open(FIXTURE_PATH, "rb") as fh:
        r = client.post(
            f"{API}/datasets/upload",
            files={"file": ("tiny_sft.jsonl", fh, "application/jsonl")},
            data={"name": "e2e-tiny-sft"},
        )
    if r.status_code != 201:
        raise SmokeFailure(f"dataset upload failed: {r.status_code} {r.text}")
    ds = r.json()
    ds_id = ds["dataset_id"]
    if ds["format"] != "chat":
        raise SmokeFailure(f"expected format=chat, got {ds['format']}")
    if ds["row_count"] != 24:
        raise SmokeFailure(f"expected 24 rows, got {ds['row_count']}")
    ok(f"dataset uploaded: {ds_id} (format={ds['format']}, rows={ds['row_count']})")

    r = client.post(
        f"{API}/datasets/{ds_id}/split",
        json={"train": 0.75, "valid": 0.125, "test": 0.125, "seed": 42, "shuffle": True},
    )
    if r.status_code != 200:
        raise SmokeFailure(f"dataset split failed: {r.status_code} {r.text}")
    splits = r.json()["splits"]
    ok(f"dataset split: {splits}")
    return ds_id


def start_training(client: TestClient, dataset_id: str) -> str:
    log_step("STEP 3: start training job")
    r = client.post(
        f"{API}/train/jobs",
        json={
            "name": "e2e-smoke",
            "model_id": MODEL_ID,
            "dataset_id": dataset_id,
            "train_mode": "sft",
            "train_type": "lora",
            "batch_size": 1,
            "iters": 20,
            "learning_rate": 1e-5,
            "max_seq_length": 512,
            "num_layers": 4,
            "lora": {"rank": 4, "scale": 20.0, "dropout": 0.0},
            "steps_per_report": 2,
            "steps_per_eval": 10,
            "save_every": 10,
            "val_batches": 1,
            "seed": 42,
        },
    )
    if r.status_code != 201:
        raise SmokeFailure(f"POST /train/jobs failed: {r.status_code} {r.text}")
    run_id = r.json()["run_id"]
    ok(f"training job started: {run_id}")
    return run_id


def stream_training_ws(client: TestClient, run_id: str) -> list[dict]:
    log_step("STEP 4: stream WS /ws/train/{run_id} until terminal status")
    frames: list[dict] = []
    with client.websocket_connect(f"{API}/ws/train/{run_id}") as ws:
        ws.send_json({"last_step": 0})
        deadline = time.time() + 600
        while time.time() < deadline:
            frame = ws.receive_json()
            frames.append(frame)
            if frame["type"] == "status" and frame["status"] in (
                "completed",
                "failed",
                "cancelled",
            ):
                break
        else:
            raise SmokeFailure("WS /ws/train did not reach a terminal status within 600s")

    metric_frames = [f for f in frames if f["type"] == "metric"]
    train_metrics = [f for f in metric_frames if f["data"]["kind"] == "train"]
    val_metrics = [f for f in metric_frames if f["data"]["kind"] == "val"]
    final_status = frames[-1]

    if len(metric_frames) < 8:
        raise SmokeFailure(f"expected >=8 metric frames, got {len(metric_frames)}")
    for f in metric_frames:
        loss = f["data"]["loss"]
        if loss is None or not math.isfinite(loss):
            raise SmokeFailure(f"non-finite loss in metric frame: {f}")
    if len(val_metrics) < 1:
        raise SmokeFailure(f"expected >=1 val metric frame, got {len(val_metrics)}")
    if final_status["status"] != "completed":
        raise SmokeFailure(f"expected final status 'completed', got: {final_status}")

    ok(
        f"WS training stream OK: {len(metric_frames)} metric frames "
        f"({len(train_metrics)} train / {len(val_metrics)} val), final status=completed"
    )
    return frames


def cross_check_metrics(client: TestClient, run_id: str, ws_metric_count: int) -> None:
    log_step("STEP 5: cross-check persisted metrics via GET")
    r = client.get(f"{API}/train/jobs/{run_id}/metrics")
    if r.status_code != 200:
        raise SmokeFailure(f"GET metrics failed: {r.status_code} {r.text}")
    persisted = r.json()["metrics"]
    if len(persisted) < 8:
        raise SmokeFailure(f"expected >=8 persisted metrics, got {len(persisted)}")
    ok(f"persisted metrics: {len(persisted)} (WS delivered {ws_metric_count})")


def check_run_and_adapter(client: TestClient, run_id: str) -> str:
    log_step("STEP 6: adapter on disk + /adapters listing")
    run = client.get(f"{API}/train/jobs/{run_id}").json()
    adapter_path = run["adapter_path"]
    if not adapter_path:
        raise SmokeFailure(f"run has no adapter_path: {run}")
    adapters_dir = Path(adapter_path)
    if not adapters_dir.exists():
        raise SmokeFailure(f"adapter_path does not exist on disk: {adapter_path}")
    safetensors = adapters_dir / "adapters.safetensors"
    if not safetensors.exists():
        raise SmokeFailure(f"adapters.safetensors missing in {adapter_path}")
    ok(f"adapter on disk: {adapter_path} (final_train_loss={run['final_train_loss']}, "
       f"final_val_loss={run['final_val_loss']})")

    r = client.get(f"{API}/adapters")
    if r.status_code != 200:
        raise SmokeFailure(f"GET /adapters failed: {r.status_code} {r.text}")
    adapters = r.json()["adapters"]
    if not any(a["adapter_path"] == adapter_path and a["run_id"] == run_id for a in adapters):
        raise SmokeFailure(f"adapter not listed in GET /adapters: {adapters}")
    ok(f"adapter listed in GET /adapters ({len(adapters)} total)")
    return adapter_path


def chat_with_adapter(client: TestClient, adapter_path: str) -> None:
    log_step("STEP 7: chat WITH adapter over WS /ws/chat")
    frames = []
    with client.websocket_connect(f"{API}/ws/chat") as ws:
        ws.send_json(
            {
                "type": "generate",
                "model_id": MODEL_ID,
                "adapter_path": adapter_path,
                "messages": [{"role": "user", "content": "What is the capital of France?"}],
                "params": {"max_tokens": 24, "temperature": 0.1, "top_p": 0.9},
            }
        )
        deadline = time.time() + 120
        while time.time() < deadline:
            frame = ws.receive_json()
            frames.append(frame)
            if frame["type"] in ("done", "error"):
                break
        else:
            raise SmokeFailure("WS /ws/chat did not terminate within 120s")

    tokens = [f["text"] for f in frames if f["type"] == "token"]
    final = frames[-1]
    if final["type"] != "done":
        raise SmokeFailure(f"chat did not finish with 'done': {frames[-3:]}")
    if len(tokens) < 1:
        raise SmokeFailure("chat produced 0 token frames")
    if "usage" not in final or final["usage"] is None:
        raise SmokeFailure(f"'done' frame missing usage: {final}")
    ok(f"adapter chat OK: {len(tokens)} tokens, usage={final['usage']}")
    print("  reply:", "".join(tokens)[:120])


def fuse_adapter(client: TestClient, run_id: str) -> Path:
    log_step("STEP 8: fuse (de_quantize=true)")
    r = client.post(
        f"{API}/export/fuse",
        json={"run_id": run_id, "de_quantize": True, "output_name": "e2e-fused"},
    )
    if r.status_code != 202:
        raise SmokeFailure(f"POST /export/fuse failed: {r.status_code} {r.text}")
    export_id = r.json()["export_id"]

    deadline = time.time() + 300
    job = None
    while time.time() < deadline:
        job = client.get(f"{API}/export/jobs/{export_id}").json()
        if job["status"] == "completed":
            break
        if job["status"] == "failed":
            raise SmokeFailure(f"fuse job failed: {job}")
        time.sleep(2)
    else:
        raise SmokeFailure(f"fuse job did not complete within 300s: {job}")

    output_path = Path(job["output_path"])
    if not output_path.exists():
        raise SmokeFailure(f"fused output_path does not exist: {output_path}")
    config_path = output_path / "config.json"
    if not config_path.exists():
        raise SmokeFailure(f"fused dir missing config.json: {output_path}")
    safetensor_files = list(output_path.glob("*.safetensors"))
    if not safetensor_files:
        raise SmokeFailure(f"fused dir has no *.safetensors files: {output_path}")
    config = json.loads(config_path.read_text())
    if "quantization" in config:
        raise SmokeFailure(
            f"fused config.json still has 'quantization' key (not HF-convertible): {config_path}"
        )
    ok(
        f"fused model OK: {output_path} "
        f"(config.json present, {len(safetensor_files)} safetensors file(s), no 'quantization' key)"
    )
    return output_path


def gguf_convert(client: TestClient, fused_path: Path) -> None:
    log_step("STEP 9: GGUF preflight + convert (MLXLF_E2E_GGUF=1)")
    r = client.get(f"{API}/export/gguf/preflight", params={"model_path": str(fused_path)})
    if r.status_code != 200:
        raise SmokeFailure(f"GGUF preflight request failed: {r.status_code} {r.text}")
    report = r.json()
    print("  preflight:", json.dumps(report, indent=2))
    if not report["ok"]:
        raise SmokeFailure(f"GGUF preflight not ok: {report}")

    r = client.post(
        f"{API}/export/gguf",
        json={"model_path": str(fused_path), "outtype": "f16", "output_name": "e2e-gguf"},
    )
    if r.status_code != 202:
        raise SmokeFailure(f"POST /export/gguf failed: {r.status_code} {r.text}")
    export_id = r.json()["export_id"]

    deadline = time.time() + 300
    job = None
    while time.time() < deadline:
        job = client.get(f"{API}/export/jobs/{export_id}").json()
        if job["status"] == "completed":
            break
        if job["status"] == "failed":
            raise SmokeFailure(f"gguf job failed: {job}")
        time.sleep(2)
    else:
        raise SmokeFailure(f"gguf job did not complete within 300s: {job}")

    output_path = Path(job["output_path"])
    gguf_files = list(output_path.glob("*.gguf")) if output_path.is_dir() else (
        [output_path] if output_path.suffix == ".gguf" else []
    )
    if not gguf_files:
        raise SmokeFailure(f"no .gguf file found at {output_path}")
    ok(f"GGUF conversion OK: {gguf_files[0]}")


def main() -> int:
    start = time.time()
    print(f"MLXLF_DATA_DIR = {os.environ['MLXLF_DATA_DIR']}")
    try:
        with TestClient(app) as client:
            ensure_model(client)
            dataset_id = upload_and_split_dataset(client)
            run_id = start_training(client, dataset_id)
            ws_frames = stream_training_ws(client, run_id)
            ws_metric_count = len([f for f in ws_frames if f["type"] == "metric"])
            cross_check_metrics(client, run_id, ws_metric_count)
            adapter_path = check_run_and_adapter(client, run_id)
            chat_with_adapter(client, adapter_path)
            fused_path = fuse_adapter(client, run_id)
            if os.environ.get("MLXLF_E2E_GGUF") == "1":
                gguf_convert(client, fused_path)
            else:
                log_step("STEP 9: GGUF conversion SKIPPED (set MLXLF_E2E_GGUF=1 to enable)")
    except SmokeFailure as exc:
        print(f"\n❌ E2E SMOKE TEST FAILED: {exc}")
        return 1
    finally:
        if _created_tmp_dir is not None:
            shutil.rmtree(_created_tmp_dir, ignore_errors=True)

    elapsed = time.time() - start
    print(f"\n✅ E2E SMOKE TEST PASSED in {elapsed:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
