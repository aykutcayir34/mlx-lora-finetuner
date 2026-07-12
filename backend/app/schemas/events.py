import json
from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field, TypeAdapter, ValidationError


class WorkerStarted(BaseModel):
    event: Literal["started"]
    pid: int


class WorkerMetric(BaseModel):
    event: Literal["metric"]
    step: int
    loss: float
    learning_rate: float
    it_per_sec: float
    tokens_per_sec: float
    peak_memory_gb: float


class WorkerValMetric(BaseModel):
    event: Literal["val_metric"]
    step: int
    loss: float


class WorkerCheckpoint(BaseModel):
    event: Literal["checkpoint"]
    step: int
    adapter_path: str


class WorkerDone(BaseModel):
    event: Literal["done"]
    adapter_path: str
    final_train_loss: float | None = None
    final_val_loss: float | None = None


class WorkerError(BaseModel):
    event: Literal["error"]
    message: str
    traceback: str | None = None


WorkerEvent = Annotated[
    Union[
        WorkerStarted,
        WorkerMetric,
        WorkerValMetric,
        WorkerCheckpoint,
        WorkerDone,
        WorkerError,
    ],
    Field(discriminator="event"),
]

_worker_event_adapter = TypeAdapter(WorkerEvent)


def parse_worker_line(line: str) -> WorkerEvent | None:
    try:
        data = json.loads(line)
        return _worker_event_adapter.validate_python(data)
    except (json.JSONDecodeError, ValidationError, TypeError):
        return None
