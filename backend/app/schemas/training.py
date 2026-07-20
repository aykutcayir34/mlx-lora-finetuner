import re
from enum import Enum

from pydantic import BaseModel, Field, field_validator, model_validator


class TrainMode(str, Enum):
    SFT = "sft"
    DPO = "dpo"
    ORPO = "orpo"
    CPO = "cpo"
    GRPO = "grpo"
    FTPO = "ftpo"


class SftLossType(str, Enum):
    NLL = "nll"
    CHUNKED_NLL = "chunked_nll"
    DFT = "dft"


class TrainType(str, Enum):
    LORA = "lora"
    DORA = "dora"
    FULL = "full"


# mlx-lm-lora 3.0.0's grpo_reward_functions registry. The worker forwards
# reward_functions verbatim and the library aborts the run on an unknown
# name, so reject typos at request time (docs/api.md pins the same list).
# null / [] means the library uses its default set (all five).
GRPO_REWARD_FUNCTION_NAMES = frozenset(
    {
        "r1_accuracy_reward_func",
        "r1_int_reward_func",
        "r1_strict_format_reward_func",
        "r1_soft_format_reward_func",
        "r1_count_xml",
    }
)


# Contract (docs/api.md): reward file names use the same safe-name charset as
# export names — letters, digits, `.`, `_`, `-`; no path separators or a
# leading `.`/`-`. Shared by the schema validator below and
# `app.services.reward_files_service`.
REWARD_FILE_NAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


class RewardFileInfo(BaseModel):
    """One uploaded custom GRPO reward file (docs/api.md /train/reward-files)."""

    name: str
    functions: list[str]
    uploaded_at: str


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
    gradient_accumulation_steps: int | None = Field(default=None, ge=1)
    beta: float | None = None
    group_size: int | None = None
    temperature: float | None = None
    max_completion_length: int | None = None
    reward_functions: list[str] | None = None
    reward_functions_file: str | None = None
    sft_loss_type: SftLossType | None = None
    lambda_mse_target: float | None = None
    tau_mse_target: float | None = None
    lambda_mse: float | None = None
    clip_epsilon_logits: float | None = None

    @field_validator("reward_functions_file")
    @classmethod
    def normalize_reward_functions_file(cls, value: str | None) -> str | None:
        """Normalize the reference to the stored file's stem.

        docs/api.md: the `.py` extension is optional in the reference, so one
        trailing `.py` is stripped before validation and the config always
        stores/compares on the stem (matching what upload derives from the
        filename and what delete's conflict check compares against).
        """
        if value is None:
            return None
        name = value[:-3] if value.endswith(".py") else value
        if not REWARD_FILE_NAME_PATTERN.match(name):
            raise ValueError(
                "reward_functions_file must be a plain reward file name "
                "(letters, digits, '.', '_', '-'; not starting with '.' or '-')"
            )
        return name

    @model_validator(mode="after")
    def check_mode_conditional_fields(self) -> "TrainingConfig":
        if self.train_mode in (TrainMode.DPO, TrainMode.ORPO, TrainMode.CPO) and self.beta is None:
            raise ValueError("beta is required for dpo/orpo/cpo train_mode")
        if self.train_mode == TrainMode.GRPO and self.group_size is None:
            raise ValueError("group_size is required for grpo train_mode")
        if self.sft_loss_type is not None and self.train_mode != TrainMode.SFT:
            raise ValueError("sft_loss_type is only accepted for sft train_mode")
        if self.reward_functions_file is not None and self.train_mode != TrainMode.GRPO:
            raise ValueError("reward_functions_file is only accepted for grpo train_mode")
        # When a custom reward file is set the registry check is skipped: the
        # file may register new names, so they cannot be validated statically.
        # An unresolvable name then aborts the run at start (reported as a
        # failed run) — docs/api.md documents this trade-off.
        if self.reward_functions and self.reward_functions_file is None:
            unknown = sorted(set(self.reward_functions) - GRPO_REWARD_FUNCTION_NAMES)
            if unknown:
                raise ValueError(
                    f"unknown reward_functions: {', '.join(unknown)} "
                    f"(valid: {', '.join(sorted(GRPO_REWARD_FUNCTION_NAMES))})"
                )
        if self.train_mode != TrainMode.FTPO:
            ftpo_only = {
                "lambda_mse_target": self.lambda_mse_target,
                "tau_mse_target": self.tau_mse_target,
                "lambda_mse": self.lambda_mse,
                "clip_epsilon_logits": self.clip_epsilon_logits,
            }
            offending = sorted(name for name, value in ftpo_only.items() if value is not None)
            if offending:
                raise ValueError(
                    f"{', '.join(offending)} only accepted for ftpo train_mode"
                )
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
