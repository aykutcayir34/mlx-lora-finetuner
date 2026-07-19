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
→ `502` (code `internal`) when the HF Hub request fails or the Hub is unreachable.
### POST /models/download  `{"model_id": "..."}` → `202 {"download_id": "dl_...", "model_id": "..."}`
409 `conflict` if already downloading. Existing completed model → 409 `conflict`.
409 `conflict` also when the estimated repo size exceeds free disk space (message
names the required vs. available bytes).
### GET /models/downloads
```json
{"downloads": [{"download_id": "dl_...", "model_id": "...",
  "status": "running|completed|failed|cancelled",
  "bytes_done": 1, "bytes_total": 2, "files_done": 1, "files_total": 5, "error": null,
  "started_at": "...", "finished_at": null}]}
```
### POST /models/downloads/{download_id}/cancel
→ `202 DownloadInfo` (status flips to `cancelled` once the transfer aborts; partial
files stay on disk so a re-POSTed download resumes). `409 conflict` if the download
is already in a terminal state; `404` if unknown.
### DELETE /models/{model_id} → `204`. 409 `training_active` if used by the running job.

### WS /ws/downloads/{download_id}
Server frames (JSON): `{"type": "progress", "bytes_done": n, "bytes_total": n, "files_done": n, "files_total": n}`,
terminal `{"type": "done"}`, `{"type": "cancelled"}` or `{"type": "error", "message": "..."}`.
No client frames. Socket closes after terminal frame.

---

## Datasets

Detected formats (enum `DatasetFormat`): `chat` (`{"messages": [...]}`), `completions`
(`{"prompt","completion"}`), `text` (`{"text"}`), `dpo` (`{"prompt","chosen","rejected"}`),
`orpo` (dpo + `"preference_score"`), `grpo` (`{"prompt","answer"}`, optional `"system"`),
`ftpo` (`{"context_with_chat_template","rejected_decoded","multi_chosen_decoded"}` —
final-token preference rows; `rejected_decoded` is a single-token string,
`multi_chosen_decoded` a list of single-token alternatives).

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

## Dataset import from Hugging Face Hub

### GET /datasets/search?q=&limit=20
HF Hub dataset search proxy (`HfApi.list_datasets`).
```json
{"results": [{"dataset_id": "mlx-community/wikisql", "downloads": 1234, "likes": 5, "imported": false}]}
```
`imported` is true when a local dataset was already imported from that HF id.
→ `502` (code `internal`) when the HF Hub request fails or the Hub is unreachable.

### POST /datasets/import
```json
{"dataset_id": "org/name", "config": null, "split": "train",
 "name": null, "max_rows": 5000}
```
`split` defaults to `"train"`; `name` defaults to a slug of the HF id; `max_rows`
null = all rows. The import streams rows (`datasets` lib, `streaming=True`) into a
raw JSONL, then registers it as a regular local dataset (format auto-detected —
unrecognizable columns fail the job with a message listing the columns found).
→ `202 {"import_id": "di_...", "dataset_id": "org/name"}`.
`409 conflict` if the same HF dataset is already importing.

### GET /datasets/imports
```json
{"imports": [{"import_id": "di_...", "hf_dataset_id": "org/name", "config": null,
  "split": "train", "status": "running|completed|failed|cancelled",
  "rows_written": 1200, "dataset_id": "ds_..."|null, "error": null,
  "started_at": "...", "finished_at": null}]}
```
`dataset_id` is the resulting LOCAL dataset id, set on completion (the dataset then
appears in GET /datasets and can be validated/split/trained like an upload).

### POST /datasets/imports/{import_id}/cancel
→ `202` import info (status flips to `cancelled`; no local dataset is registered,
partial temp output is removed). `409 conflict` if already terminal; `404` if unknown.

---

## Training

### Enums
- `TrainMode`: `sft | dpo | orpo | cpo | grpo | ftpo`
- `SftLossType`: `nll | chunked_nll | dft`  (sft-only knob; `dft` = Dynamic Fine-Tuning)
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
  "max_completion_length": null, "reward_functions": null,
  "sft_loss_type": null,
  "lambda_mse_target": null, "tau_mse_target": null,
  "lambda_mse": null, "clip_epsilon_logits": null
}
```
Conditional validation: `dpo|orpo|cpo` require `beta`; `grpo` requires `group_size`.
`sft_loss_type` is only accepted for `sft` (null → library default `nll`).
`lambda_mse_target`, `tau_mse_target`, `lambda_mse`, `clip_epsilon_logits` are only
accepted for `ftpo` and are all optional (null → library defaults 0.05 / 1.0 / 0.4 / 2.0).
`reward_functions` entries must come from the mlx-lm-lora 3.0.0 registry —
`r1_accuracy_reward_func | r1_int_reward_func | r1_strict_format_reward_func |
r1_soft_format_reward_func | r1_count_xml` — unknown names → 422; null or `[]` →
the library's default set (all five).
Dataset format must be compatible with mode (sft: chat/completions/text; dpo/cpo: dpo;
orpo: orpo|dpo; grpo: grpo; ftpo: ftpo) → else 422.

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

### GET /train/jobs/{run_id}/config.yaml
Downloads the run's full configuration as YAML (`Content-Type: application/x-yaml`,
`Content-Disposition: attachment`). Document shape:
```yaml
config_schema: 1
metadata:            # informational only — ignored on import
  exported_at: "..."
  app_version: "0.1.0"
  mlx_lm_lora_version: "3.0.0"
  run_id: "run_..."
  status: "completed"
  final_train_loss: 1.23    # null while running
  final_val_loss: 1.31
config:              # exactly the TrainingConfig fields (see above)
  name: "my-run"
  model_id: "mlx-community/..."
  # ...
```
404 if the run is unknown.

### POST /train/configs/import — multipart: `file` (.yaml/.yml)
Parses and validates an exported config document → `200 TrainingConfig` (JSON),
ready to prefill the train form. `metadata` is ignored; `config_schema` must be `1`.
Validation is STRICT: unparsable YAML, a missing `config` mapping, or any unknown
key under `config` → 422 `validation_error` naming the offending keys, in addition
to all standard TrainingConfig rules (mode-conditional fields, reward-function
names, format compatibility is checked later at job submit).

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

While a training job is queued/running, `POST /export/fuse` and `POST /export/gguf`
return `409 training_active` (Metal memory contention).

`output_name` (fuse, gguf) and `name` (ollama-modelfile) must be a plain file name:
`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$` — letters, digits, `.`, `_`, `-`; no path
separators (`/`, `\`) or `..`; must not start with `.` or `-`. Anything else →
`422 validation_error`.

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

## Arena (Faz 2)

Stateless side-by-side comparison of two model/adapter pairs. Generation is
SEQUENTIAL (side "a" fully streams, then side "b") — one Metal GPU, and the
inference service holds one model at a time.

### WS /ws/arena
- Client → server:
  - `{"type": "generate",
     "side_a": {"model_id": "...", "adapter_path": "/abs"|null},
     "side_b": {"model_id": "...", "adapter_path": "/abs"|null},
     "messages": [{"role": "user", "content": "..."}],
     "params": GenerationParams}`
  - `{"type": "cancel"}` — aborts the in-flight side and skips the remaining side.
- Server → client:
  - `{"type": "side_start", "side": "a"|"b"}`
  - `{"type": "token", "side": "a"|"b", "text": "..."}`
  - `{"type": "side_done", "side": "a"|"b", "usage": {...}}`  (same usage shape as chat)
  - `{"type": "done"}` — after both sides (or after cancel)
  - `{"type": "error", "side": "a"|"b"|null, "code": "...", "message": "..."}` — a per-side
    error skips to the next side; `side: null` errors (e.g. `training_active`) end the turn.
    Socket stays open in all cases.

## Data Recipes (Faz 2)

Deterministic document→dataset conversion (no LLM in the loop). Accepted
uploads: `.pdf`, `.docx`, `.csv`, `.txt`, `.md`.

### POST /recipes/convert — multipart
Fields: `file`; `name` (dataset name); `output_format`: `text|completions|chat`;
`chunk_size` (chars, default 2000), `chunk_overlap` (default 200) for pdf/docx/txt/md;
for CSV: `prompt_column`, `completion_column` (required for completions/chat),
optional `system_prompt` (chat only).
Rules: pdf/docx/txt/md → `text` format only (422 otherwise). CSV → `completions`
or `chat`. → `202 {"recipe_job_id": "rj_...", "name": "..."}`

### GET /recipes/jobs/{id}
```json
{"recipe_job_id": "rj_...", "status": "running|completed|failed",
 "rows_emitted": 42, "preview_rows": [<first 5 emitted rows>],
 "dataset_id": "ds_..."|null, "error": null}
```
On success the output is registered as a regular dataset (appears in GET /datasets,
can be validated/split/trained like any upload).

## Run History (Faz 2)

### GET /runs/history?model_id=&train_mode=&status=&sort=&limit=50&offset=0
`sort`: `created_at|-created_at|final_train_loss|-final_train_loss` (default `-created_at`).
→ `{"runs": [RunSummary], "total": n}` (superset of GET /train/jobs filtering).

### POST /train/jobs/{run_id}/clone
Returns the past run's config as a fresh prefill — does NOT create a job.
→ `200 TrainingConfig` (404 if run missing).
