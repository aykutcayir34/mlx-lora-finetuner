# Architecture

This document explains how the pieces fit together and why. For the exact
REST/WebSocket contract (routes, payload shapes, status codes), see
[`docs/api.md`](api.md) — that file is frozen and normative; this one is
descriptive and may drift slightly behind implementation details that don't
affect the contract.

## Module map

### Backend (`backend/app/`)

| Module | Responsibility |
| --- | --- |
| `main.py` | FastAPI app factory: mounts every router under `/api/v1`, wires the SQLite lifecycle (`init_db` + orphan reaping on startup, `JobManager.shutdown()` on shutdown), registers the standard error-shape exception handlers, CORS for the Vite dev origin. |
| `config.py` | `Settings` (pydantic-settings, env prefix `MLXLF_`) — the single source of the data directory and its derived subpaths (`models_dir`, `datasets_dir`, `runs_dir`, `exports_dir`, `cache_dir`, `db_path`). |
| `deps.py` | Shared FastAPI dependencies: `get_current_user` (no-op today, exists so auth can be added later without touching routers), `get_settings`, `get_db`. |
| `api/system.py` | `GET /system/health`, `GET /system/stats` (memory/disk via `psutil`, active run id, data dir). |
| `api/models.py` | Model registry routes — local list, HF search proxy, download start/list, delete, `WS /ws/downloads/{download_id}`. Thin wrapper over `services/model_registry.py`. |
| `api/datasets.py` | Dataset routes — upload, validate, split, preview, delete. Thin wrapper over `services/dataset_service.py`. |
| `api/training.py` | Training job routes and `WS /ws/train/{run_id}`. Thin wrapper over `training/manager.py`'s `JobManager`. |
| `api/inference.py` | `GET /adapters`, `WS /ws/chat`. Thin wrapper over `services/inference_service.py`. |
| `api/export.py` | Export routes — fuse, GGUF preflight/convert, Ollama Modelfile render, job status, artifact list. Thin wrapper over `services/export_service.py`. |
| `core/errors.py` | `AppError` hierarchy (`NotFoundError`, `ConflictError`, `ValidationAppError`, `TrainingActiveError`, `InternalError`) and the exception handlers that turn them (plus `RequestValidationError` and any uncaught exception) into the `{"error": {code, message, detail}}` shape from `docs/api.md`. |
| `core/process.py` | Process-group spawn/kill helpers (`spawn_process_group`, `terminate_process_group`, `kill_process_group`, PID-file read/write, liveness check). Used by both the training worker and orphan reaping. |
| `core/ws.py` | `ConnectionManager` — topic-based WebSocket pub/sub (`subscribe`/`unsubscribe`/`broadcast`), used by the training WS. Downloads and chat WS use their own local queue-based mechanisms instead. |
| `db/database.py` | SQLite schema + versioned migrations (`MIGRATIONS` list, `schema_version` table), `init_db`, `get_connection`. |
| `db/repositories.py` | Thin query-layer classes per table: `RunsRepo`, `MetricsRepo`, `DatasetsRepo`, `DownloadsRepo`, `ExportsRepo`, `ArtifactsRepo`. |
| `schemas/*.py` | Pydantic request/response models per domain (`training.py`, `datasets.py`, `models.py`, `inference.py`, `export.py`), plus `events.py` for the worker's internal JSONL event protocol. |
| `services/model_registry.py` | Local model directory scan, HF Hub search, resumable snapshot downloads with live progress (via a custom `tqdm` subclass), deletion. No `mlx` import — must stay importable on any OS/CI. |
| `services/dataset_service.py` | Upload, format sniffing (6 formats), per-row validation, train/valid/test split, paginated preview, delete. Pure file/SQLite logic, no `mlx` import. |
| `services/inference_service.py` | Chat generation: model/tokenizer LRU cache (size 1) and a single-thread executor for all MLX work. See [Single-thread MLX executor](#single-thread-mlx-executor-in-inference) below. |
| `services/export_service.py` | Fuse (LoRA → merged model), GGUF preflight + conversion, Ollama Modelfile rendering (Jinja2 templates in `app/templates/ollama/`). Every heavy operation runs as a subprocess. |
| `training/manager.py` | `JobManager` — the training orchestrator. See [Training pipeline lifecycle](#training-pipeline-lifecycle). |
| `training/worker.py` | `python -m app.training.worker --run-dir <dir>` subprocess entry point — bridges `TrainingConfig` to `mlx_lm_lora.train.run()` and emits JSONL events on stdout. |
| `training/presets.py` | Named default configs for the Train page. |
| `training/events.py` | (Reserved — currently empty/minimal; event parsing lives in `schemas/events.py`.) |

### Frontend (`frontend/src/`)

| Directory | Responsibility |
| --- | --- |
| `pages/` | One component per top-level route (`DashboardPage`, `ModelsPage`, `DatasetsPage`, `TrainPage`, `ChatPage`, `ExportPage`), wired in `routes.ts` / `App.tsx`. |
| `components/dashboard/` | System stats panel, active-run card, recent-runs list, onboarding guide. |
| `components/models/` | Local model grid, HF search panel, download list with live progress. |
| `components/datasets/` | Upload dropzone, format badge, validation report view, split dialog, per-format preview table. |
| `components/training/` | Config form, run monitor (status/log/checkpoints), run history list. |
| `components/charts/` | `LossChart`, `LRChart`, `MemoryChart` (Recharts) plus a shared `downsample` helper for long-running charts. |
| `components/chat/` | Chat window, message bubbles, generation-params drawer, adapter-compare column, `useChatSocket` hook. |
| `components/export/` | Fuse/GGUF/Ollama wizards, job progress panel, Modelfile preview, artifact table. |
| `components/common/` | Design-system primitives (Button, Card, Modal, Table, Toast, Tabs, Field, etc.) shared across pages. |
| `components/layout/` | App shell — side nav, top bar, status footer, page shell. |
| `api/client.ts` | Typed `fetch` wrapper that decodes the `{"error": {...}}` shape into thrown errors. |
| `api/queries/*.ts` | TanStack Query hooks per domain, keyed by `api/queries/keys.ts`. |
| `api/ws.ts` | Typed WebSocket client helper (connect, typed message dispatch, reconnection is caller-driven). |
| `stores/` | Zustand stores for cross-component client state (`trainingStore`, `chatStore`). |
| `test/` | MSW request handlers per domain (`test/handlers/*.ts`) and shared test setup/render helpers, used by every component/page test. |

## Training pipeline lifecycle

1. **Create** — `POST /train/jobs` → `JobManager.create_job()`. Validates the
   model directory exists, the dataset exists and has a `train.jsonl` (i.e. was
   already split), the dataset format is compatible with `train_mode` (see
   `DATASET_FORMAT_COMPAT` in `training/manager.py`, matching the table in
   `docs/api.md`), and that no other job is queued/running (`TrainingActiveError`
   otherwise — see [Decisions](#why-a-single-job-lock)). On success it inserts a
   `runs` row (`status=queued`), writes `runs/<run_id>/config.json`, and starts
   the worker.
2. **Spawn** — `_start_worker` calls `core.process.spawn_process_group`, which
   runs `python -m app.training.worker --run-dir <dir>` with
   `start_new_session=True` so the worker (and anything it forks) lives in its
   own process group, `stdout`+`stderr` merged and piped. The PID is persisted
   to both the `runs` row and `runs/<run_id>/worker.pid`, and status flips to
   `running` *before* the WS broadcast (persist-then-broadcast ordering is a
   deliberate invariant so a client that queries `GET /train/jobs/{id}` right
   after receiving a WS frame never sees stale state).
3. **JSONL events on stdout** — the worker loads `config.json`, builds the
   `argparse.Namespace` that `mlx_lm_lora.train.run()` expects (mapping our
   `TrainingConfig` fields onto the library's CLI-flag names), and calls
   `run(args, training_callback=WorkerCallback(...))`. `WorkerCallback` bridges
   `mlx_lm.tuner.callbacks.TrainingCallback.on_train_loss_report` /
   `on_val_loss_report` into `{"event": "metric"|"val_metric", ...}` JSON lines,
   and emits `checkpoint` lines whenever `step % save_every == 0`. A trailing
   `done` (with `adapter_path`, `final_train_loss`, `final_val_loss`) or `error`
   (with `message`/`traceback`) line is always emitted, `flush=True`.
4. **Event pump** — `JobManager._pump` reads the worker's stdout line by line
   in a thread-pool executor (`proc.stdout.readline` is blocking I/O). Every
   line is appended to `runs/<run_id>/train.log` verbatim. It's then parsed by
   `schemas.events.parse_worker_line` (a discriminated-union `TypeAdapter`); a
   line that isn't valid JSON with a known `event` key is treated as a plain
   `log_line` (so third-party library log spam is forwarded, not dropped).
   Recognized events are converted to WS frames and:
   - **SQLite** — `metric`/`val_metric` rows are buffered and flushed in
     batches of 10 (or at run completion) via `MetricsRepo.insert_many`.
   - **Ring buffer** — every frame (including `log_line`) is also appended to
     a per-run in-memory `deque(maxlen=2000)`, used for warm WS reconnects
     within process lifetime (see [WS protocols](#ws-protocols-summary)).
   - **WS broadcast** — pushed immediately to `train/{run_id}` subscribers via
     `ConnectionManager.broadcast`.
5. **Terminal states** — `done`/`error` events (or the worker exiting without
   either, which is treated as a `failed` synthetic error) call `_finalize`,
   which is idempotent (`_finalized` set guards double-finalization), persists
   the terminal `RunsRepo.finish()` row, clears `_active_run_id`, broadcasts a
   final `status` WS frame, and sets a per-run `asyncio.Event` that the WS
   handler awaits to know when to close the socket.
6. **Cancel** — `POST /train/jobs/{run_id}/cancel` marks the run cancelled
   locally, sends `SIGTERM` to the whole process group
   (`terminate_process_group`), and schedules a `SIGKILL` after a grace period
   (`DEFAULT_CANCEL_GRACE_SECONDS = 10.0`) if the process hasn't exited by
   then. The worker installs a `SIGTERM` handler that calls `os._exit(143)` to
   exit as fast as possible, since MLX's training loop may not be safely
   interruptible mid-step — the process-group `SIGKILL` is the real safety net,
   not the handler.
7. **Orphan reaping** — on every server startup, `reap_orphans()` scans `runs`
   for rows still `queued`/`running` (which can only happen after a crash or
   `kill -9` of the API server itself, since graceful shutdown cancels active
   jobs first). For each, it checks whether the recorded PID (from the DB, or
   `worker.pid` as a fallback) is still alive: if so, it's terminated (TERM
   then, after a short poll, KILL if still alive) and marked `cancelled`; if
   not, the row is marked `failed` with an explanatory message.

## WS protocols summary

- **`WS /ws/train/{run_id}`** — client must send `{"last_step": <int>}` as the
  first frame (0 for a fresh connect). The server replays persisted metrics
  with `step > last_step` from SQLite as `metric` frames (the backfill), then
  immediately sends one `status` frame, then subscribes the socket to live
  broadcasts. This "backfill handshake" lets a client that reconnects mid-run
  (e.g. after a page refresh) resume exactly where it left off without
  re-fetching everything via REST. Terminal statuses close the socket right
  after the final `status` frame — the server never leaves a done run's socket
  open.
- **`WS /ws/chat`** — no handshake frame; the client sends `{"type":
  "generate", ...}` frames whenever it wants a turn, and `{"type": "cancel"}`
  to stop an in-flight one. One socket may host multiple sequential `generate`
  turns. If a training job is active, `generate` immediately yields a
  `training_active` error frame instead of running (both compete for the same
  Metal GPU memory).
- **`WS /ws/downloads/{download_id}`** — no client frames; server streams
  `progress` frames and a terminal `done`/`error` frame, then closes. Backed by
  `ModelRegistry`'s own per-download subscriber-queue mechanism (not
  `core.ws.ConnectionManager`), since downloads are keyed by `download_id`
  rather than a broadcast topic multiple clients share equally.

## Single-thread MLX executor (in inference)

`InferenceService` runs every MLX call — model load and every `stream_generate`
call — through a single dedicated `ThreadPoolExecutor(max_workers=1)`. This
isn't just a serialization convenience (there's only one GPU to time-share
anyway): MLX arrays and command streams are affinitized to the thread that
materializes them. Loading a model (especially with a LoRA adapter merged in
lazily) on one thread and then generating from a different thread previously
failed at runtime with `"There is no Stream(cpu, 0) in current thread"`. Pinning
both `get_model` and the generation worker to the same single-thread executor
guarantees load and generate always happen on the same OS thread, which
sidesteps the bug entirely and, as a side effect, naturally serializes
concurrent chat requests.

## Export pipeline

Nothing in `export_service.py` imports `mlx`/`mlx_lm` at module or call scope —
every heavy step is a subprocess, so a crash or Metal memory spike during
conversion can never take the API server down with it:

1. **Fuse** (`POST /export/fuse`) — resolves a `(model_path, adapter_path)`
   pair either from a completed `run_id` or an explicit
   `(model_id, adapter_path)`, then runs `python -m mlx_lm fuse --model ...
   --adapter-path ... --save-path ...` (optionally `--dequantize`) as a
   background subprocess. Blocked with `training_active` while any run is
   queued/running.
2. **GGUF preflight** (`GET /export/gguf/preflight`) — three gate checks before
   allowing conversion: `llama_cpp_available` (a `convert_hf_to_gguf.py` file
   found in `MLXLF_LLAMA_CPP_DIR` or `<data_dir>/cache/llama.cpp`),
   `arch_supported` (the fused model's `config.json` `model_type` is in a
   curated allow-list: `llama`, `qwen2`, `qwen3`, `mistral`, `gemma`, `gemma2`,
   `phi3`), and `weights_dequantized` (no `"quantization"` key in
   `config.json` — GGUF conversion needs full-precision weights, so a
   quantized fuse must be redone with `de_quantize=true` first).
3. **GGUF convert** (`POST /export/gguf`) — re-runs the preflight server-side
   (never trusts a stale client-side check) and, if it passes, spawns
   `convert_hf_to_gguf.py <model_path> --outfile ... --outtype ...` as a
   subprocess.
4. **Ollama Modelfile** (`POST /export/ollama-modelfile`) — pure
   template rendering (Jinja2, `app/templates/ollama/<family>.j2`), no
   subprocess. `model_family="custom"` requires a `custom_template` body field.
5. Every job (fuse/gguf) streams its subprocess stdout into an in-memory
   `progress_log` list keyed by `export_id` (not persisted — lost on server
   restart, unlike training's SQLite-backed metrics) and, on success, inserts
   an `artifacts` row pointing at the produced path.

## Storage layout

See the [data directory layout](../README.md#data-directory-layout) in the
README for the on-disk tree. The SQLite database (`app.db`, WAL mode) has six
tables, all created by the single migration in `db/database.py` (`MIGRATIONS`,
tracked via a `schema_version` table for future migrations):

- **`runs`** — one row per training job: config (as JSON), status, model/dataset
  ids, timestamps, `pid`, resulting `adapter_path`, final losses, error text.
- **`metrics`** — one row per `(run_id, step, kind)` (`kind` is `train` or
  `val`), the persisted half of the training WS backfill.
- **`datasets`** — one row per uploaded dataset: detected format, row count,
  splits (as JSON), path.
- **`downloads`** — one row per model download: byte/file progress counters,
  status, error.
- **`exports`** — one row per fuse/GGUF job: kind, status, output path, error.
- **`artifacts`** — one row per produced file (fused model, GGUF, Modelfile),
  linked back to `source_run_id` when applicable, listed by
  `GET /export/artifacts`.

## Testing strategy

- **Fake-worker fixture** (`tests/fixtures/fake_worker.py`) — a standalone
  script with zero MLX dependency that emits scripted JSONL scenarios (`happy`,
  `crash`, `ignore_sigterm`, `garbage`) driven by environment variables.
  `JobManager` tests point `worker_argv_factory` at it instead of the real
  `app.training.worker`, exercising the full spawn → pump → SQLite → WS →
  finalize pipeline (including the TERM→grace→KILL cancel path and garbage/
  non-JSON stdout handling) without ever touching MLX.
- **Mocked mlx via import indirection** — `training/worker.py` and
  `services/inference_service.py` never import `mlx`/`mlx_lm`/`mlx_lm_lora` at
  module scope; every entry point goes through a small `_*_fn`/`_import_*`
  wrapper function. Unit tests inject fakes for these (e.g. `train_mod=` in
  `_build_worker_args`/`_run_training`, monkeypatched `_load_fn`/
  `_stream_generate_fn`), so the whole backend test suite runs on any OS
  (including the Linux CI runners) without MLX installed at all.
- **MSW (frontend)** — `frontend/src/test/handlers/*.ts` define per-domain
  mock REST handlers registered with `msw`'s Node server (`test/server.ts`),
  so component/page tests exercise real TanStack Query hooks against
  predictable fixture responses instead of a live backend.
- **Real-model e2e** — the end-to-end suite (owned by a separate `e2e/`
  workspace, run via `make e2e`) drives the actual built app against a real,
  small downloaded model on real Apple Silicon hardware — the one layer that
  isn't mocked anywhere else.

## Decisions log

### Why a subprocess worker over CLI-parsing `mlx_lm_lora`

Training runs as a separate OS process (`app.training.worker`) rather than an
in-process call into `mlx_lm_lora.train.run()`. A training loop that hangs,
leaks Metal memory, or segfaults inside MLX can't take the FastAPI server (and
every other in-flight request) down with it. A subprocess also gives a clean,
signal-based cancellation story (`SIGTERM`/`SIGKILL` on a process group) that
would be much harder to get right for an in-process `asyncio` task doing
blocking MLX compute.

### Why SQLite

The app is a single-user, single-machine local tool — there's no case for a
client/server database here. SQLite (via `aiosqlite`, WAL mode) gives
durable, queryable state (run history, metrics for chart backfill) with zero
operational overhead, and it's trivial to inspect/back up as a single file
inside the data directory.

### Why a single-job lock

`JobManager.create_job` rejects a second job with `training_active` while one
is queued/running (`RunsRepo.list_active()`), and export/chat routes apply the
same rule in reverse (blocking while training is active). MLX training and
inference both want the whole GPU's Metal memory; running two heavy MLX
workloads concurrently on a single Apple Silicon machine reliably degrades or
crashes both rather than usefully time-slicing. Serializing all MLX-heavy work
through one lock is simpler and more predictable than trying to make
concurrent MLX workloads coexist.
