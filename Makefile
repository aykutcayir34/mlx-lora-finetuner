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

e2e:
	@echo "e2e: placeholder — no end-to-end suite yet"
