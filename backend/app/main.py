"""FastAPI application factory.

Mounts every router under `app.api` at `/api/v1`, wires up the SQLite
database lifecycle, and registers the standard error-shape exception
handlers. Wave-1+ agents should NOT need to touch this file — all routes
are already frozen here (as stubs where business logic is still missing).
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import arena, datasets, export, history, inference, models, recipes, system, training
from app.config import get_settings
from app.core.errors import register_exception_handlers
from app.db.database import init_db

ALLOWED_ORIGINS = ["http://localhost:5173"]


async def reap_orphans() -> None:
    """Reap orphaned background work left over from a previous run.

    Training runs: delegates to `JobManager.reap_orphans()`, which scans `runs`
    for rows still marked `queued`/`running` whose `pid` is no longer alive
    (-> `failed`) or is still alive (-> killpg + `cancelled`).

    Downloads, dataset imports, exports and recipe jobs run as in-process
    asyncio/background tasks that never survive a restart, so any row still
    `running` at startup is unrecoverable. Mark them `failed` — otherwise the
    `get_active_*` duplicate guards keep returning `409 conflict` for the same
    model/dataset forever.
    """
    from app.db.database import get_connection
    from app.db.repositories import DatasetImportsRepo, DownloadsRepo, ExportsRepo, RecipeJobsRepo
    from app.training.manager import get_job_manager

    await get_job_manager().reap_orphans()

    error = "interrupted by server restart"
    finished_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    settings = get_settings()
    async with get_connection(settings.db_path) as conn:
        await DownloadsRepo(conn).fail_stale_running(finished_at, error)
        await DatasetImportsRepo(conn).fail_stale_running(finished_at, error)
        await ExportsRepo(conn).fail_stale_running(finished_at, error)
        await RecipeJobsRepo(conn).fail_stale_running(error)


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

    # Gracefully cancel any active training job before the server exits.
    from app.training.manager import get_job_manager

    await get_job_manager().shutdown()


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

    for router_module in (
        system,
        models,
        datasets,
        training,
        inference,
        arena,
        export,
        recipes,
        history,
    ):
        app.include_router(router_module.router, prefix="/api/v1")

    return app


app = create_app()
