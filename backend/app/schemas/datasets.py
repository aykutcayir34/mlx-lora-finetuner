from enum import Enum

from pydantic import BaseModel, field_validator, model_validator

# Canonical keys the format detector understands (see
# `dataset_service._detect_format`). `column_map` values are source column
# names in the remote dataset; keys must be one of these.
VALID_COLUMN_MAP_KEYS = {
    "messages",
    "prompt",
    "completion",
    "text",
    "chosen",
    "rejected",
    "preference_score",
    "answer",
    "system",
    "context_with_chat_template",
    "rejected_decoded",
    "multi_chosen_decoded",
}


class DatasetFormat(str, Enum):
    CHAT = "chat"
    COMPLETIONS = "completions"
    TEXT = "text"
    DPO = "dpo"
    ORPO = "orpo"
    GRPO = "grpo"
    FTPO = "ftpo"


class DatasetInfo(BaseModel):
    dataset_id: str
    name: str
    format: DatasetFormat
    path: str
    row_count: int
    splits: dict[str, int] | None = None
    created_at: str


class LineIssue(BaseModel):
    line: int
    message: str


class ValidationReport(BaseModel):
    dataset_id: str
    format: DatasetFormat
    valid_rows: int
    total_rows: int
    errors: list[LineIssue]
    warnings: list[LineIssue]


class SplitRequest(BaseModel):
    train: float
    valid: float
    test: float
    seed: int = 42
    shuffle: bool = True

    @model_validator(mode="after")
    def check_ratios_sum_to_one(self) -> "SplitRequest":
        total = self.train + self.valid + self.test
        if abs(total - 1.0) > 0.001:
            raise ValueError("split ratios must sum to 1.0")
        return self


class PreviewPage(BaseModel):
    rows: list[dict]
    page: int
    size: int
    total_rows: int


# --------------------------------------------------------------------------
# Hugging Face Hub dataset search + streaming/cancellable import
# --------------------------------------------------------------------------


class HFDatasetSearchResult(BaseModel):
    dataset_id: str
    downloads: int
    likes: int
    imported: bool = False


class DatasetSearchResponse(BaseModel):
    results: list[HFDatasetSearchResult]


class DatasetImportRequest(BaseModel):
    dataset_id: str
    config: str | None = None
    split: str = "train"
    name: str | None = None
    max_rows: int | None = None
    column_map: dict[str, str] | None = None

    @field_validator("column_map")
    @classmethod
    def _validate_column_map(cls, v: dict[str, str] | None) -> dict[str, str] | None:
        if v is None:
            return v
        if not v:
            raise ValueError("column_map boş olamaz")
        invalid = sorted(set(v) - VALID_COLUMN_MAP_KEYS)
        if invalid:
            raise ValueError(
                f"geçersiz column_map anahtarı: {', '.join(invalid)} — "
                f"geçerli anahtarlar: {', '.join(sorted(VALID_COLUMN_MAP_KEYS))}"
            )
        return v


class DatasetImportAccepted(BaseModel):
    import_id: str
    dataset_id: str


class DatasetImportInfo(BaseModel):
    import_id: str
    hf_dataset_id: str
    config: str | None = None
    split: str
    status: str
    rows_written: int
    dataset_id: str | None = None
    error: str | None = None
    started_at: str
    finished_at: str | None = None


class DatasetImportsListResponse(BaseModel):
    imports: list[DatasetImportInfo]
