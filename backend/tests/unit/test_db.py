import aiosqlite
import pytest

from app.db.database import init_db
from app.db.repositories import MetricsRepo, RunsRepo


@pytest.mark.asyncio
async def test_init_db_is_idempotent(tmp_path):
    db_path = tmp_path / "test.db"
    await init_db(db_path)
    # Second call must not raise.
    await init_db(db_path)


@pytest.mark.asyncio
async def test_runs_repo_insert_and_get(tmp_path):
    db_path = tmp_path / "test.db"
    await init_db(db_path)

    async with aiosqlite.connect(db_path) as conn:
        repo = RunsRepo(conn)
        await repo.insert(
            run_id="run_1",
            name="my-run",
            status="queued",
            config_json="{}",
            model_id="mlx-community/x",
            dataset_id="ds_1",
            train_mode="sft",
            created_at="2026-07-12T00:00:00Z",
        )

        run = await repo.get("run_1")
        assert run is not None
        assert run["run_id"] == "run_1"
        assert run["name"] == "my-run"
        assert run["status"] == "queued"
        assert run["model_id"] == "mlx-community/x"
        assert run["dataset_id"] == "ds_1"
        assert run["train_mode"] == "sft"


@pytest.mark.asyncio
async def test_runs_repo_update_status_changes_status(tmp_path):
    db_path = tmp_path / "test.db"
    await init_db(db_path)

    async with aiosqlite.connect(db_path) as conn:
        repo = RunsRepo(conn)
        await repo.insert(
            run_id="run_1",
            name="my-run",
            status="queued",
            config_json="{}",
            model_id="mlx-community/x",
            dataset_id="ds_1",
            train_mode="sft",
            created_at="2026-07-12T00:00:00Z",
        )

        await repo.update_status("run_1", "running")
        run = await repo.get("run_1")
        assert run["status"] == "running"

        await repo.update_status("run_1", "failed", error="boom")
        run = await repo.get("run_1")
        assert run["status"] == "failed"
        assert run["error"] == "boom"


@pytest.mark.asyncio
async def test_runs_repo_list_with_and_without_status_filter(tmp_path):
    db_path = tmp_path / "test.db"
    await init_db(db_path)

    async with aiosqlite.connect(db_path) as conn:
        repo = RunsRepo(conn)
        for i, status in enumerate(["queued", "running", "completed"]):
            await repo.insert(
                run_id=f"run_{i}",
                name=f"run-{i}",
                status=status,
                config_json="{}",
                model_id="mlx-community/x",
                dataset_id="ds_1",
                train_mode="sft",
                created_at=f"2026-07-12T00:00:0{i}Z",
            )

        all_runs, total = await repo.list_()
        assert total == 3
        assert len(all_runs) == 3

        queued_runs, queued_total = await repo.list_(status="queued")
        assert queued_total == 1
        assert len(queued_runs) == 1
        assert queued_runs[0]["run_id"] == "run_0"


@pytest.mark.asyncio
async def test_runs_repo_list_active_only_returns_queued_and_running(tmp_path):
    db_path = tmp_path / "test.db"
    await init_db(db_path)

    async with aiosqlite.connect(db_path) as conn:
        repo = RunsRepo(conn)
        for i, status in enumerate(["queued", "running", "completed", "failed", "cancelled"]):
            await repo.insert(
                run_id=f"run_{i}",
                name=f"run-{i}",
                status=status,
                config_json="{}",
                model_id="mlx-community/x",
                dataset_id="ds_1",
                train_mode="sft",
                created_at=f"2026-07-12T00:00:0{i}Z",
            )

        active = await repo.list_active()
        active_statuses = {run["status"] for run in active}
        assert active_statuses == {"queued", "running"}
        assert len(active) == 2


@pytest.mark.asyncio
async def test_metrics_repo_insert_many_and_list_after_step(tmp_path):
    db_path = tmp_path / "test.db"
    await init_db(db_path)

    async with aiosqlite.connect(db_path) as conn:
        runs_repo = RunsRepo(conn)
        await runs_repo.insert(
            run_id="run_1",
            name="my-run",
            status="running",
            config_json="{}",
            model_id="mlx-community/x",
            dataset_id="ds_1",
            train_mode="sft",
            created_at="2026-07-12T00:00:00Z",
        )

        metrics_repo = MetricsRepo(conn)
        rows = [
            {
                "run_id": "run_1",
                "step": step,
                "kind": kind,
                "loss": 1.0,
                "lr": 1e-5,
                "it_per_sec": 4.2,
                "tokens_per_sec": 512.0,
                "peak_mem": 3.4,
                "ts": "2026-07-12T00:00:00Z",
            }
            for step in (10, 20, 30)
            for kind in ("train", "val")
        ]
        await metrics_repo.insert_many(rows)

        after_10 = await metrics_repo.list_after_step("run_1", after_step=10)
        assert {m["step"] for m in after_10} == {20, 30}
        assert len(after_10) == 4  # 2 kinds x 2 steps

        after_0_train = await metrics_repo.list_after_step("run_1", after_step=0, kind="train")
        assert len(after_0_train) == 3
        assert all(m["kind"] == "train" for m in after_0_train)
        assert [m["step"] for m in after_0_train] == [10, 20, 30]
