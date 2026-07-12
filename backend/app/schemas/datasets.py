from enum import Enum

from pydantic import BaseModel, model_validator


class DatasetFormat(str, Enum):
    CHAT = "chat"
    COMPLETIONS = "completions"
    TEXT = "text"
    DPO = "dpo"
    ORPO = "orpo"
    GRPO = "grpo"


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
