# Faz-2 T16 replaces this stub with document→dataset conversion (docs/api.md "Data Recipes").

from fastapi import APIRouter, Depends

from app.core.errors import AppError
from app.deps import get_current_user

router = APIRouter(dependencies=[Depends(get_current_user)])

def _not_implemented() -> AppError:
    return AppError("Data Recipes arrives in Faz 2", code="not_implemented", status_code=501)


@router.post("/recipes/convert", status_code=202)
async def convert_document() -> None:
    raise _not_implemented()


@router.get("/recipes/jobs/{recipe_job_id}")
async def get_recipe_job(recipe_job_id: str) -> None:
    raise _not_implemented()
