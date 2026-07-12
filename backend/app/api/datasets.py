# TODO(Wave-1 T2): dataset upload/validate/split business logic.

from fastapi import APIRouter, Depends, File, Form, UploadFile
from pydantic import BaseModel

from app.core.errors import AppError
from app.deps import get_current_user
from app.schemas.datasets import (
    DatasetInfo,
    PreviewPage,
    SplitRequest,
    ValidationReport,
)

router = APIRouter(dependencies=[Depends(get_current_user)])


class DatasetsListResponse(BaseModel):
    datasets: list[DatasetInfo]


@router.get("/datasets", response_model=DatasetsListResponse)
def list_datasets() -> DatasetsListResponse:
    raise AppError(message="dataset listeleme henüz uygulanmadı", code="not_implemented", status_code=501)


@router.post("/datasets/upload", response_model=DatasetInfo)
def upload_dataset(
    file: UploadFile = File(...),
    name: str | None = Form(None),
) -> DatasetInfo:
    raise AppError(message="dataset yükleme henüz uygulanmadı", code="not_implemented", status_code=501)


@router.post("/datasets/{id}/validate", response_model=ValidationReport)
def validate_dataset(id: str) -> ValidationReport:
    raise AppError(message="dataset doğrulama henüz uygulanmadı", code="not_implemented", status_code=501)


@router.post("/datasets/{id}/split", response_model=DatasetInfo)
def split_dataset(id: str, body: SplitRequest) -> DatasetInfo:
    raise AppError(message="dataset bölme henüz uygulanmadı", code="not_implemented", status_code=501)


@router.get("/datasets/{id}/preview", response_model=PreviewPage)
def preview_dataset(
    id: str,
    split: str = "raw",
    page: int = 1,
    size: int = 20,
) -> PreviewPage:
    raise AppError(message="dataset önizleme henüz uygulanmadı", code="not_implemented", status_code=501)


@router.delete("/datasets/{id}")
def delete_dataset(id: str) -> None:
    raise AppError(message="dataset silme henüz uygulanmadı", code="not_implemented", status_code=501)
