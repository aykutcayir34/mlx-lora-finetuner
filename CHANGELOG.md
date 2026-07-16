# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
The version's source of truth is `backend/pyproject.toml` (reported by
`GET /system/health`); see CONTRIBUTING.md for the release steps.

## [Unreleased]

Repository audit wave (PRs #18–#27):

### Added

- Hugging Face Hub dataset search/import with streaming download, cancellable model/dataset downloads (#18)
- mlx-lm-lora 3.0.0: FTPO training mode and selectable SFT loss types (incl. DFT) (#19)
- Production entry point `mlxlf` — single FastAPI process serving API + built frontend (#24)
- GRPO reward-function validation and editor, saved-checkpoint list in the run monitor (#26)
- Frontend test coverage: socket hooks, arenaStore, and Models/Export/Recipes page tests (#27)

### Fixed

- Chat/Arena WebSocket reconnect after drops mid-generation (#19)
- Global and route-level React error boundaries (#19)
- Path-traversal rejection in export `output_name`/`name` (#19)
- Startup reaping of stale `running` downloads/imports/exports/recipe jobs (#20)
- `/ws/train` backfill-subscribe metric gap; dataset import worker owns terminal writes (#21)
- `train.log` rotation at 10 MiB with seek-based log tailing (#22)
- Single-training-job lock: serialized job creation, no dropped null-field metrics (#23)

### Changed

- CI hardening: frontend build + oxlint in CI, `e2e/` linted, concurrency cancellation (#23)
- Version bounds on all direct backend dependencies (#24)
- Docs: HF Hub 502 / insufficient-disk 409 documented in the API contract (#25)
