# GET /system/health ve GET /system/stats — TAM implementasyon (stub değil, Wave-0 kapsamında).

import os
import shutil
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Annotated

import aiosqlite
import psutil
from fastapi import APIRouter, Depends

from app.config import Settings
from app.db.repositories import RunsRepo
from app.deps import get_current_user, get_db, get_settings

router = APIRouter(dependencies=[Depends(get_current_user)])


def _dir_size_gb(path: Path) -> float:
    if not path.exists():
        return 0.0
    total_bytes = 0
    for dirpath, _dirnames, filenames in os.walk(path):
        for filename in filenames:
            total_bytes += os.path.getsize(os.path.join(dirpath, filename))
    return round(total_bytes / (1024**3), 2)


@router.get("/system/health")
def get_health() -> dict:
    try:
        app_version = version("mlx-lora-finetuner-backend")
    except PackageNotFoundError:
        app_version = "0.1.0"

    try:
        mlx_version = version("mlx")
    except Exception:
        mlx_version = None

    try:
        mlx_lm_lora_version = version("mlx-lm-lora")
    except Exception:
        mlx_lm_lora_version = None

    return {
        "status": "ok",
        "version": app_version,
        "mlx_version": mlx_version,
        "mlx_lm_lora_version": mlx_lm_lora_version,
    }


@router.get("/system/stats")
async def get_stats(
    settings: Annotated[Settings, Depends(get_settings)],
    conn: Annotated[aiosqlite.Connection, Depends(get_db)],
) -> dict:
    mem = psutil.virtual_memory()

    settings.data_dir.mkdir(parents=True, exist_ok=True)
    disk_usage = shutil.disk_usage(settings.data_dir)

    active_runs = await RunsRepo(conn).list_active()
    active_run_id = None
    queued_run_id = None
    for run in active_runs:
        if run["status"] == "running" and active_run_id is None:
            active_run_id = run["run_id"]
        elif run["status"] == "queued" and queued_run_id is None:
            queued_run_id = run["run_id"]
    if active_run_id is None:
        active_run_id = queued_run_id

    return {
        "memory": {
            "total_gb": round(mem.total / (1024**3), 2),
            "used_gb": round(mem.used / (1024**3), 2),
        },
        "disk": {
            "models_gb": _dir_size_gb(settings.models_dir),
            "datasets_gb": _dir_size_gb(settings.datasets_dir),
            "runs_gb": _dir_size_gb(settings.runs_dir),
            "exports_gb": _dir_size_gb(settings.exports_dir),
            "free_gb": round(disk_usage.free / (1024**3), 2),
        },
        "active_run_id": active_run_id,
        "data_dir": str(settings.data_dir),
    }
