"""YAML config export/import (docs/api.md: GET /train/jobs/{run_id}/config.yaml,
POST /train/configs/import).

Pure yaml+pydantic — no mlx imports, safe to load on the Linux CI runner.
"""

from __future__ import annotations

from datetime import UTC, datetime
from importlib.metadata import PackageNotFoundError, version

import yaml
from pydantic import ValidationError

from app.core.errors import ValidationAppError
from app.schemas.training import RunSummary, TrainingConfig

# The one and only supported document schema version. Bump when the document
# layout (not the TrainingConfig fields — those validate themselves) changes.
CONFIG_SCHEMA_VERSION = 1


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _app_version() -> str:
    try:
        return version("mlx-lora-finetuner-backend")
    except PackageNotFoundError:
        return "0.1.0"


def _mlx_lm_lora_version() -> str | None:
    try:
        return version("mlx-lm-lora")
    except Exception:
        return None


def _format_pydantic_error(exc: ValidationError) -> str:
    parts = []
    for err in exc.errors():
        loc = ".".join(str(part) for part in err["loc"])
        parts.append(f"{loc}: {err['msg']}" if loc else err["msg"])
    return "; ".join(parts)


def render_config_yaml(run: RunSummary) -> str:
    """Render a run's configuration as the documented YAML export document.

    `config:` carries exactly `TrainingConfig.model_dump(mode="json")` (enums
    as strings); `metadata:` is informational only and ignored on import.
    `sort_keys=False` keeps the field order of the models.
    """
    document = {
        "config_schema": CONFIG_SCHEMA_VERSION,
        "metadata": {
            "exported_at": _now_iso(),
            "app_version": _app_version(),
            "mlx_lm_lora_version": _mlx_lm_lora_version(),
            "run_id": run.run_id,
            "status": run.status.value,
            "final_train_loss": run.final_train_loss,
            "final_val_loss": run.final_val_loss,
        },
        "config": run.config.model_dump(mode="json"),
    }
    return yaml.safe_dump(document, sort_keys=False, allow_unicode=True)


def parse_config_yaml(raw: bytes | str) -> TrainingConfig:
    """Parse an exported config document back into a validated TrainingConfig.

    Strict per docs/api.md — every failure is a 422 `validation_error`:
    - unparsable YAML (or non-UTF-8 bytes) -> "not valid YAML: ...";
    - document not a mapping, or `config` missing / not a mapping;
    - `config_schema` != 1 — an absent `config_schema` is also rejected
      (the contract says it "must be 1", so the exported marker is required);
    - unknown keys under `config` (named in the message);
    - then the standard TrainingConfig rules (mode-conditional fields,
      reward-function names, ...) via pydantic validation.
    """
    try:
        document = yaml.safe_load(raw)
    except yaml.YAMLError as exc:
        raise ValidationAppError(f"not valid YAML: {exc}") from exc
    except UnicodeDecodeError as exc:
        raise ValidationAppError(f"not valid YAML: {exc}") from exc

    if not isinstance(document, dict):
        raise ValidationAppError("YAML document must be a mapping")

    schema = document.get("config_schema")
    if schema != CONFIG_SCHEMA_VERSION:
        raise ValidationAppError(
            f"config_schema must be {CONFIG_SCHEMA_VERSION} "
            f"(got {'none' if schema is None else schema!r})"
        )

    config = document.get("config")
    if not isinstance(config, dict):
        raise ValidationAppError("document must contain a 'config' mapping")

    unknown = sorted(str(key) for key in config if key not in TrainingConfig.model_fields)
    if unknown:
        raise ValidationAppError(f"unknown keys under config: {', '.join(unknown)}")

    try:
        return TrainingConfig.model_validate(config)
    except ValidationError as exc:
        raise ValidationAppError(_format_pydantic_error(exc)) from exc
