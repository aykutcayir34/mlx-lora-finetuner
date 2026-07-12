.PHONY: install dev test test-backend test-frontend lint e2e

install:
	cd backend && uv sync --all-extras --all-groups
	cd frontend && npm install

dev:
	@trap 'kill 0' EXIT; \
	( cd backend && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 ) & \
	( cd frontend && npm run dev -- --port 5173 ) & \
	wait

test: test-backend test-frontend

test-backend:
	cd backend && uv run pytest

test-frontend:
	cd frontend && npx vitest run

lint:
	cd backend && uv run ruff check .
	cd frontend && npx tsc --noEmit

# Real end-to-end smoke test against the MLX runtime: downloads a tiny model,
# trains a LoRA adapter, chats with it, and fuses the result. Needs Apple
# Silicon + network on first run (to download mlx-community/SmolLM-135M-Instruct-4bit).
# Set MLXLF_E2E_DATA_DIR to reuse a data dir across runs and skip the download.
e2e:
	cd backend && uv run python ../e2e/smoke_train.py
