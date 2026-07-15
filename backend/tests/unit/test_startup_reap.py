"""Startup reaping of background-job rows stranded `running` by a restart.

Downloads, dataset imports, exports and recipe jobs run as in-process tasks
that never survive a restart; `app.main.reap_orphans` must mark their stale
`running` rows `failed` so the `get_active_*` duplicate guards stop returning
409 for the same model/dataset forever.
"""

import aiosqlite
import pytest

from app.config import get_settings
from app.db.database import init_db
from app.db.repositories import (
    DatasetImportsRepo,
    DownloadsRepo,
    ExportsRepo,
    RecipeJobsRepo,
)
from app.training import manager as manager_module

TS = "2026-07-14T00:00:00.000Z"


async def _seed_stale_rows(db_path) -> None:
    async with aiosqlite.connect(db_path) as conn:
        downloads = DownloadsRepo(conn)
        await downloads.insert("dl_stale", "mlx-community/Tiny-1", "running", 1, 2, 1, 2, TS)
        await downloads.insert("dl_done", "mlx-community/Tiny-2", "running", 2, 2, 2, 2, TS)
        await downloads.finish("dl_done", "completed", TS)
        await DatasetImportsRepo(conn).insert(
            "imp_stale", "org/some-data", None, "train", "some-data", None, "running", TS
        )
        await ExportsRepo(conn).insert("exp_stale", "fuse", "running", TS)
        await RecipeJobsRepo(conn).insert("rcp_stale", "doc-to-dataset", "running", TS)


@pytest.mark.asyncio
async def test_reap_orphans_fails_stale_background_jobs(data_dir):
    from app.main import reap_orphans

    settings = get_settings()
    await init_db(settings.db_path)
    await _seed_stale_rows(settings.db_path)

    manager_module.reset_job_manager()
    await reap_orphans()

    async with aiosqlite.connect(settings.db_path) as conn:
        downloads = DownloadsRepo(conn)
        stale_download = await downloads.get("dl_stale")
        assert stale_download["status"] == "failed"
        assert stale_download["error"] == "interrupted by server restart"
        assert stale_download["finished_at"] is not None

        # Terminal rows are untouched.
        done_download = await downloads.get("dl_done")
        assert done_download["status"] == "completed"
        assert done_download["error"] is None

        stale_import = await DatasetImportsRepo(conn).get("imp_stale")
        assert stale_import["status"] == "failed"
        assert stale_import["error"] == "interrupted by server restart"

        stale_export = await ExportsRepo(conn).get("exp_stale")
        assert stale_export["status"] == "failed"
        assert stale_export["error"] == "interrupted by server restart"

        stale_recipe = await RecipeJobsRepo(conn).get("rcp_stale")
        assert stale_recipe["status"] == "failed"
        assert stale_recipe["error"] == "interrupted by server restart"

        # The duplicate guards that previously produced permanent 409s are clear.
        assert await downloads.get_active_by_model("mlx-community/Tiny-1") is None
        assert (
            await DatasetImportsRepo(conn).get_active_by_hf_id("org/some-data") is None
        )
