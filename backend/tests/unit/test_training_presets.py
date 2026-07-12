"""Unit tests for app/training/presets.py (per-mode hyperparameter suggestions).

Pure Python, no mlx dependency — `presets.py` only imports `app.schemas.training`.
"""

from __future__ import annotations

import pytest

from app.schemas.training import TrainMode
from app.training.presets import suggest_hyperparameters


@pytest.mark.parametrize("mode", list(TrainMode))
def test_suggest_hyperparameters_always_returns_common_fields(mode):
    defaults = suggest_hyperparameters(mode)

    for key in (
        "batch_size",
        "max_seq_length",
        "iters",
        "learning_rate",
        "save_every",
        "steps_per_report",
        "steps_per_eval",
        "val_batches",
    ):
        assert key in defaults


def test_suggest_hyperparameters_sft_has_no_preference_rl_fields():
    defaults = suggest_hyperparameters(TrainMode.SFT)

    assert "beta" not in defaults
    assert "group_size" not in defaults
    assert "temperature" not in defaults
    assert "max_completion_length" not in defaults


@pytest.mark.parametrize("mode", [TrainMode.DPO, TrainMode.ORPO, TrainMode.CPO])
def test_suggest_hyperparameters_dpo_orpo_cpo_suggest_beta(mode):
    defaults = suggest_hyperparameters(mode)

    assert defaults["beta"] == 0.1
    assert "group_size" not in defaults
    assert "temperature" not in defaults
    assert "max_completion_length" not in defaults


def test_suggest_hyperparameters_grpo_suggests_group_size_temperature_and_completion_length():
    defaults = suggest_hyperparameters(TrainMode.GRPO)

    assert defaults["group_size"] == 4
    assert defaults["temperature"] == 0.8
    assert defaults["max_completion_length"] == 512
    assert "beta" not in defaults


@pytest.mark.parametrize(
    "param_count_m,expected_batch_size,expected_max_seq_length",
    [
        (None, 4, 2048),  # unknown size -> mid-scale-ish small assumption
        (135, 4, 2048),  # SmolLM-135M -> small model bucket
        (7000, 2, 2048),  # ~7B -> medium bucket
        (70000, 1, 1024),  # ~70B -> large bucket
    ],
)
def test_suggest_hyperparameters_scales_batch_size_by_model_size(
    param_count_m, expected_batch_size, expected_max_seq_length
):
    defaults = suggest_hyperparameters(TrainMode.SFT, model_param_count_m=param_count_m)

    assert defaults["batch_size"] == expected_batch_size
    assert defaults["max_seq_length"] == expected_max_seq_length
