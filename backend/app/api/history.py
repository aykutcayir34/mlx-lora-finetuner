"""Run history: GET /runs/history (filter/sort/paginate) and clone (docs/api.md "Run History").

No new business-logic layer needed: this router talks to `RunsRepo` directly
(same pattern as `app/api/system.py`) and reuses the row->RunSummary mapping
that `JobManager._row_to_summary` also implements.
"""

from __future__ import annotations

import json
from typing import Annotated

import aiosqlite
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.errors import NotFoundError, ValidationAppError
from app.db.repositories import RunsRepo
from app.deps import get_current_user, get_db
from app.schemas.training import JobStatus, RunSummary, TrainingConfig

router = APIRouter(dependencies=[Depends(get_current_user)])

# sort query param -> trusted ORDER BY fragment. NULLs sort last regardless
# of direction (`(final_train_loss IS NULL) ASC` buckets non-null rows first).
SORT_WHITELIST: dict[str, str] = {
    "created_at": "created_at ASC",
    "-created_at": "created_at DESC",
    "final_train_loss": "(final_train_loss IS NULL) ASC, final_train_loss ASC",
    "-final_train_loss": "(final_train_loss IS NULL) ASC, final_train_loss DESC",
}
DEFAULT_SORT = "-created_at"


class RunHistoryResponse(BaseModel):
    runs: list[RunSummary]
    total: int


def _row_to_summary(row: dict) -> RunSummary:
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


@router.get("/runs/history", response_model=RunHistoryResponse)
async def run_history(
    conn: Annotated[aiosqlite.Connection, Depends(get_db)],
    model_id: str | None = None,
    train_mode: str | None = None,
    status: str | None = None,
    sort: str = DEFAULT_SORT,
    limit: int = 50,
    offset: int = 0,
) -> RunHistoryResponse:
    if sort not in SORT_WHITELIST:
        raise ValidationAppError(
            f"invalid sort '{sort}'; expected one of {sorted(SORT_WHITELIST)}"
        )

    rows, total = await RunsRepo(conn).list_history(
        model_id=model_id,
        train_mode=train_mode,
        status=status,
        order_by=SORT_WHITELIST[sort],
        limit=limit,
        offset=offset,
    )
    return RunHistoryResponse(runs=[_row_to_summary(row) for row in rows], total=total)


@router.post("/train/jobs/{run_id}/clone", response_model=TrainingConfig)
async def clone_run(
    run_id: str,
    conn: Annotated[aiosqlite.Connection, Depends(get_db)],
) -> TrainingConfig:
    row = await RunsRepo(conn).get(run_id)
    if row is None:
        raise NotFoundError(f"run '{run_id}' not found")
    return TrainingConfig.model_validate(json.loads(row["config_json"]))
