.PHONY: install dev build test test-backend test-frontend lint e2e e2e-faz2

install:
	cd backend && uv sync --all-extras --all-groups
	cd frontend && npm install

dev:
	@trap 'kill 0' EXIT; \
	( cd backend && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 ) & \
	( cd frontend && npm run dev -- --port 5173 ) & \
	wait

# Production build of the frontend (type-checks via `tsc -b`, then bundles
# with Vite). The backend has no build step; it runs from source.
build:
	cd frontend && npm run build

test: test-backend test-frontend

test-backend:
	cd backend && uv run pytest

test-frontend:
	cd frontend && npx vitest run

lint:
	cd backend && uv run ruff check . ../e2e
	cd frontend && npx tsc --noEmit
	cd frontend && npx oxlint

# Real end-to-end smoke test against the MLX runtime: downloads a tiny model,
# trains a LoRA adapter, chats with it, and fuses the result. Needs Apple
# Silicon + network on first run (to download mlx-community/SmolLM-135M-Instruct-4bit).
# Set MLXLF_E2E_DATA_DIR to reuse a data dir across runs and skip the download.
e2e:
	cd backend && uv run python ../e2e/smoke_train.py

# Real end-to-end smoke test for the Faz-2 surface: DPO training, Data
# Recipes (csv/txt -> dataset), Run History filter/sort/clone, and the Arena
# WS side-by-side comparison. Same MLXLF_E2E_DATA_DIR env var as `e2e` above
# (reusing it lets Arena compare against a warm SFT adapter instead of
# falling back to base-vs-base). Kept as a separate target from `e2e` since
# it's Faz-2-specific and not needed for a plain Faz-1 check.
e2e-faz2:
	cd backend && uv run python ../e2e/smoke_faz2.py
