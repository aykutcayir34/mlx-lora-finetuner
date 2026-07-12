"""FastAPI application factory.

Mounts every router under `app.api` at `/api/v1`, wires up the SQLite
database lifecycle, and registers the standard error-shape exception
handlers. Wave-1+ agents should NOT need to touch this file — all routes
are already frozen here (as stubs where business logic is still missing).
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import datasets, export, inference, models, system, training
from app.config import get_settings
from app.core.errors import register_exception_handlers
from app.db.database import init_db

ALLOWED_ORIGINS = ["http://localhost:5173"]


async def reap_orphans() -> None:
    """Reap orphaned training/export subprocesses left over from a previous run.

    No-op stub for Wave-0. Wave-1 T1 will fill this in: on startup, scan
    `runs` for rows still marked `running` whose `pid` is no longer alive
    and mark them `failed`/`cancelled` accordingly.
    """


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()

    # Ensure the full data directory tree exists before anything else runs.
    for directory in (
        settings.data_dir,
        settings.models_dir,
        settings.datasets_dir,
        settings.runs_dir,
        settings.exports_dir,
        settings.cache_dir,
    ):
        directory.mkdir(parents=True, exist_ok=True)

    await init_db(settings.db_path)
    await reap_orphans()

    yield


def create_app() -> FastAPI:
    app = FastAPI(title="mlx-lora-finetuner-backend", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    register_exception_handlers(app)

    for router_module in (system, models, datasets, training, inference, export):
        app.include_router(router_module.router, prefix="/api/v1")

    return app


app = create_app()
