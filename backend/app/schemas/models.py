from typing import Literal

from pydantic import BaseModel

DownloadStatus = Literal["running", "completed", "failed", "cancelled"]


class Quantization(BaseModel):
    bits: int
    group_size: int


class ModelInfo(BaseModel):
    model_id: str
    path: str
    size_bytes: int
    model_type: str
    quantization: Quantization | None = None
    downloaded_at: str


class HFSearchResult(BaseModel):
    model_id: str
    downloads: int
    likes: int
    size_bytes: int | None = None
    downloaded: bool = False


class DownloadRequest(BaseModel):
    model_id: str


class DownloadInfo(BaseModel):
    download_id: str
    model_id: str
    status: DownloadStatus
    bytes_done: int
    bytes_total: int
    files_done: int
    files_total: int
    error: str | None = None
    started_at: str
    finished_at: str | None = None
