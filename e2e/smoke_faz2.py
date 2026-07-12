"""End-to-end smoke test for the Faz-2 features against the real MLX runtime (T19).

Mirrors `e2e/smoke_train.py`'s patterns (plain script, step logging, real
FastAPI app in-process via starlette's `TestClient`, `MLXLF_E2E_DATA_DIR` for a
reusable data dir) but drives the Faz-2 surface instead of the Faz-1 SFT flow:

    1. DPO training (real mlx-lm-lora DPO run, not mocked).
    2. Data Recipes: CSV -> completions dataset, TXT -> text dataset.
    3. Run History: filter/sort/clone.
    4. Model Arena: sequential side-by-side WS generation.

If `MLXLF_E2E_DATA_DIR` already contains a completed `sft` run for
`MODEL_ID` (e.g. from a prior `make e2e` run against the same data dir), the
Arena step compares base-model vs that SFT adapter; otherwise it falls back
to base-vs-base so the step still exercises the full WS protocol.

Usage:
    cd backend
    MLXLF_E2E_DATA_DIR=/path/to/reusable/data/dir uv run python ../e2e/smoke_faz2.py

Exit code 0 on success, 1 on any failed assertion.
"""

from __future__ import annotations

import csv
import io
import math
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

MODEL_ID = "mlx-community/SmolLM-135M-Instruct-4bit"
API = "/api/v1"
DPO_FIXTURE_PATH = Path(__file__).parent / "fixtures" / "tiny_dpo.jsonl"

_created_tmp_dir: str | None = None
if not os.environ.get("MLXLF_DATA_DIR"):
    data_dir_env = os.environ.get("MLXLF_E2E_DATA_DIR")
    if data_dir_env:
        Path(data_dir_env).mkdir(parents=True, exist_ok=True)
        os.environ["MLXLF_DATA_DIR"] = data_dir_env
    else:
        _created_tmp_dir = tempfile.mkdtemp(prefix="mlxlf-e2e-faz2-")
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


# --------------------------------------------------------------------------
# STEP 2-4: DPO training
# --------------------------------------------------------------------------


def upload_and_split_dpo_dataset(client: TestClient) -> str:
    log_step("STEP 2: DPO dataset upload + split")
    with open(DPO_FIXTURE_PATH, "rb") as fh:
        r = client.post(
            f"{API}/datasets/upload",
            files={"file": ("tiny_dpo.jsonl", fh, "application/jsonl")},
            data={"name": "e2e-tiny-dpo"},
        )
    if r.status_code != 201:
        raise SmokeFailure(f"dpo dataset upload failed: {r.status_code} {r.text}")
    ds = r.json()
    ds_id = ds["dataset_id"]
    if ds["format"] != "dpo":
        raise SmokeFailure(f"expected format=dpo, got {ds['format']}")
    if ds["row_count"] != 16:
        raise SmokeFailure(f"expected 16 rows, got {ds['row_count']}")
    ok(f"dpo dataset uploaded: {ds_id} (format={ds['format']}, rows={ds['row_count']})")

    r = client.post(
        f"{API}/datasets/{ds_id}/split",
        json={"train": 0.75, "valid": 0.125, "test": 0.125, "seed": 42, "shuffle": True},
    )
    if r.status_code != 200:
        raise SmokeFailure(f"dpo dataset split failed: {r.status_code} {r.text}")
    splits = r.json()["splits"]
    ok(f"dpo dataset split: {splits}")
    return ds_id


def start_dpo_training(client: TestClient, dataset_id: str) -> str:
    log_step("STEP 3: start DPO training job")
    r = client.post(
        f"{API}/train/jobs",
        json={
            "name": "e2e-smoke-dpo",
            "model_id": MODEL_ID,
            "dataset_id": dataset_id,
            "train_mode": "dpo",
            "train_type": "lora",
            "batch_size": 1,
            "iters": 6,
            "max_seq_length": 512,
            "num_layers": 2,
            "lora": {"rank": 4, "scale": 20.0, "dropout": 0.0},
            "steps_per_report": 2,
            "val_batches": 1,
            "beta": 0.1,
            "seed": 42,
        },
    )
    if r.status_code != 201:
        raise SmokeFailure(f"POST /train/jobs (dpo) failed: {r.status_code} {r.text}")
    run_id = r.json()["run_id"]
    ok(f"dpo training job started: {run_id}")
    return run_id


def stream_dpo_training_ws(client: TestClient, run_id: str) -> None:
    log_step("STEP 4: stream WS /ws/train/{run_id} until terminal status (dpo)")
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
            raise SmokeFailure("WS /ws/train (dpo) did not reach a terminal status within 600s")

    metric_frames = [f for f in frames if f["type"] == "metric"]
    final_status = frames[-1]

    if len(metric_frames) < 1:
        raise SmokeFailure(f"expected >=1 metric frame, got {len(metric_frames)}")
    for f in metric_frames:
        loss = f["data"]["loss"]
        if loss is None or not math.isfinite(loss):
            raise SmokeFailure(f"non-finite loss in dpo metric frame: {f}")
    if final_status["status"] != "completed":
        raise SmokeFailure(f"expected final dpo status 'completed', got: {final_status}")

    ok(f"WS dpo training stream OK: {len(metric_frames)} metric frames, final status=completed")


def check_dpo_adapter(client: TestClient, run_id: str) -> None:
    log_step("STEP 5: dpo adapter on disk")
    run = client.get(f"{API}/train/jobs/{run_id}").json()
    adapter_path = run["adapter_path"]
    if not adapter_path:
        raise SmokeFailure(f"dpo run has no adapter_path: {run}")
    adapters_dir = Path(adapter_path)
    if not adapters_dir.exists():
        raise SmokeFailure(f"dpo adapter_path does not exist on disk: {adapter_path}")
    safetensors = adapters_dir / "adapters.safetensors"
    if not safetensors.exists():
        raise SmokeFailure(f"adapters.safetensors missing in {adapter_path}")
    ok(
        f"dpo adapter on disk: {adapter_path} (final_train_loss={run['final_train_loss']}, "
        f"final_val_loss={run['final_val_loss']})"
    )


# --------------------------------------------------------------------------
# STEP 6-7: Data Recipes
# --------------------------------------------------------------------------


def _poll_recipe_job(client: TestClient, recipe_job_id: str) -> dict:
    deadline = time.time() + 60
    job = None
    while time.time() < deadline:
        job = client.get(f"{API}/recipes/jobs/{recipe_job_id}").json()
        if job["status"] == "completed":
            return job
        if job["status"] == "failed":
            raise SmokeFailure(f"recipe job failed: {job}")
        time.sleep(1)
    raise SmokeFailure(f"recipe job did not complete within 60s: {job}")


def recipes_csv_to_completions(client: TestClient) -> None:
    log_step("STEP 6: recipes CSV -> completions")
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=["prompt", "completion"])
    writer.writeheader()
    rows = [
        ("What is the capital of France?", "Paris."),
        ("What is 2 plus 2?", "4."),
        ("Who wrote Romeo and Juliet?", "William Shakespeare."),
        ("What is the chemical symbol for water?", "H2O."),
        ("How many days are in a week?", "7."),
        ("What is the largest planet in our solar system?", "Jupiter."),
    ]
    for prompt, completion in rows:
        writer.writerow({"prompt": prompt, "completion": completion})
    csv_bytes = buf.getvalue().encode("utf-8")

    r = client.post(
        f"{API}/recipes/convert",
        files={"file": ("qa.csv", csv_bytes, "text/csv")},
        data={
            "name": "e2e-recipe-csv",
            "output_format": "completions",
            "prompt_column": "prompt",
            "completion_column": "completion",
        },
    )
    if r.status_code != 202:
        raise SmokeFailure(f"POST /recipes/convert (csv) failed: {r.status_code} {r.text}")
    recipe_job_id = r.json()["recipe_job_id"]

    job = _poll_recipe_job(client, recipe_job_id)
    if job["rows_emitted"] != len(rows):
        raise SmokeFailure(f"expected {len(rows)} rows emitted, got {job['rows_emitted']}")
    if not job["preview_rows"]:
        raise SmokeFailure(f"csv recipe job has no preview_rows: {job}")
    if job["dataset_id"] is None:
        raise SmokeFailure(f"csv recipe job has no dataset_id: {job}")

    datasets = client.get(f"{API}/datasets").json()["datasets"]
    ds = next((d for d in datasets if d["dataset_id"] == job["dataset_id"]), None)
    if ds is None:
        raise SmokeFailure(f"csv recipe dataset {job['dataset_id']} not found in GET /datasets")
    if ds["format"] != "completions":
        raise SmokeFailure(f"expected csv recipe dataset format=completions, got {ds['format']}")
    ok(
        f"csv recipe OK: dataset={ds['dataset_id']} format={ds['format']} "
        f"rows_emitted={job['rows_emitted']} preview_rows={len(job['preview_rows'])}"
    )


def recipes_txt_to_text(client: TestClient) -> None:
    log_step("STEP 7: recipes TXT -> text")
    paragraphs = [
        "MLX is an array framework for machine learning research on Apple silicon.",
        "LoRA (Low-Rank Adaptation) fine-tunes large language models by injecting "
        "small trainable rank-decomposition matrices into frozen weights.",
        "Data recipes turn raw documents into training-ready datasets without an "
        "LLM in the loop: extract, chunk, emit, and register.",
    ]
    text_bytes = "\n\n".join(paragraphs).encode("utf-8")

    r = client.post(
        f"{API}/recipes/convert",
        files={"file": ("notes.txt", text_bytes, "text/plain")},
        data={
            "name": "e2e-recipe-txt",
            "output_format": "text",
            "chunk_size": "2000",
            "chunk_overlap": "200",
        },
    )
    if r.status_code != 202:
        raise SmokeFailure(f"POST /recipes/convert (txt) failed: {r.status_code} {r.text}")
    recipe_job_id = r.json()["recipe_job_id"]

    job = _poll_recipe_job(client, recipe_job_id)
    if job["rows_emitted"] < 1:
        raise SmokeFailure(f"expected >=1 row emitted from txt recipe, got {job['rows_emitted']}")
    if not job["preview_rows"] or "text" not in job["preview_rows"][0]:
        raise SmokeFailure(f"txt recipe preview_rows missing 'text' key: {job['preview_rows']}")
    if job["dataset_id"] is None:
        raise SmokeFailure(f"txt recipe job has no dataset_id: {job}")

    datasets = client.get(f"{API}/datasets").json()["datasets"]
    ds = next((d for d in datasets if d["dataset_id"] == job["dataset_id"]), None)
    if ds is None:
        raise SmokeFailure(f"txt recipe dataset {job['dataset_id']} not found in GET /datasets")
    if ds["format"] != "text":
        raise SmokeFailure(f"expected txt recipe dataset format=text, got {ds['format']}")
    ok(
        f"txt recipe OK: dataset={ds['dataset_id']} format={ds['format']} "
        f"rows_emitted={job['rows_emitted']}"
    )


# --------------------------------------------------------------------------
# STEP 8: Run History
# --------------------------------------------------------------------------


def run_history_checks(client: TestClient, dpo_run_id: str) -> None:
    log_step("STEP 8: run history filter/sort/clone")

    r = client.get(f"{API}/runs/history", params={"train_mode": "dpo"})
    if r.status_code != 200:
        raise SmokeFailure(f"GET /runs/history?train_mode=dpo failed: {r.status_code} {r.text}")
    body = r.json()
    if not any(run["run_id"] == dpo_run_id for run in body["runs"]):
        raise SmokeFailure(
            f"dpo run {dpo_run_id} not present in /runs/history?train_mode=dpo: {body}"
        )
    ok(f"GET /runs/history?train_mode=dpo includes {dpo_run_id} ({body['total']} total)")

    r = client.get(f"{API}/runs/history", params={"sort": "-created_at"})
    if r.status_code != 200:
        raise SmokeFailure(f"GET /runs/history?sort=-created_at failed: {r.status_code} {r.text}")
    runs = r.json()["runs"]
    created_ats = [run["created_at"] for run in runs]
    if created_ats != sorted(created_ats, reverse=True):
        raise SmokeFailure(f"runs not sorted -created_at descending: {created_ats}")
    ok(f"GET /runs/history?sort=-created_at returned {len(runs)} runs in descending order")

    r = client.post(f"{API}/train/jobs/{dpo_run_id}/clone")
    if r.status_code != 200:
        raise SmokeFailure(f"POST /train/jobs/{dpo_run_id}/clone failed: {r.status_code} {r.text}")
    cloned_config = r.json()
    if cloned_config["train_mode"] != "dpo" or cloned_config["beta"] != 0.1:
        raise SmokeFailure(f"cloned config doesn't match original dpo config: {cloned_config}")
    ok(f"POST /train/jobs/{dpo_run_id}/clone returned matching TrainingConfig")


# --------------------------------------------------------------------------
# STEP 9: Model Arena
# --------------------------------------------------------------------------


def find_sft_adapter(client: TestClient, dpo_run_id: str) -> str | None:
    """Looks for a completed `sft`-mode adapter for `MODEL_ID` in GET /adapters,
    excluding the dpo run this script just trained. Returns None if none found
    (e.g. a cold `MLXLF_E2E_DATA_DIR` that never ran `make e2e`)."""
    adapters = client.get(f"{API}/adapters").json()["adapters"]
    candidates = [
        a
        for a in adapters
        if a["base_model_id"] == MODEL_ID and a["run_id"] not in (None, dpo_run_id)
    ]
    for candidate in sorted(candidates, key=lambda a: a["created_at"], reverse=True):
        run = client.get(f"{API}/train/jobs/{candidate['run_id']}").json()
        if run["config"]["train_mode"] == "sft":
            return candidate["adapter_path"]
    return None


def arena_smoke(client: TestClient, dpo_run_id: str) -> None:
    log_step("STEP 9: WS /ws/arena side-by-side generation")
    sft_adapter_path = find_sft_adapter(client, dpo_run_id)
    if sft_adapter_path is not None:
        ok(f"found warm SFT adapter for arena side B: {sft_adapter_path}")
    else:
        ok("no warm SFT adapter found (run `make e2e` first to exercise the adapter-vs-base "
           "path); arena side B falls back to the base model")

    frames: list[dict] = []
    with client.websocket_connect(f"{API}/ws/arena") as ws:
        ws.send_json(
            {
                "type": "generate",
                "side_a": {"model_id": MODEL_ID, "adapter_path": None},
                "side_b": {"model_id": MODEL_ID, "adapter_path": sft_adapter_path},
                "messages": [{"role": "user", "content": "What is the capital of France?"}],
                "params": {"max_tokens": 8, "temperature": 0.1, "top_p": 0.9},
            }
        )
        deadline = time.time() + 120
        while time.time() < deadline:
            frame = ws.receive_json()
            frames.append(frame)
            if frame["type"] == "done":
                break
        else:
            raise SmokeFailure("WS /ws/arena did not send a terminal 'done' frame within 120s")

    types_seen = [f["type"] for f in frames]
    if types_seen.count("error") and any(f.get("side") is None for f in frames if f["type"] == "error"):
        raise SmokeFailure(f"arena turn hit a turn-level error: {frames}")

    def _side_span(side: str) -> tuple[int, int]:
        starts = [i for i, f in enumerate(frames) if f["type"] == "side_start" and f["side"] == side]
        dones = [i for i, f in enumerate(frames) if f["type"] == "side_done" and f["side"] == side]
        if not starts or not dones:
            raise SmokeFailure(f"missing side_start/side_done for side {side!r}: {frames}")
        return starts[0], dones[0]

    a_start, a_done = _side_span("a")
    b_start, b_done = _side_span("b")

    if not (a_start < a_done <= b_start < b_done):
        raise SmokeFailure(
            f"arena frames not in expected sequential order "
            f"(a_start={a_start}, a_done={a_done}, b_start={b_start}, b_done={b_done}): "
            f"{types_seen}"
        )
    if types_seen[-1] != "done":
        raise SmokeFailure(f"arena turn did not end with 'done': {types_seen}")

    a_tokens = [f for f in frames[a_start:a_done] if f["type"] == "token" and f["side"] == "a"]
    if len(a_tokens) < 1:
        raise SmokeFailure(f"arena side a produced 0 token frames: {frames}")

    ok(
        f"arena frame order OK: side_start(a) -> ... -> side_done(a) -> "
        f"side_start(b) -> ... -> side_done(b) -> done "
        f"({len(a_tokens)} tokens on side a, {len(frames)} frames total)"
    )


def main() -> int:
    start = time.time()
    print(f"MLXLF_DATA_DIR = {os.environ['MLXLF_DATA_DIR']}")
    try:
        with TestClient(app) as client:
            ensure_model(client)
            dataset_id = upload_and_split_dpo_dataset(client)
            dpo_run_id = start_dpo_training(client, dataset_id)
            stream_dpo_training_ws(client, dpo_run_id)
            check_dpo_adapter(client, dpo_run_id)
            recipes_csv_to_completions(client)
            recipes_txt_to_text(client)
            run_history_checks(client, dpo_run_id)
            arena_smoke(client, dpo_run_id)
    except SmokeFailure as exc:
        print(f"\n❌ E2E FAZ-2 SMOKE TEST FAILED: {exc}")
        return 1
    finally:
        if _created_tmp_dir is not None:
            shutil.rmtree(_created_tmp_dir, ignore_errors=True)

    elapsed = time.time() - start
    print(f"\n✅ E2E FAZ-2 SMOKE TEST PASSED in {elapsed:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
