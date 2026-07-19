"""Unit tests for app.services.config_yaml (YAML config export/import)."""

from __future__ import annotations

import pytest
import yaml

from app.core.errors import ValidationAppError
from app.schemas.training import JobStatus, RunSummary, TrainingConfig
from app.services.config_yaml import parse_config_yaml, render_config_yaml


def _config(**overrides) -> TrainingConfig:
    base = {
        "name": "my-run",
        "model_id": "mlx-community/Tiny-1",
        "dataset_id": "ds_1",
        "train_mode": "sft",
    }
    base.update(overrides)
    return TrainingConfig.model_validate(base)


def _run(config: TrainingConfig, **overrides) -> RunSummary:
    base = {
        "run_id": "run_abc123",
        "name": config.name,
        "status": JobStatus.COMPLETED,
        "config": config,
        "created_at": "2026-07-19T00:00:00Z",
        "final_train_loss": 1.23,
        "final_val_loss": 1.31,
    }
    base.update(overrides)
    return RunSummary.model_validate(base)


# ---------------------------------------------------------------- render


def test_render_document_shape():
    run = _run(_config())
    document = yaml.safe_load(render_config_yaml(run))

    assert document["config_schema"] == 1
    metadata = document["metadata"]
    assert set(metadata) == {
        "exported_at",
        "app_version",
        "mlx_lm_lora_version",
        "run_id",
        "status",
        "final_train_loss",
        "final_val_loss",
    }
    assert metadata["run_id"] == "run_abc123"
    assert metadata["status"] == "completed"
    assert metadata["final_train_loss"] == 1.23
    assert metadata["final_val_loss"] == 1.31
    assert isinstance(metadata["exported_at"], str)
    assert isinstance(metadata["app_version"], str)

    # config: exactly the TrainingConfig fields, enums as strings.
    assert document["config"] == run.config.model_dump(mode="json")
    assert document["config"]["train_mode"] == "sft"
    assert set(document["config"]) == set(TrainingConfig.model_fields)


def test_render_preserves_field_order():
    text = render_config_yaml(_run(_config()))
    # sort_keys=False: top-level order is document order, config order is
    # the model's declaration order.
    top_level = [line.split(":")[0] for line in text.splitlines() if not line.startswith(" ")]
    assert top_level == ["config_schema", "metadata", "config"]
    config_keys = list(yaml.safe_load(text)["config"])
    assert config_keys[:4] == ["name", "model_id", "dataset_id", "train_mode"]


def test_render_null_losses_while_running():
    run = _run(
        _config(),
        status=JobStatus.RUNNING,
        final_train_loss=None,
        final_val_loss=None,
    )
    document = yaml.safe_load(render_config_yaml(run))
    assert document["metadata"]["final_train_loss"] is None
    assert document["metadata"]["final_val_loss"] is None
    assert document["metadata"]["status"] == "running"


# ------------------------------------------------------------ round trip


@pytest.mark.parametrize(
    "config",
    [
        _config(),
        _config(
            name="grpo-run",
            train_mode="grpo",
            group_size=4,
            temperature=0.8,
            max_completion_length=256,
            reward_functions=["r1_accuracy_reward_func", "r1_count_xml"],
        ),
        _config(
            name="ftpo-run",
            train_mode="ftpo",
            lambda_mse_target=0.5,
            tau_mse_target=1.0,
            lambda_mse=0.1,
            clip_epsilon_logits=2.0,
        ),
    ],
    ids=["sft", "grpo", "ftpo"],
)
def test_round_trip_export_import_identical(config):
    text = render_config_yaml(_run(config))
    assert parse_config_yaml(text) == config
    # Bytes input round-trips the same way.
    assert parse_config_yaml(text.encode("utf-8")) == config


# --------------------------------------------------------------- parse 422s


def _assert_422(raw, fragment: str):
    with pytest.raises(ValidationAppError) as exc_info:
        parse_config_yaml(raw)
    assert exc_info.value.status_code == 422
    assert fragment in exc_info.value.message


def test_parse_garbage_bytes():
    _assert_422(b"\x00\x81\xfe\xff{{{not yaml", "not valid YAML")


def test_parse_invalid_yaml_syntax():
    _assert_422("config: [unclosed", "not valid YAML")


def test_parse_non_mapping_document():
    _assert_422("- a\n- b\n", "must be a mapping")


def test_parse_missing_config_mapping():
    _assert_422("config_schema: 1\nmetadata: {}\n", "'config' mapping")


def test_parse_config_not_a_mapping():
    _assert_422("config_schema: 1\nconfig: [1, 2]\n", "'config' mapping")


def test_parse_wrong_config_schema():
    _assert_422("config_schema: 2\nconfig: {}\n", "config_schema must be 1")


def test_parse_absent_config_schema():
    _assert_422("config: {}\n", "config_schema must be 1")


def test_parse_unknown_config_key_named():
    text = render_config_yaml(_run(_config()))
    document = yaml.safe_load(text)
    document["config"]["not_a_field"] = 1
    document["config"]["also_bogus"] = 2
    with pytest.raises(ValidationAppError) as exc_info:
        parse_config_yaml(yaml.safe_dump(document))
    assert "unknown keys under config" in exc_info.value.message
    assert "not_a_field" in exc_info.value.message
    assert "also_bogus" in exc_info.value.message


def test_parse_metadata_ignored():
    document = {
        "config_schema": 1,
        "metadata": {"status": "failed", "nonsense": True},
        "config": _config().model_dump(mode="json"),
    }
    assert parse_config_yaml(yaml.safe_dump(document)) == _config()


def test_parse_training_config_rules_enforced():
    document = {
        "config_schema": 1,
        "config": {
            "name": "bad",
            "model_id": "m",
            "dataset_id": "d",
            "train_mode": "dpo",  # beta missing -> model_validator error
        },
    }
    with pytest.raises(ValidationAppError) as exc_info:
        parse_config_yaml(yaml.safe_dump(document))
    assert exc_info.value.status_code == 422
    assert "beta is required" in exc_info.value.message
