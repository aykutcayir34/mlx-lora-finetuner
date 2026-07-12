from enum import Enum

from pydantic import BaseModel, Field, model_validator


class TrainMode(str, Enum):
    SFT = "sft"
    DPO = "dpo"
    ORPO = "orpo"
    CPO = "cpo"
    GRPO = "grpo"


class TrainType(str, Enum):
    LORA = "lora"
    DORA = "dora"
    FULL = "full"


class JobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class LoraParams(BaseModel):
    rank: int = 8
    scale: float = 20.0
    dropout: float = 0.0


class TrainingConfig(BaseModel):
    name: str
    model_id: str
    dataset_id: str
    train_mode: TrainMode
    train_type: TrainType = TrainType.LORA
    batch_size: int = 1
    iters: int = 600
    learning_rate: float = 1e-5
    max_seq_length: int = 2048
    num_layers: int = 16
    lora: LoraParams = Field(default_factory=LoraParams)
    optimizer: str = "adamw"
    lr_schedule: str = "cosine"
    load_in_bits: int | None = None
    grad_checkpoint: bool = False
    save_every: int = 100
    steps_per_report: int = 10
    steps_per_eval: int = 100
    val_batches: int = 25
    seed: int = 42
    beta: float | None = None
    group_size: int | None = None
    temperature: float | None = None
    max_completion_length: int | None = None
    reward_functions: list[str] | None = None

    @model_validator(mode="after")
    def check_beta_and_group_size(self) -> "TrainingConfig":
        if self.train_mode in (TrainMode.DPO, TrainMode.ORPO, TrainMode.CPO) and self.beta is None:
            raise ValueError("beta is required for dpo/orpo/cpo train_mode")
        if self.train_mode == TrainMode.GRPO and self.group_size is None:
            raise ValueError("group_size is required for grpo train_mode")
        return self


class MetricEvent(BaseModel):
    run_id: str
    step: int
    kind: str
    loss: float | None = None
    learning_rate: float | None = None
    it_per_sec: float | None = None
    tokens_per_sec: float | None = None
    peak_memory_gb: float | None = None
    ts: str


class RunSummary(BaseModel):
    run_id: str
    name: str
    status: JobStatus
    config: TrainingConfig
    created_at: str
    started_at: str | None = None
    finished_at: str | None = None
    final_train_loss: float | None = None
    final_val_loss: float | None = None
    adapter_path: str | None = None
    error: str | None = None
