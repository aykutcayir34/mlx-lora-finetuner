"""Dataset upload/validate/split/preview HTTP endpoints (Wave-1 T3)."""

import aiosqlite
from fastapi import APIRouter, Depends, File, Form, UploadFile
from pydantic import BaseModel

from app.db.repositories import DatasetsRepo, RunsRepo
from app.deps import get_current_user, get_db
from app.schemas.datasets import (
    DatasetInfo,
    PreviewPage,
    SplitRequest,
    ValidationReport,
)
from app.services.dataset_service import DatasetService, get_dataset_service

router = APIRouter(dependencies=[Depends(get_current_user)])


class DatasetsListResponse(BaseModel):
    datasets: list[DatasetInfo]


@router.get("/datasets", response_model=DatasetsListResponse)
async def list_datasets(
    db: aiosqlite.Connection = Depends(get_db),
    service: DatasetService = Depends(get_dataset_service),
) -> DatasetsListResponse:
    datasets = await service.list_datasets(DatasetsRepo(db))
    return DatasetsListResponse(datasets=datasets)


@router.post("/datasets/upload", response_model=DatasetInfo, status_code=201)
async def upload_dataset(
    file: UploadFile = File(...),
    name: str | None = Form(None),
    db: aiosqlite.Connection = Depends(get_db),
    service: DatasetService = Depends(get_dataset_service),
) -> DatasetInfo:
    return await service.upload(DatasetsRepo(db), file, name)


@router.post("/datasets/{id}/validate", response_model=ValidationReport)
async def validate_dataset(
    id: str,
    db: aiosqlite.Connection = Depends(get_db),
    service: DatasetService = Depends(get_dataset_service),
) -> ValidationReport:
    return await service.validate(DatasetsRepo(db), id)


@router.post("/datasets/{id}/split", response_model=DatasetInfo)
async def split_dataset(
    id: str,
    body: SplitRequest,
    db: aiosqlite.Connection = Depends(get_db),
    service: DatasetService = Depends(get_dataset_service),
) -> DatasetInfo:
    return await service.split(DatasetsRepo(db), id, body)


@router.get("/datasets/{id}/preview", response_model=PreviewPage)
async def preview_dataset(
    id: str,
    split: str = "raw",
    page: int = 1,
    size: int = 20,
    db: aiosqlite.Connection = Depends(get_db),
    service: DatasetService = Depends(get_dataset_service),
) -> PreviewPage:
    return await service.preview(DatasetsRepo(db), id, split, page, size)


@router.delete("/datasets/{id}", status_code=204)
async def delete_dataset(
    id: str,
    db: aiosqlite.Connection = Depends(get_db),
    service: DatasetService = Depends(get_dataset_service),
) -> None:
    await service.delete(DatasetsRepo(db), RunsRepo(db), id)
