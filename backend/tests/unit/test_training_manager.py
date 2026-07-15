import asyncio
import time

import aiosqlite
import pytest

from app.config import get_settings
from app.core.errors import NotFoundError, TrainingActiveError, ValidationAppError
from app.db.database import init_db
from app.db.repositories import RunsRepo
from app.schemas.training import TrainingConfig
from app.training.manager import JobManager
from tests.fixtures.training_helpers import (
    ensure_data_dirs,
    make_worker_argv_factory,
    setup_dataset,
    setup_model_dir,
)


@pytest.fixture
async def settings(data_dir):
    s = get_settings()
    ensure_data_dirs(s)
    await init_db(s.db_path)
    return s


def make_config(**overrides) -> TrainingConfig:
    base = dict(
        name="test-run",
        model_id="mlx-community/Tiny-1",
        dataset_id="ds_1",
        train_mode="sft",
        train_type="lora",
        batch_size=1,
        iters=3,
    )
    base.update(overrides)
    return TrainingConfig(**base)


async def _run_to_completion(manager: JobManager, run_id: str, timeout: float = 5.0) -> None:
    task = manager._pump_tasks.get(run_id)
    if task is not None:
        await asyncio.wait_for(task, timeout=timeout)
    else:
        await asyncio.wait_for(manager.done_event(run_id).wait(), timeout=timeout)


@pytest.mark.asyncio
async def test_create_job_missing_model_raises_404(settings):
    await setup_dataset(settings)
    manager = JobManager(settings=settings, worker_argv_factory=make_worker_argv_factory("happy"))
    with pytest.raises(NotFoundError):
        await manager.create_job(make_config())


@pytest.mark.asyncio
async def test_create_job_missing_dataset_raises_404(settings):
    setup_model_dir(settings)
    manager = JobManager(settings=settings, worker_argv_factory=make_worker_argv_factory("happy"))
    with pytest.raises(NotFoundError):
        await manager.create_job(make_config())


@pytest.mark.asyncio
async def test_create_job_missing_train_split_raises_422(settings):
    setup_model_dir(settings)
    await setup_dataset(settings)
    # Remove the split file to simulate an un-split dataset.
    (settings.datasets_dir / "ds_1" / "data" / "train.jsonl").unlink()
    manager = JobManager(settings=settings, worker_argv_factory=make_worker_argv_factory("happy"))
    with pytest.raises(ValidationAppError):
        await manager.create_job(make_config())


@pytest.mark.asyncio
async def test_create_job_incompatible_dataset_format_raises_422(settings):
    setup_model_dir(settings)
    await setup_dataset(settings, fmt="dpo")
    manager = JobManager(settings=settings, worker_argv_factory=make_worker_argv_factory("happy"))
    with pytest.raises(ValidationAppError):
        await manager.create_job(make_config(train_mode="sft"))


@pytest.mark.asyncio
async def test_create_job_ftpo_mode_requires_ftpo_dataset(settings):
    setup_model_dir(settings)
    await setup_dataset(settings, fmt="chat")
    manager = JobManager(settings=settings, worker_argv_factory=make_worker_argv_factory("happy"))
    with pytest.raises(ValidationAppError):
        await manager.create_job(make_config(train_mode="ftpo"))


@pytest.mark.asyncio
async def test_create_job_ftpo_dataset_incompatible_with_other_modes(settings):
    setup_model_dir(settings)
    await setup_dataset(settings, fmt="ftpo")
    manager = JobManager(settings=settings, worker_argv_factory=make_worker_argv_factory("happy"))
    with pytest.raises(ValidationAppError):
        await manager.create_job(make_config(train_mode="dpo", beta=0.1))


@pytest.mark.asyncio
async def test_create_job_ftpo_mode_accepts_ftpo_dataset(settings):
    setup_model_dir(settings)
    await setup_dataset(settings, fmt="ftpo")
    manager = JobManager(
        settings=settings,
        worker_argv_factory=make_worker_argv_factory(
            "happy", FAKE_WORKER_ITERS=1, FAKE_WORKER_STEP_DELAY=0.0
        ),
    )

    summary = await manager.create_job(make_config(train_mode="ftpo", iters=1))
    assert summary.status.value in ("queued", "running")
    await _run_to_completion(manager, summary.run_id)

    final = await manager.get_run(summary.run_id)
    assert final.status.value == "completed"


@pytest.mark.asyncio
async def test_happy_path_state_machine_and_metrics_and_ring_buffer(settings):
    setup_model_dir(settings)
    await setup_dataset(settings)
    manager = JobManager(
        settings=settings,
        worker_argv_factory=make_worker_argv_factory("happy", FAKE_WORKER_ITERS=3, FAKE_WORKER_STEP_DELAY=0.0),
    )

    summary = await manager.create_job(make_config(iters=3))
    assert summary.status.value == "running"
    assert summary.started_at is not None

    await _run_to_completion(manager, summary.run_id)

    final = await manager.get_run(summary.run_id)
    assert final.status.value == "completed"
    assert final.adapter_path == "/tmp/fake-adapters"
    assert final.final_train_loss is not None
    assert final.final_val_loss == 2.0
    assert final.finished_at is not None

    train_metrics = await manager.get_metrics(summary.run_id, kind="train")
    assert len(train_metrics) == 3
    assert [m.step for m in train_metrics] == [1, 2, 3]

    val_metrics = await manager.get_metrics(summary.run_id, kind="val")
    assert len(val_metrics) == 1

    after_1 = await manager.get_metrics(summary.run_id, after_step=1, kind="train")
    assert [m.step for m in after_1] == [2, 3]

    ring = manager._ring_buffers[summary.run_id]
    assert len(ring) > 0
    assert any(frame["type"] == "checkpoint" for frame in ring)

    logs = await manager.get_logs(summary.run_id)
    assert any('"event": "done"' in line for line in logs)


@pytest.mark.asyncio
async def test_second_job_conflicts_while_first_active(settings):
    setup_model_dir(settings)
    await setup_dataset(settings)
    manager = JobManager(
        settings=settings,
        worker_argv_factory=make_worker_argv_factory(
            "ignore_sigterm", FAKE_WORKER_ITERS=1000, FAKE_WORKER_STEP_DELAY=0.01
        ),
        cancel_grace_seconds=0.2,
    )
    first = await manager.create_job(make_config())
    with pytest.raises(TrainingActiveError):
        await manager.create_job(make_config(name="second"))

    # Cleanup: don't leak a lingering ignore-SIGTERM subprocess past the test.
    await manager.cancel(first.run_id)
    await _run_to_completion(manager, first.run_id, timeout=5.0)


@pytest.mark.asyncio
async def test_cancel_graceful_term_is_honored_quickly(settings):
    setup_model_dir(settings)
    await setup_dataset(settings)
    manager = JobManager(
        settings=settings,
        worker_argv_factory=make_worker_argv_factory(
            "happy", FAKE_WORKER_ITERS=50, FAKE_WORKER_STEP_DELAY=0.05
        ),
        cancel_grace_seconds=5.0,
    )
    summary = await manager.create_job(make_config())
    await asyncio.sleep(0.1)

    start = time.monotonic()
    result = await manager.cancel(summary.run_id)
    assert result.status.value in ("running", "cancelled")

    await asyncio.wait_for(manager.done_event(summary.run_id).wait(), timeout=2.0)
    elapsed = time.monotonic() - start

    final = await manager.get_run(summary.run_id)
    assert final.status.value == "cancelled"
    # The "happy" scenario has no SIGTERM trap, so the default disposition
    # kills it well before the 5s grace/SIGKILL timer would fire.
    assert elapsed < 2.0


@pytest.mark.asyncio
async def test_cancel_forced_kill_after_grace(settings):
    setup_model_dir(settings)
    await setup_dataset(settings)
    manager = JobManager(
        settings=settings,
        worker_argv_factory=make_worker_argv_factory(
            "ignore_sigterm", FAKE_WORKER_ITERS=3, FAKE_WORKER_STEP_DELAY=0.01
        ),
        cancel_grace_seconds=0.5,
    )
    summary = await manager.create_job(make_config())
    await asyncio.sleep(0.2)

    start = time.monotonic()
    await manager.cancel(summary.run_id)
    await asyncio.wait_for(manager.done_event(summary.run_id).wait(), timeout=3.0)
    elapsed = time.monotonic() - start

    final = await manager.get_run(summary.run_id)
    assert final.status.value == "cancelled"
    assert elapsed >= 0.5


@pytest.mark.asyncio
async def test_crash_mid_run_marks_failed_with_tail_in_error(settings):
    setup_model_dir(settings)
    await setup_dataset(settings)
    manager = JobManager(
        settings=settings,
        worker_argv_factory=make_worker_argv_factory("crash", FAKE_WORKER_ITERS=5, FAKE_WORKER_STEP_DELAY=0.0),
    )
    summary = await manager.create_job(make_config())
    await _run_to_completion(manager, summary.run_id)

    final = await manager.get_run(summary.run_id)
    assert final.status.value == "failed"
    assert final.error is not None
    assert "synthetic crash" in final.error


@pytest.mark.asyncio
async def test_garbage_lines_become_log_lines_and_job_still_completes(settings):
    setup_model_dir(settings)
    await setup_dataset(settings)
    manager = JobManager(
        settings=settings,
        worker_argv_factory=make_worker_argv_factory("garbage", FAKE_WORKER_ITERS=2, FAKE_WORKER_STEP_DELAY=0.0),
    )
    summary = await manager.create_job(make_config())
    await _run_to_completion(manager, summary.run_id)

    ring = manager._ring_buffers[summary.run_id]
    assert any(frame["type"] == "log_line" and "not json at all" in frame["line"] for frame in ring)

    logs = await manager.get_logs(summary.run_id)
    assert any("not json at all" in line for line in logs)

    final = await manager.get_run(summary.run_id)
    assert final.status.value == "completed"


@pytest.mark.asyncio
async def test_list_and_get_runs(settings):
    setup_model_dir(settings)
    await setup_dataset(settings)
    manager = JobManager(
        settings=settings,
        worker_argv_factory=make_worker_argv_factory("happy", FAKE_WORKER_ITERS=1, FAKE_WORKER_STEP_DELAY=0.0),
    )
    summary = await manager.create_job(make_config())
    await _run_to_completion(manager, summary.run_id)

    runs, total = await manager.list_runs()
    assert total == 1
    assert runs[0].run_id == summary.run_id

    with pytest.raises(NotFoundError):
        await manager.get_run("run_does_not_exist")


@pytest.mark.asyncio
async def test_reap_orphans_dead_pid_marks_failed(settings):
    async with aiosqlite.connect(settings.db_path) as conn:
        repo = RunsRepo(conn)
        await repo.insert(
            run_id="run_dead",
            name="x",
            status="running",
            config_json=make_config().model_dump_json(),
            model_id="mlx-community/Tiny-1",
            dataset_id="ds_1",
            train_mode="sft",
            created_at="2026-07-12T00:00:00Z",
        )
        await repo.set_pid("run_dead", 999_999_999)

    manager = JobManager(settings=settings)
    await manager.reap_orphans()

    run = await manager.get_run("run_dead")
    assert run.status.value == "failed"
    assert run.error is not None


@pytest.mark.asyncio
async def test_reap_orphans_alive_process_marks_cancelled(settings):
    import subprocess
    import sys

    proc = subprocess.Popen(
        [sys.executable, "-c", "import time; time.sleep(30)"], start_new_session=True
    )
    try:
        async with aiosqlite.connect(settings.db_path) as conn:
            repo = RunsRepo(conn)
            await repo.insert(
                run_id="run_alive",
                name="x",
                status="running",
                config_json=make_config().model_dump_json(),
                model_id="mlx-community/Tiny-1",
                dataset_id="ds_1",
                train_mode="sft",
                created_at="2026-07-12T00:00:00Z",
            )
            await repo.set_pid("run_alive", proc.pid)

        manager = JobManager(settings=settings)
        await manager.reap_orphans()

        run = await manager.get_run("run_alive")
        assert run.status.value == "cancelled"

        proc.wait(timeout=2)
        assert proc.poll() is not None
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait()


# ---------------------------------------------------------------------------
# Log rotation + efficient tail (issue #7)
# ---------------------------------------------------------------------------


def test_append_log_line_rotates_past_cap(tmp_path, monkeypatch):
    from app.training import manager as manager_module
    from app.training.manager import LOG_ROTATION_NOTICE, _append_log_line

    monkeypatch.setattr(manager_module, "MAX_TRAIN_LOG_BYTES", 200)
    log_path = tmp_path / "train.log"
    rotated_path = tmp_path / "train.log.1"

    lines = [f"line-{i:03d} {'x' * 20}" for i in range(30)]
    for line in lines:
        _append_log_line(log_path, rotated_path, line)

    assert rotated_path.is_file()
    current = log_path.read_text().splitlines()
    assert current[0] == LOG_ROTATION_NOTICE

    # Nothing that survives rotation is lost or reordered: the rotated file
    # plus the current file cover a contiguous suffix of what was written.
    kept = [
        line
        for line in rotated_path.read_text().splitlines() + current
        if line != LOG_ROTATION_NOTICE
    ]
    assert kept == lines[len(lines) - len(kept):]
    # And the current file is small again (fresh after the last rotation).
    assert log_path.stat().st_size < 200


def test_tail_lines_returns_exact_suffix(tmp_path):
    from app.training.manager import _tail_lines

    path = tmp_path / "train.log"
    lines = [f"line-{i:05d}" for i in range(5000)]
    path.write_text("\n".join(lines) + "\n")

    assert _tail_lines(path, 200) == lines[-200:]
    assert _tail_lines(path, 5) == lines[-5:]
    assert _tail_lines(path, 10_000) == lines  # tail larger than the file


@pytest.mark.asyncio
async def test_get_logs_tail_spans_rotation(settings):
    manager = JobManager(settings=settings)
    run_dir = settings.runs_dir / "run_rotated"
    run_dir.mkdir(parents=True)

    rotated_lines = [f"old-{i:03d}" for i in range(100)]
    (run_dir / "train.log.1").write_text("\n".join(rotated_lines) + "\n")
    current_lines = ["[log rotated: older lines moved to train.log.1]"] + [
        f"new-{i:03d}" for i in range(10)
    ]
    (run_dir / "train.log").write_text("\n".join(current_lines) + "\n")

    tail = await manager.get_logs("run_rotated", tail=50)
    assert len(tail) == 50
    assert tail == rotated_lines[-39:] + current_lines

    # A tail smaller than the current file never touches the rotated log.
    short = await manager.get_logs("run_rotated", tail=5)
    assert short == current_lines[-5:]
