"""Eğitim job orkestrasyonu: subprocess spawn, event pump, WS yayını, iptal.

`JobManager`, worker subprocess'ini (`app.training.worker`, veya testlerde
`tests/fixtures/fake_worker.py`) `subprocess.Popen` ile kendi süreç
grubunda başlatır, stdout'unu satır satır okuyup `parse_worker_line` ile
ayrıştırır, sonuçları DB'ye/metrik halka tamponuna yazar ve
`train/{run_id}` WS topic'ine yayınlar.

Modül import edilirken mlx'e dokunulmaz (worker.py'nin aksine, burada zaten
mlx importu yok) — `get_job_manager()` diğer bileşenler tarafından (ör.
inference servisi) hafif bir şekilde import edilebilir olmalı.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import subprocess
import sys
import uuid
from collections import deque
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path

from app.config import Settings, get_settings
from app.core.errors import NotFoundError, TrainingActiveError, ValidationAppError
from app.core.paths import model_dirname
from app.core.process import (
    is_pid_alive,
    kill_process_group,
    read_pid_file,
    spawn_process_group,
    terminate_process_group,
    write_pid_file,
)
from app.core.ws import get_ws_manager
from app.db.database import get_connection
from app.db.repositories import DatasetsRepo, MetricsRepo, RunsRepo
from app.schemas.events import parse_worker_line
from app.schemas.training import JobStatus, MetricEvent, RunSummary, TrainingConfig

logger = logging.getLogger(__name__)

RING_BUFFER_SIZE = 2000

# `train.log` rotates to `train.log.1` (replacing any previous rotation) once
# it grows past this size, so a chatty or very long run cannot fill the disk.
MAX_TRAIN_LOG_BYTES = 10 * 1024 * 1024
LOG_ROTATION_NOTICE = "[log rotated: older lines moved to train.log.1]"
DEFAULT_CANCEL_GRACE_SECONDS = 10.0
ORPHAN_KILL_POLL_SECONDS = 0.1

# docs/api.md: sft: chat|completions|text; dpo|cpo: dpo; orpo: orpo|dpo;
# grpo: grpo; ftpo: ftpo
DATASET_FORMAT_COMPAT: dict[str, set[str]] = {
    "sft": {"chat", "completions", "text"},
    "dpo": {"dpo"},
    "cpo": {"dpo"},
    "orpo": {"orpo", "dpo"},
    "grpo": {"grpo"},
    "ftpo": {"ftpo"},
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _append_log_line(log_path: Path, rotated_path: Path, line: str) -> None:
    """Append one line to the on-disk log, rotating once past the size cap."""
    with log_path.open("ab") as f:
        f.write((line + "\n").encode("utf-8"))
        size = f.tell()
    if size >= MAX_TRAIN_LOG_BYTES:
        log_path.replace(rotated_path)
        log_path.write_text(LOG_ROTATION_NOTICE + "\n")


def _tail_lines(path: Path, max_lines: int) -> list[str]:
    """Read the last `max_lines` lines by seeking from the end of the file.

    Reads backwards in fixed-size chunks instead of loading the whole file —
    `train.log` can be up to MAX_TRAIN_LOG_BYTES while a typical tail is a few
    hundred lines. A decode error from starting mid-multibyte-char can only
    affect the earliest, sliced-off portion of the buffer.
    """
    chunk_size = 8192
    buf = b""
    with path.open("rb") as f:
        f.seek(0, 2)  # os.SEEK_END
        pos = f.tell()
        while pos > 0 and buf.count(b"\n") <= max_lines:
            read_size = min(chunk_size, pos)
            pos -= read_size
            f.seek(pos)
            buf = f.read(read_size) + buf
    lines = buf.decode("utf-8", errors="replace").splitlines()
    return lines[-max_lines:]


def _default_worker_argv() -> list[str]:
    return [sys.executable, "-m", "app.training.worker"]


class JobManager:
    """Tek bir aktif eğitim job'ını yöneten singleton-benzeri orkestratör."""

    def __init__(
        self,
        settings: Settings | None = None,
        worker_argv_factory: Callable[[], list[str]] = _default_worker_argv,
        cancel_grace_seconds: float = DEFAULT_CANCEL_GRACE_SECONDS,
    ) -> None:
        # Stored as the *override*, not the resolved settings: when no explicit
        # settings are given (the production `get_job_manager()` singleton
        # path), we re-resolve `get_settings()` on every access instead of
        # caching it once, so a settings reload (e.g. tests clearing
        # `get_settings.cache_clear()` between runs with a fresh data_dir)
        # is always picked up rather than silently operating on a stale path.
        self._settings_override = settings
        self._worker_argv_factory = worker_argv_factory
        self._cancel_grace_seconds = cancel_grace_seconds

        self._active_run_id: str | None = None
        # Serializes the check-then-insert-then-spawn critical section in
        # `create_job` (and the startup sweep in `reap_orphans`, which also
        # rewrites active-run state). Without it, two concurrent
        # POST /train/jobs can both observe zero active runs and both spawn
        # workers, breaking the single-training-job invariant. Read paths
        # (get_run/list_runs/get_metrics/get_logs) and the shrink-only paths
        # (cancel/_finalize, which never *create* active runs and are
        # idempotent via `_finalized`) deliberately do not take it.
        self._create_lock = asyncio.Lock()
        self._processes: dict[str, subprocess.Popen] = {}
        self._pump_tasks: dict[str, asyncio.Task] = {}
        self._ring_buffers: dict[str, deque] = {}
        self._done_events: dict[str, asyncio.Event] = {}
        self._cancelled: set[str] = set()
        self._finalized: set[str] = set()

    @property
    def _settings(self) -> Settings:
        return self._settings_override or get_settings()

    @property
    def active_run_id(self) -> str | None:
        return self._active_run_id

    def done_event(self, run_id: str) -> asyncio.Event:
        event = self._done_events.get(run_id)
        if event is None:
            event = asyncio.Event()
            self._done_events[run_id] = event
        return event

    # ------------------------------------------------------------------
    # Public API used by app/api/training.py
    # ------------------------------------------------------------------

    async def create_job(self, config: TrainingConfig) -> RunSummary:
        model_dir = self._settings.models_dir / model_dirname(config.model_id)
        if not model_dir.is_dir():
            raise NotFoundError(f"model '{config.model_id}' not found")

        # Everything from the active-run check to the worker spawn must be
        # atomic w.r.t. other create_job calls: `list_active` + `insert` is a
        # classic check-then-act race, and the spawn must happen before the
        # next caller's check so the invariant (at most one queued/running
        # run) holds. The dataset validation reads ride along inside the lock
        # because they share the DB connection; create_job is rare and cheap,
        # so serializing it entirely is fine.
        async with self._create_lock:
            async with get_connection(self._settings.db_path) as conn:
                dataset_row = await DatasetsRepo(conn).get(config.dataset_id)
                if dataset_row is None:
                    raise NotFoundError(f"dataset '{config.dataset_id}' not found")

                train_file = (
                    self._settings.datasets_dir / config.dataset_id / "data" / "train.jsonl"
                )
                if not train_file.is_file():
                    raise ValidationAppError(
                        f"dataset '{config.dataset_id}' has no train split; "
                        "call POST /datasets/{id}/split first"
                    )

                allowed_formats = DATASET_FORMAT_COMPAT[config.train_mode.value]
                if dataset_row["format"] not in allowed_formats:
                    raise ValidationAppError(
                        f"dataset format '{dataset_row['format']}' is not compatible "
                        f"with train_mode '{config.train_mode.value}' "
                        f"(expected one of {sorted(allowed_formats)})"
                    )

                runs_repo = RunsRepo(conn)
                active = await runs_repo.list_active()
                if active:
                    raise TrainingActiveError("a training job is already queued or running")

                run_id = f"run_{uuid.uuid4().hex[:12]}"
                created_at = _now_iso()
                config_json = config.model_dump_json()
                await runs_repo.insert(
                    run_id=run_id,
                    name=config.name,
                    status=JobStatus.QUEUED.value,
                    config_json=config_json,
                    model_id=config.model_id,
                    dataset_id=config.dataset_id,
                    train_mode=config.train_mode.value,
                    created_at=created_at,
                )

            run_dir = self._settings.runs_dir / run_id
            run_dir.mkdir(parents=True, exist_ok=True)
            (run_dir / "config.json").write_text(config_json)

            await self._start_worker(run_id, run_dir)

        return await self.get_run(run_id)

    async def get_run(self, run_id: str) -> RunSummary:
        async with get_connection(self._settings.db_path) as conn:
            row = await RunsRepo(conn).get(run_id)
        if row is None:
            raise NotFoundError(f"run '{run_id}' not found")
        return self._row_to_summary(row)

    async def list_runs(
        self, status: str | None = None, limit: int = 50, offset: int = 0
    ) -> tuple[list[RunSummary], int]:
        async with get_connection(self._settings.db_path) as conn:
            rows, total = await RunsRepo(conn).list_(status=status, limit=limit, offset=offset)
        return [self._row_to_summary(row) for row in rows], total

    async def get_metrics(
        self, run_id: str, after_step: int = 0, kind: str | None = None
    ) -> list[MetricEvent]:
        async with get_connection(self._settings.db_path) as conn:
            rows = await MetricsRepo(conn).list_after_step(run_id, after_step=after_step, kind=kind)
        return [self._metric_row_to_event(row) for row in rows]

    async def get_logs(self, run_id: str, tail: int = 200) -> list[str]:
        run_dir = self._settings.runs_dir / run_id
        if not run_dir.is_dir():
            raise NotFoundError(f"run '{run_id}' not found")
        log_path = run_dir / "train.log"
        if not log_path.is_file():
            return []
        rotated_path = run_dir / "train.log.1"
        if tail and tail > 0:
            lines = _tail_lines(log_path, tail)
            if len(lines) < tail and rotated_path.is_file():
                lines = _tail_lines(rotated_path, tail - len(lines)) + lines
            return lines
        # tail <= 0: everything we still have on disk (bounded by rotation).
        lines = []
        if rotated_path.is_file():
            lines.extend(rotated_path.read_text(errors="replace").splitlines())
        lines.extend(log_path.read_text(errors="replace").splitlines())
        return lines

    async def cancel(self, run_id: str) -> RunSummary:
        async with get_connection(self._settings.db_path) as conn:
            row = await RunsRepo(conn).get(run_id)
        if row is None:
            raise NotFoundError(f"run '{run_id}' not found")

        if row["status"] not in (JobStatus.QUEUED.value, JobStatus.RUNNING.value):
            return self._row_to_summary(row)

        self._cancelled.add(run_id)
        proc = self._processes.get(run_id)
        if proc is not None and proc.poll() is None:
            terminate_process_group(proc.pid)
            asyncio.create_task(self._force_kill_after_grace(run_id, proc))
        else:
            # No live tracked process (e.g. manager restarted) — finalize directly.
            await self._finalize(run_id, JobStatus.CANCELLED)

        return await self.get_run(run_id)

    async def reap_orphans(self) -> None:
        """Startup hook: fail/cancel any run left `queued`/`running` from a crash.

        Holds `_create_lock` so a concurrent `create_job` can neither observe
        a half-swept active set nor insert a fresh run mid-sweep (and so the
        unconditional `_active_run_id = None` below cannot clobber a run being
        started concurrently).
        """
        async with self._create_lock:
            await self._reap_orphans_locked()

    async def _reap_orphans_locked(self) -> None:
        async with get_connection(self._settings.db_path) as conn:
            active_rows = await RunsRepo(conn).list_active()

        for row in active_rows:
            run_id = row["run_id"]
            pid = row["pid"]
            if pid is None:
                pid = read_pid_file(self._settings.runs_dir / run_id / "worker.pid")

            alive = pid is not None and is_pid_alive(pid)
            finished_at = _now_iso()

            async with get_connection(self._settings.db_path) as conn:
                if alive:
                    terminate_process_group(pid)
                    await asyncio.sleep(ORPHAN_KILL_POLL_SECONDS)
                    if is_pid_alive(pid):
                        kill_process_group(pid)
                    await RunsRepo(conn).finish(
                        run_id,
                        JobStatus.CANCELLED.value,
                        finished_at,
                        error="server restarted; orphaned job was cancelled",
                    )
                else:
                    await RunsRepo(conn).finish(
                        run_id,
                        JobStatus.FAILED.value,
                        finished_at,
                        error="worker process was no longer running (server restart)",
                    )

        self._active_run_id = None

    async def shutdown(self) -> None:
        """Gracefully cancel the active job (if any) on server shutdown."""
        for run_id, proc in list(self._processes.items()):
            if proc.poll() is None:
                with contextlib.suppress(NotFoundError):
                    await self.cancel(run_id)

        pending = list(self._pump_tasks.values())
        if pending:
            with contextlib.suppress(asyncio.CancelledError, TimeoutError):
                await asyncio.wait_for(
                    asyncio.gather(*pending, return_exceptions=True),
                    timeout=self._cancel_grace_seconds + 2,
                )

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    async def _start_worker(self, run_id: str, run_dir: Path) -> None:
        argv = [*self._worker_argv_factory(), "--run-dir", str(run_dir)]
        proc = spawn_process_group(argv)

        self._processes[run_id] = proc
        self._cancelled.discard(run_id)
        self._finalized.discard(run_id)
        self._ring_buffers[run_id] = deque(maxlen=RING_BUFFER_SIZE)
        self._done_events[run_id] = asyncio.Event()

        write_pid_file(run_dir / "worker.pid", proc.pid)
        started_at = _now_iso()

        async with get_connection(self._settings.db_path) as conn:
            runs_repo = RunsRepo(conn)
            await runs_repo.set_pid(run_id, proc.pid)
            await conn.execute(
                "UPDATE runs SET started_at = ? WHERE run_id = ?", (started_at, run_id)
            )
            await conn.commit()
            # Status persisted BEFORE broadcasting, per contract.
            await runs_repo.update_status(run_id, JobStatus.RUNNING.value)

        self._active_run_id = run_id
        await get_ws_manager().broadcast(
            f"train/{run_id}", {"type": "status", "status": JobStatus.RUNNING.value, "error": None}
        )

        task = asyncio.create_task(self._pump(run_id, run_dir, proc))
        self._pump_tasks[run_id] = task

    async def _force_kill_after_grace(self, run_id: str, proc: subprocess.Popen) -> None:
        await asyncio.sleep(self._cancel_grace_seconds)
        if proc.poll() is None:
            kill_process_group(proc.pid)

    async def _flush_metrics(self, rows: list[dict]) -> None:
        if not rows:
            return
        async with get_connection(self._settings.db_path) as conn:
            await MetricsRepo(conn).insert_many(rows)

    async def _pump(self, run_id: str, run_dir: Path, proc: subprocess.Popen) -> None:
        loop = asyncio.get_running_loop()
        log_path = run_dir / "train.log"
        ring = self._ring_buffers.setdefault(run_id, deque(maxlen=RING_BUFFER_SIZE))
        ws_manager = get_ws_manager()
        topic = f"train/{run_id}"

        pending_metric_rows: list[dict] = []
        last_raw_lines: deque[str] = deque(maxlen=50)
        saw_terminal_event = False

        rotated_log_path = run_dir / "train.log.1"

        def _append_log(line: str) -> None:
            _append_log_line(log_path, rotated_log_path, line)

        try:
            while True:
                raw = await loop.run_in_executor(None, proc.stdout.readline)
                if raw == "":
                    break
                line = raw.rstrip("\n")
                if line == "":
                    continue

                last_raw_lines.append(line)
                await loop.run_in_executor(None, _append_log, line)

                event = parse_worker_line(line)
                if event is None:
                    frame = {"type": "log_line", "line": line}
                    ring.append(frame)
                    await ws_manager.broadcast(topic, frame)
                    continue

                if event.event == "started":
                    continue

                if event.event == "metric":
                    ts = _now_iso()
                    pending_metric_rows.append(
                        {
                            "run_id": run_id,
                            "step": event.step,
                            "kind": "train",
                            "loss": event.loss,
                            "lr": event.learning_rate,
                            "it_per_sec": event.it_per_sec,
                            "tokens_per_sec": event.tokens_per_sec,
                            "peak_mem": event.peak_memory_gb,
                            "ts": ts,
                        }
                    )
                    metric_event = MetricEvent(
                        run_id=run_id,
                        step=event.step,
                        kind="train",
                        loss=event.loss,
                        learning_rate=event.learning_rate,
                        it_per_sec=event.it_per_sec,
                        tokens_per_sec=event.tokens_per_sec,
                        peak_memory_gb=event.peak_memory_gb,
                        ts=ts,
                    )
                    frame = {"type": "metric", "data": metric_event.model_dump()}
                    ring.append(frame)
                    await ws_manager.broadcast(topic, frame)
                    if len(pending_metric_rows) >= 10:
                        await self._flush_metrics(pending_metric_rows)
                        pending_metric_rows = []

                elif event.event == "val_metric":
                    ts = _now_iso()
                    pending_metric_rows.append(
                        {
                            "run_id": run_id,
                            "step": event.step,
                            "kind": "val",
                            "loss": event.loss,
                            "lr": None,
                            "it_per_sec": None,
                            "tokens_per_sec": None,
                            "peak_mem": None,
                            "ts": ts,
                        }
                    )
                    metric_event = MetricEvent(
                        run_id=run_id, step=event.step, kind="val", loss=event.loss, ts=ts
                    )
                    frame = {"type": "metric", "data": metric_event.model_dump()}
                    ring.append(frame)
                    await ws_manager.broadcast(topic, frame)
                    if len(pending_metric_rows) >= 10:
                        await self._flush_metrics(pending_metric_rows)
                        pending_metric_rows = []

                elif event.event == "checkpoint":
                    frame = {
                        "type": "checkpoint",
                        "step": event.step,
                        "adapter_path": event.adapter_path,
                    }
                    ring.append(frame)
                    await ws_manager.broadcast(topic, frame)

                elif event.event == "done":
                    await self._flush_metrics(pending_metric_rows)
                    pending_metric_rows = []
                    saw_terminal_event = True
                    await self._finalize(
                        run_id,
                        JobStatus.COMPLETED,
                        adapter_path=event.adapter_path,
                        final_train_loss=event.final_train_loss,
                        final_val_loss=event.final_val_loss,
                    )

                elif event.event == "error":
                    await self._flush_metrics(pending_metric_rows)
                    pending_metric_rows = []
                    saw_terminal_event = True
                    await self._finalize(run_id, JobStatus.FAILED, error=event.message)
        finally:
            await self._flush_metrics(pending_metric_rows)
            await loop.run_in_executor(None, proc.wait)
            exit_code = proc.returncode

            if run_id in self._cancelled:
                # Cancellation takes precedence over a nonzero-exit "failed" verdict.
                await self._finalize(run_id, JobStatus.CANCELLED)
            elif not saw_terminal_event:
                if exit_code == 0:
                    await self._finalize(
                        run_id, JobStatus.FAILED, error="worker exited without a done event"
                    )
                else:
                    tail = "\n".join(last_raw_lines)
                    await self._finalize(
                        run_id,
                        JobStatus.FAILED,
                        error=f"worker exited with code {exit_code}:\n{tail}",
                    )

            self._processes.pop(run_id, None)
            self._pump_tasks.pop(run_id, None)

    async def _finalize(
        self,
        run_id: str,
        status: JobStatus,
        *,
        error: str | None = None,
        adapter_path: str | None = None,
        final_train_loss: float | None = None,
        final_val_loss: float | None = None,
    ) -> None:
        if run_id in self._finalized:
            return
        self._finalized.add(run_id)

        finished_at = _now_iso()
        async with get_connection(self._settings.db_path) as conn:
            await RunsRepo(conn).finish(
                run_id,
                status.value,
                finished_at,
                adapter_path=adapter_path,
                final_train_loss=final_train_loss,
                final_val_loss=final_val_loss,
                error=error,
            )

        if self._active_run_id == run_id:
            self._active_run_id = None

        await get_ws_manager().broadcast(
            f"train/{run_id}", {"type": "status", "status": status.value, "error": error}
        )
        self.done_event(run_id).set()

    def _row_to_summary(self, row) -> RunSummary:
        config = TrainingConfig.model_validate(json.loads(row["config_json"]))
        return RunSummary(
            run_id=row["run_id"],
            name=row["name"],
            status=JobStatus(row["status"]),
            config=config,
            created_at=row["created_at"],
            started_at=row["started_at"],
            finished_at=row["finished_at"],
            final_train_loss=row["final_train_loss"],
            final_val_loss=row["final_val_loss"],
            adapter_path=row["adapter_path"],
            error=row["error"],
        )

    @staticmethod
    def _metric_row_to_event(row) -> MetricEvent:
        return MetricEvent(
            run_id=row["run_id"],
            step=row["step"],
            kind=row["kind"],
            loss=row["loss"],
            learning_rate=row["lr"],
            it_per_sec=row["it_per_sec"],
            tokens_per_sec=row["tokens_per_sec"],
            peak_memory_gb=row["peak_mem"],
            ts=row["ts"],
        )


_job_manager: JobManager | None = None


def get_job_manager() -> JobManager:
    """Module-level singleton accessor.

    Also usable as a FastAPI dependency (`Depends(get_job_manager)`) so
    integration tests can swap it out via `app.dependency_overrides`.
    """
    global _job_manager
    if _job_manager is None:
        _job_manager = JobManager()
    return _job_manager


def reset_job_manager() -> None:
    """Test-only helper: drop the singleton so the next call rebuilds it."""
    global _job_manager
    _job_manager = None
