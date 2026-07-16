# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
The version's source of truth is `backend/pyproject.toml` (reported by
`GET /system/health`); see CONTRIBUTING.md for the release steps.

## [Unreleased]

## [0.1.0] - 2026-07-16

First release: local LoRA/DoRA/full fine-tuning studio for Apple Silicon —
model download, dataset management, SFT/DPO/ORPO/CPO/GRPO/FTPO training,
chat/arena, GGUF/Ollama export — plus the repository audit wave (PRs #18–#28):

### Added

- Hugging Face Hub dataset search/import with streaming download, cancellable model/dataset downloads
- mlx-lm-lora 3.0.0: FTPO training mode and selectable SFT loss types (incl. DFT) (#19)
- Production entry point `mlxlf` — single FastAPI process serving API + built frontend (#24)
- GRPO reward-function validation and editor, saved-checkpoint list in the run monitor (#26)
- Frontend test coverage: socket hooks, arenaStore, and Models/Export/Recipes page tests (#27)
- Repo hygiene: `.env.example`, CONTRIBUTING, issue/PR templates, pre-commit, dependabot (#28)

### Fixed

- Chat/Arena WebSocket recovery after drops mid-generation; global and
  route-level React error boundaries; path-traversal rejection in export
  `output_name`/`name` (#18)
- Startup reaping of stale `running` downloads/imports/exports/recipe jobs (#20)
- Dataset-import cancel race, `/ws/train` backfill-subscribe metric gap,
  GGUF preflight on corrupt config, internal-error message leaks, one
  canonical model-path mapping (#21)
- `train.log` rotation at 10 MiB with seek-based log tailing (#22)
- Single-training-job lock: serialized job creation; null-field worker
  metrics no longer dropped (#23)
- Stale-writer race on download completion (intermittent wrong final
  progress counters) (#28)
- TrainConfigForm fetch-error states, sane QueryClient retry defaults,
  stats invalidation on deletes (#28)

### Changed

- CI hardening: frontend production build + oxlint in CI, `e2e/` linted,
  Python 3.11–3.13 matrix, concurrency cancellation (#23)
- Version bounds on all direct backend dependencies (#25)
- Docs: HF Hub 502 / insufficient-disk 409 documented in the API contract (#25)
