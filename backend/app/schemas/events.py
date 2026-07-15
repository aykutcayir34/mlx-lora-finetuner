import json
from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field, TypeAdapter, ValidationError


class WorkerStarted(BaseModel):
    event: Literal["started"]
    pid: int


class WorkerMetric(BaseModel):
    """Train-metric line from the worker.

    The rate/memory fields are nullable: `WorkerCallback.on_train_loss_report`
    forwards `train_info.get(...)` values, and mlx-lm-lora may omit any of
    those keys — a missing rate must not make the whole metric unparseable
    (it would silently degrade to a `log_line`). `step` and `loss` stay
    required: a metric without them is unusable, so such a line intentionally
    falls back to `log_line`. Mirrors `MetricEvent`, which is nullable
    end-to-end (docs/api.md: "rate fields may be null").
    """

    event: Literal["metric"]
    step: int
    loss: float
    learning_rate: float | None = None
    it_per_sec: float | None = None
    tokens_per_sec: float | None = None
    peak_memory_gb: float | None = None


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
