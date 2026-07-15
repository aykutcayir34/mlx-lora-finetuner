#!/usr/bin/env python
"""Standalone fake training worker used by JobManager tests.

Emits scripted JSONL event scenarios on stdout, mirroring the real
`app.training.worker` protocol from docs/api.md, without any MLX
dependency. Driven entirely by environment variables so
`JobManager(worker_argv_factory=...)` can point straight at this script in
`[sys.executable, str(fake_worker.py)]` form.

Env vars:
  FAKE_WORKER_SCENARIO: happy | crash | ignore_sigterm | garbage | null_metrics
      (default: happy)
  FAKE_WORKER_ITERS: number of training metric steps to emit (default: 3)
  FAKE_WORKER_STEP_DELAY: seconds to sleep between emitted lines (default: 0.01)
  FAKE_WORKER_ADAPTER_PATH: adapter_path reported in checkpoint/done events
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import sys
import time


def _emit(obj: dict) -> None:
    print(json.dumps(obj), flush=True)


def _emit_raw(line: str) -> None:
    print(line, flush=True)


def _sleep() -> None:
    delay = float(os.environ.get("FAKE_WORKER_STEP_DELAY", "0.01"))
    if delay > 0:
        time.sleep(delay)


def _adapter_path() -> str:
    return os.environ.get("FAKE_WORKER_ADAPTER_PATH", "/tmp/fake-adapters")


def _metric_frame(step: int, loss: float) -> dict:
    return {
        "event": "metric",
        "step": step,
        "loss": loss,
        "learning_rate": 1e-5,
        "it_per_sec": 4.2,
        "tokens_per_sec": 512.0,
        "peak_memory_gb": 3.4,
    }


def _run_happy(iters: int) -> None:
    _emit({"event": "started", "pid": os.getpid()})
    _sleep()
    for step in range(1, iters + 1):
        _emit(_metric_frame(step, 2.5 - 0.1 * step))
        _sleep()
    _emit({"event": "val_metric", "step": iters, "loss": 2.0})
    _sleep()
    adapter_path = _adapter_path()
    _emit({"event": "checkpoint", "step": iters, "adapter_path": adapter_path})
    _sleep()
    _emit(
        {
            "event": "done",
            "adapter_path": adapter_path,
            "final_train_loss": 2.5 - 0.1 * iters,
            "final_val_loss": 2.0,
        }
    )


def _run_crash(iters: int) -> None:
    _emit({"event": "started", "pid": os.getpid()})
    _sleep()
    for step in range(1, min(iters, 2) + 1):
        _emit(_metric_frame(step, 3.0))
        _sleep()
    # Simulate an uncaught exception's traceback text leaking to the merged
    # stdout/stderr stream (no "error" event — worker just dies).
    print("Traceback (most recent call last):", flush=True)
    print("RuntimeError: synthetic crash for tests", flush=True)
    sys.exit(2)


def _run_ignore_sigterm(iters: int) -> None:
    def _ignore(signum, frame):  # noqa: ARG001
        _emit_raw(f"ignoring signal {signum}")

    signal.signal(signal.SIGTERM, _ignore)
    _emit({"event": "started", "pid": os.getpid()})
    for step in range(1, iters + 1):
        _emit(_metric_frame(step, 3.0))
        _sleep()
    # Keep running past the scripted output so tests can exercise the
    # TERM -> grace -> KILL escalation path.
    while True:
        time.sleep(0.05)


def _run_null_metrics(iters: int) -> None:  # noqa: ARG001 — scripted, fixed line count
    """Metric lines with null optional fields (mlx-lm-lora omitted keys).

    Emits: one fully-populated metric, one metric whose rate/memory fields
    are all null (must still parse as a metric), and one "metric" whose loss
    is null (must fall back to a log_line), then done.
    """
    _emit({"event": "started", "pid": os.getpid()})
    _sleep()
    _emit(_metric_frame(1, 2.5))
    _sleep()
    _emit(
        {
            "event": "metric",
            "step": 2,
            "loss": 2.4,
            "learning_rate": None,
            "it_per_sec": None,
            "tokens_per_sec": None,
            "peak_memory_gb": None,
        }
    )
    _sleep()
    _emit({"event": "metric", "step": 3, "loss": None})
    _sleep()
    _emit(
        {
            "event": "done",
            "adapter_path": _adapter_path(),
            "final_train_loss": 2.4,
            "final_val_loss": None,
        }
    )


def _run_garbage(iters: int) -> None:
    _emit({"event": "started", "pid": os.getpid()})
    _sleep()
    _emit_raw("not json at all")
    _sleep()
    _emit_raw('{"broken": "no event key"}')
    _sleep()
    for step in range(1, iters + 1):
        _emit(_metric_frame(step, 2.5))
        _emit_raw(f"[worker] plain log line at step {step}")
        _sleep()
    _emit(
        {
            "event": "done",
            "adapter_path": _adapter_path(),
            "final_train_loss": 2.0,
            "final_val_loss": None,
        }
    )


_SCENARIOS = {
    "happy": _run_happy,
    "crash": _run_crash,
    "ignore_sigterm": _run_ignore_sigterm,
    "garbage": _run_garbage,
    "null_metrics": _run_null_metrics,
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-dir", required=False, default=None)
    parser.parse_args()

    scenario = os.environ.get("FAKE_WORKER_SCENARIO", "happy")
    iters = int(os.environ.get("FAKE_WORKER_ITERS", "3"))
    fn = _SCENARIOS.get(scenario, _run_happy)
    fn(iters)


if __name__ == "__main__":
    main()
