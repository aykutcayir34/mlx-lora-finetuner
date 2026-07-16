# Contributing

Thanks for contributing to mlx-lora-finetuner. This is a small project — the
rules below are short, but the three invariants are hard requirements.

## Dev setup

Requirements: Python 3.11+ with [uv](https://docs.astral.sh/uv/), Node.js 20+
with npm. Training/inference need an Apple Silicon Mac; everything else
(including the full test suite) runs anywhere.

```bash
make install   # uv sync (backend) + npm install (frontend)
make dev       # backend on :8000, frontend on :5173
```

Backend settings are `MLXLF_*` env vars, optionally via `backend/.env` — see
[`backend/.env.example`](backend/.env.example).

## Tests and linting

```bash
make test      # pytest (backend) + vitest (frontend)
make lint      # ruff check (backend + e2e/) + tsc --noEmit + oxlint (frontend)
make build     # production frontend build (tsc -b && vite build)
make e2e       # real end-to-end smoke — Apple Silicon + network only,
               # not part of the default test loop
```

CI (`.github/workflows/ci.yml`) runs the backend suite on Linux with Python
3.11/3.12/3.13 and **without MLX installed** — keep that green.

Optionally install the pre-commit hooks (ruff, oxlint, tsc on every commit):

```bash
pip install pre-commit && pre-commit install
```

## Hard invariants

These three rules are enforced in review; PRs that break them will be asked
to change.

1. **Contract-first.** [`docs/api.md`](docs/api.md) is the frozen
   frontend/backend contract — every router and every query hook/TS type must
   conform to it. A behavior change starts with a dedicated commit updating
   `docs/api.md`, then the code follows in later commits. Never the other way
   around.

2. **Lazy mlx imports.** Modules that touch MLX (`training/worker.py`,
   `services/inference_service.py`, …) must never import `mlx` / `mlx_lm` /
   `mlx_lm_lora` at module level — every entry point hides the import behind a
   `_*_fn` / `_import_*` indirection function. CI runs the backend suite on
   Linux without MLX installed; a module-level import breaks the whole suite
   there.

3. **Single-training-job lock.** Only one training job may be
   `queued`/`running` at a time (`JobManager` rejects a second with
   `409 training_active`). Export and chat return the same error while
   training is active — all heavy MLX work shares the same Metal GPU memory,
   and concurrent workloads reliably crash or degrade each other. Don't add a
   heavy MLX code path that bypasses this lock.

## Commit style

Conventional commits, as in the existing history:
`feat(training): ...`, `fix(datasets): ...`, `docs(api): ...`, `test(frontend): ...`,
`ci: ...`, `build(backend): ...`, `chore: ...`.

## Releases

The version's source of truth is `backend/pyproject.toml` `version` — the
health endpoint (`GET /system/health`) reads it via `importlib.metadata`.
`frontend/package.json` `version` is kept aligned with it.

To cut a release:

1. Bump `version` in `backend/pyproject.toml` (and mirror it in
   `frontend/package.json`).
2. Move the `## [Unreleased]` entries in [`CHANGELOG.md`](CHANGELOG.md) under
   a new `## [X.Y.Z] - YYYY-MM-DD` heading.
3. Commit, then tag: `git tag vX.Y.Z && git push --tags`.
