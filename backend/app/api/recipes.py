"""Data Recipes HTTP endpoints (Faz-2 T16): document -> dataset conversion."""

import aiosqlite
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, UploadFile
from pydantic import BaseModel

from app.deps import get_current_user, get_db
from app.services.recipe_service import RecipeJobInfo, RecipeService, get_recipe_service

router = APIRouter(dependencies=[Depends(get_current_user)])


class RecipeConvertResponse(BaseModel):
    recipe_job_id: str
    name: str


@router.post("/recipes/convert", response_model=RecipeConvertResponse, status_code=202)
async def convert_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    name: str = Form(...),
    output_format: str = Form(...),
    chunk_size: int = Form(2000),
    chunk_overlap: int = Form(200),
    prompt_column: str | None = Form(None),
    completion_column: str | None = Form(None),
    system_prompt: str | None = Form(None),
    db: aiosqlite.Connection = Depends(get_db),
    service: RecipeService = Depends(get_recipe_service),
) -> dict:
    return await service.start_convert(
        db,
        background_tasks,
        file=file,
        name=name,
        output_format=output_format,
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        prompt_column=prompt_column,
        completion_column=completion_column,
        system_prompt=system_prompt,
    )


@router.get("/recipes/jobs/{recipe_job_id}", response_model=RecipeJobInfo)
async def get_recipe_job(
    recipe_job_id: str,
    db: aiosqlite.Connection = Depends(get_db),
    service: RecipeService = Depends(get_recipe_service),
) -> RecipeJobInfo:
    return await service.get_job(db, recipe_job_id)
