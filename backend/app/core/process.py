"""Eğitim/export subprocess yönetimi (spawn, izleme, iptal).

Process-group spawn/kill yardımcıları ve PID-file okuma/yazma. Tüm eğitim
worker'ları `start_new_session=True` ile kendi süreç grubunda başlatılır ki
`os.killpg` ile tüm alt-süreçleriyle birlikte güvenle sonlandırılabilsinler.
"""

from __future__ import annotations

import os
import signal
import subprocess
from pathlib import Path


def spawn_process_group(argv: list[str], **popen_kwargs: object) -> subprocess.Popen:
    """Start `argv` in its own process group with stdout+stderr merged and piped.

    Callers may override any of the default Popen kwargs (e.g. `cwd`, `env`).
    """
    kwargs: dict[str, object] = {
        "stdout": subprocess.PIPE,
        "stderr": subprocess.STDOUT,
        "text": True,
        "start_new_session": True,
    }
    kwargs.update(popen_kwargs)
    return subprocess.Popen(argv, **kwargs)  # type: ignore[arg-type]


def write_pid_file(path: Path, pid: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(str(pid))


def read_pid_file(path: Path) -> int | None:
    try:
        return int(path.read_text().strip())
    except (FileNotFoundError, ValueError):
        return None


def is_pid_alive(pid: int) -> bool:
    """Best-effort liveness check for a PID via signal 0."""
    if pid is None or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        # Process exists but is owned by someone else — treat as alive.
        return True
    return True


def terminate_process_group(pid: int) -> None:
    """Send SIGTERM to the whole process group rooted at `pid`."""
    try:
        os.killpg(os.getpgid(pid), signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        pass


def kill_process_group(pid: int) -> None:
    """Send SIGKILL to the whole process group rooted at `pid`."""
    try:
        os.killpg(os.getpgid(pid), signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass
