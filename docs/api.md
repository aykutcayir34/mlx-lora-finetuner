# API Contract — mlx-lora-finetuner

**This document is the frozen frontend/backend contract.** All backend routers and
frontend query hooks / TypeScript types MUST conform to it. Changes require updating
this file first, in a dedicated commit.

- Base path: `/api/v1` (REST) and `/api/v1/ws/...` (WebSocket).
- All timestamps: ISO-8601 UTC strings.
- All IDs: opaque strings (`run_id`, `dataset_id`, `download_id`, `export_id`).
- Errors: every non-2xx response has the shape
  `{"error": {"code": "<machine_code>", "message": "<human message>", "detail": {}}}`.
  Common codes: `not_found`, `conflict`, `validation_error`, `training_active`, `internal`.
- Auth: none. Every router injects the no-op `get_current_user` dependency so auth can
  be added later without refactoring.

Model IDs are HF repo ids (e.g. `mlx-community/SmolLM-135M-Instruct-4bit`). On disk they
are stored under `models/<org>__<name>/`. In URL paths, model ids are URL-encoded.

---

## System

### GET /system/health
`200 {"status": "ok", "version": "<app>", "mlx_version": "...", "mlx_lm_lora_version": "..."}`

### GET /system/stats
```json
{
  "memory": {"total_gb": 32.0, "used_gb": 12.3},
  "disk": {"models_gb": 4.2, "datasets_gb": 0.1, "runs_gb": 0.3, "exports_gb": 1.0, "free_gb": 210.5},
  "active_run_id": "run_abc" | null,
  "data_dir": "/Users/x/.mlx-lora-finetuner"
}
```

---

## Models

### ModelInfo
```json
{
  "model_id": "mlx-community/SmolLM-135M-Instruct-4bit",
  "path": "/abs/path",
  "size_bytes": 123456789,
  "model_type": "llama",
  "quantization": {"bits": 4, "group_size": 64} | null,
  "downloaded_at": "2026-07-12T10:00:00Z"
}
```

### GET /models → `{"models": [ModelInfo]}`
### GET /models/search?q=&author=&limit=20
Proxy of HF Hub search. Default `author=mlx-community` applied only when `author` param is omitted AND `q` does not contain `/`.
```json
{"results": [{"model_id": "...", "downloads": 123, "likes": 4, "size_bytes": null, "downloaded": false}]}
```
### POST /models/download  `{"model_id": "..."}` → `202 {"download_id": "dl_...", "model_id": "..."}`
409 `conflict` if already downloading. Existing completed model → 409 `conflict`.
### GET /models/downloads
```json
{"downloads": [{"download_id": "dl_...", "model_id": "...", "status": "running|completed|failed",
  "bytes_done": 1, "bytes_total": 2, "files_done": 1, "files_total": 5, "error": null,
  "started_at": "...", "finished_at": null}]}
```
### DELETE /models/{model_id} → `204`. 409 `training_active` if used by the running job.

### WS /ws/downloads/{download_id}
Server frames (JSON): `{"type": "progress", "bytes_done": n, "bytes_total": n, "files_done": n, "files_total": n}`,
terminal `{"type": "done"}` or `{"type": "error", "message": "..."}`. No client frames. Socket closes after terminal frame.

---

## Datasets

Detected formats (enum `DatasetFormat`): `chat` (`{"messages": [...]}`), `completions`
(`{"prompt","completion"}`), `text` (`{"text"}`), `dpo` (`{"prompt","chosen","rejected"}`),
`orpo` (dpo + `"preference_score"`), `grpo` (`{"prompt","answer"}`, optional `"system"`).

### DatasetInfo
```json
{
  "dataset_id": "ds_...", "name": "my-data", "format": "chat",
  "path": "/abs/path", "row_count": 200,
  "splits": {"train": 160, "valid": 20, "test": 20} | null,
  "created_at": "..."
}
```

### GET /datasets → `{"datasets": [DatasetInfo]}`
### POST /datasets/upload — multipart: `file` (.jsonl), optional form field `name`.
→ `201 DatasetInfo` (format auto-detected from first parseable lines; 422 `validation_error` if no line parses or format unrecognizable).
### POST /datasets/{id}/validate
```json
{
  "dataset_id": "ds_...", "format": "chat", "valid_rows": 198, "total_rows": 200,
  "errors": [{"line": 7, "message": "missing 'messages' key"}],
  "warnings": [{"line": 12, "message": "empty assistant turn"}]
}
```
### POST /datasets/{id}/split  `{"train": 0.8, "valid": 0.1, "test": 0.1, "seed": 42, "shuffle": true}`
Ratios must sum to 1.0 (±0.001). Writes `train.jsonl`/`valid.jsonl`/`test.jsonl` into
`datasets/<id>/data/` (the exact directory passed to mlx-lm-lora as `--data`). → `200 DatasetInfo`.
### GET /datasets/{id}/preview?split=raw|train|valid|test&page=1&size=20
`{"rows": [<parsed json objects>], "page": 1, "size": 20, "total_rows": 200}`
### DELETE /datasets/{id} → `204`. 409 `training_active` if used by the running job.

---

## Training

### Enums
- `TrainMode`: `sft | dpo | orpo | cpo | grpo`  (Faz 1 sadece `sft`'yi UI'da açar; şema hepsini tanımlar)
- `TrainType`: `lora | dora | full`
- `JobStatus`: `queued | running | completed | failed | cancelled`

### TrainingConfig (request body of POST /train/jobs)
```json
{
  "name": "my-run",
  "model_id": "mlx-community/...", "dataset_id": "ds_...",
  "train_mode": "sft", "train_type": "lora",
  "batch_size": 1, "iters": 600, "learning_rate": 1e-5,
  "max_seq_length": 2048, "num_layers": 16,
  "lora": {"rank": 8, "scale": 20.0, "dropout": 0.0},
  "optimizer": "adamw", "lr_schedule": "cosine",
  "load_in_bits": null, "grad_checkpoint": false,
  "save_every": 100, "steps_per_report": 10, "steps_per_eval": 100,
  "val_batches": 25, "seed": 42,
  "beta": null, "group_size": null, "temperature": null,
  "max_completion_length": null, "reward_functions": null
}
```
Conditional validation: `dpo|orpo|cpo` require `beta`; `grpo` requires `group_size`.
Dataset format must be compatible with mode (sft: chat/completions/text; dpo/cpo: dpo;
orpo: orpo|dpo; grpo: grpo) → else 422.

### RunSummary
```json
{
  "run_id": "run_...", "name": "my-run", "status": "running",
  "config": TrainingConfig,
  "created_at": "...", "started_at": "...", "finished_at": null,
  "final_train_loss": null, "final_val_loss": null,
  "adapter_path": null, "error": null
}
```

### POST /train/jobs → `201 RunSummary`; `409 training_active` if a job is queued/running.
### GET /train/jobs?status=&limit=50&offset=0 → `{"runs": [RunSummary], "total": 12}` (newest first)
### GET /train/jobs/{run_id} → `RunSummary`
### POST /train/jobs/{run_id}/cancel → `202 RunSummary` (status may still be `running` until TERM lands)
### GET /train/jobs/{run_id}/metrics?after_step=0&kind=train|val
`{"metrics": [MetricEvent]}` — persisted metrics for backfill/history.
### GET /train/jobs/{run_id}/logs?tail=200 → `{"lines": ["..."]}`

### MetricEvent
```json
{"run_id": "run_...", "step": 10, "kind": "train",
 "loss": 2.31, "learning_rate": 1e-5, "it_per_sec": 4.2,
 "tokens_per_sec": 512.0, "peak_memory_gb": 3.4, "ts": "..."}
```
`kind: "val"` events carry `loss` (val loss); rate fields may be null.

### WS /ws/train/{run_id}
- Client MUST send first frame: `{"last_step": <int>}` (0 for fresh connect).
- Server replays persisted metrics with `step > last_step` as `metric` frames, then streams live.
- Server frames:
  - `{"type": "metric", "data": MetricEvent}`
  - `{"type": "status", "status": JobStatus, "error": "..."|null}`  (sent on every transition; also immediately after backfill)
  - `{"type": "log_line", "line": "..."}`
  - `{"type": "checkpoint", "step": 100, "adapter_path": "..."}`
- Terminal statuses close the socket after the final `status` frame.

---

## Worker event protocol (internal: worker subprocess stdout → manager)

One JSON object per line on stdout, discriminated by `"event"`:
```json
{"event": "started", "pid": 123}
{"event": "metric", "step": 10, "loss": 2.3, "learning_rate": 1e-5, "it_per_sec": 4.2, "tokens_per_sec": 512.0, "peak_memory_gb": 3.4}
{"event": "val_metric", "step": 100, "loss": 2.1}
{"event": "checkpoint", "step": 100, "adapter_path": "/abs/adapters"}
{"event": "done", "adapter_path": "/abs/adapters", "final_train_loss": 1.9, "final_val_loss": 2.0}
{"event": "error", "message": "...", "traceback": "..."}
```
Any stdout line that is not valid JSON with an `event` key is treated as a raw log line
(`log_line` WS frame + appended to `runs/<id>/train.log`).

---

## Adapters & Chat

### GET /adapters
```json
{"adapters": [{"adapter_path": "/abs/path", "run_id": "run_..."|null, "name": "my-run",
  "base_model_id": "mlx-community/...", "created_at": "..."}]}
```

### WS /ws/chat
- Client → server:
  - `{"type": "generate", "model_id": "...", "adapter_path": "/abs"|null,
     "messages": [{"role": "user", "content": "hi"}],
     "params": {"max_tokens": 512, "temperature": 0.7, "top_p": 0.9, "repetition_penalty": null}}`
  - `{"type": "cancel"}`
- Server → client:
  - `{"type": "token", "text": "..."}` (incremental)
  - `{"type": "done", "usage": {"prompt_tokens": 10, "completion_tokens": 42, "tokens_per_sec": 30.1}}`
  - `{"type": "error", "code": "training_active|model_not_found|internal", "message": "..."}`
- Multiple `generate` turns allowed on one socket (sequentially). While a training job is
  active, `generate` yields the `training_active` error frame.

---

## Export

### POST /export/fuse
`{"run_id": "run_..."} | {"model_id": "...", "adapter_path": "..."}` + `{"de_quantize": false, "output_name": "my-model"}`
→ `202 {"export_id": "ex_...", "kind": "fuse"}`
### GET /export/gguf/preflight?model_path=/abs/fused
```json
{"ok": false, "checks": [
  {"name": "llama_cpp_available", "ok": true, "message": "..."},
  {"name": "arch_supported", "ok": true, "message": "llama"},
  {"name": "weights_dequantized", "ok": false, "message": "weights are 4-bit quantized; re-fuse with de_quantize=true"}
]}
```
### POST /export/gguf
`{"model_path": "/abs/fused", "outtype": "f16|q8_0", "output_name": "my-model"}` → `202 {"export_id": "ex_...", "kind": "gguf"}`
### POST /export/ollama-modelfile
`{"gguf_path": "/abs/model.gguf", "model_family": "qwen|llama|smollm|mistral|custom", "name": "my-model", "custom_template": null}`
→ `200 {"modelfile": "<text>", "path": "/abs/Modelfile"}`
### GET /export/jobs/{export_id}
`{"export_id": "...", "kind": "fuse|gguf", "status": "running|completed|failed", "progress_log": ["..."], "output_path": "/abs"|null, "error": null}`
### GET /export/artifacts
`{"artifacts": [{"id": "...", "kind": "fused|gguf|modelfile", "path": "/abs", "size_bytes": 1, "source_run_id": "run_..."|null, "created_at": "..."}]}`

---

## Faz 2 (rezerve — henüz implement edilmedi)

- `POST /arena/sessions`, `WS /ws/arena/{session_id}` (frames tagged `"side": "a"|"b"`)
- `POST /recipes/convert` (multipart), `GET /recipes/jobs/{id}`
- `GET /runs/history?...` (zengin filtreler), `POST /train/jobs/{run_id}/clone`
