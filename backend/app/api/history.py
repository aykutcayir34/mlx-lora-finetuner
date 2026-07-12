# Faz-2 T18 replaces this stub with run-history queries and clone (docs/api.md "Run History").

from fastapi import APIRouter, Depends

from app.core.errors import AppError
from app.deps import get_current_user

router = APIRouter(dependencies=[Depends(get_current_user)])

def _not_implemented() -> AppError:
    return AppError("Run history arrives in Faz 2", code="not_implemented", status_code=501)


@router.get("/runs/history")
async def run_history() -> None:
    raise _not_implemented()


@router.post("/train/jobs/{run_id}/clone")
async def clone_run(run_id: str) -> None:
    raise _not_implemented()
