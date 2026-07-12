"""Unit tests for app/training/worker.py.

mlx is mocked via import indirection: `_build_worker_args`/`_run_training`
accept an optional `train_mod` parameter instead of importing
`mlx_lm_lora.train` themselves, so these tests never need a real mlx
installation.
"""

from __future__ import annotations

import argparse
import json

import pytest

from app.config import get_settings
from app.schemas.training import TrainingConfig
from app.training import worker


class FakeTrainModule:
    """Minimal stand-in for `mlx_lm_lora.train`."""

    CONFIG_DEFAULTS = {
        "model": "mlx_model",
        "train": False,
        "fuse": True,
        "adapter_path": "adapters",
        "batch_size": 4,
        "optimizer": "adam",
    }

    captured_args = None
    captured_callback = None

    @staticmethod
    def build_parser():
        parser = argparse.ArgumentParser()
        # Real build_parser() defines dozens of options defaulting to None;
        # an empty parser's `parse_args([])` already yields an empty
        # Namespace (`vars() == {}`), which is enough to exercise our
        # default-filling/override logic.
        return parser

    @classmethod
    def run(cls, args, training_callback=None):
        cls.captured_args = args
        cls.captured_callback = training_callback


def make_config(**overrides) -> TrainingConfig:
    base = dict(
        name="test-run",
        model_id="mlx-community/Tiny-1",
        dataset_id="ds_1",
        train_mode="sft",
        train_type="lora",
        batch_size=2,
        iters=100,
        learning_rate=5e-5,
        lora={"rank": 16, "scale": 30.0, "dropout": 0.1},
        save_every=50,
    )
    base.update(overrides)
    return TrainingConfig(**base)


@pytest.fixture
def settings(data_dir):
    return get_settings()


def test_build_worker_args_maps_config_fields(settings, tmp_path):
    run_dir = tmp_path / "runs" / "run_1"
    run_dir.mkdir(parents=True)
    config = make_config()

    args = worker._build_worker_args(run_dir, config, train_mod=FakeTrainModule)

    assert args.model == str(settings.models_dir / "mlx-community__Tiny-1")
    assert args.data == str(settings.datasets_dir / "ds_1" / "data")
    assert args.adapter_path == str(run_dir / "adapters")
    assert args.train is True
    assert args.test is False
    assert args.fuse is False  # must not overwrite raw adapters via auto-fuse
    assert args.train_type == "lora"
    assert args.train_mode == "sft"
    assert args.batch_size == 2
    assert args.iters == 100
    assert args.learning_rate == 5e-5
    assert args.lora_parameters == {"rank": 16, "dropout": 0.1, "scale": 30.0}
    assert args.save_every == 50
    assert args.load_in_4bits is False
    assert args.load_in_6bits is False
    assert args.load_in_8bits is False
    assert args.optimizer == "adamw"


def test_build_worker_args_maps_load_in_bits(settings, tmp_path):
    run_dir = tmp_path / "runs" / "run_2"
    run_dir.mkdir(parents=True)
    config = make_config(load_in_bits=4)

    args = worker._build_worker_args(run_dir, config, train_mod=FakeTrainModule)

    assert args.load_in_4bits is True
    assert args.load_in_6bits is False
    assert args.load_in_8bits is False


def test_build_worker_args_joins_reward_functions(settings, tmp_path):
    run_dir = tmp_path / "runs" / "run_3"
    run_dir.mkdir(parents=True)
    config = make_config(
        train_mode="grpo", group_size=4, reward_functions=["accuracy", "format"]
    )

    args = worker._build_worker_args(run_dir, config, train_mod=FakeTrainModule)

    assert args.reward_functions == "accuracy,format"
    assert args.group_size == 4


@pytest.mark.parametrize(
    "name,expected",
    [
        (None, None),
        ("constant", None),
        ("cosine", {"name": "cosine_decay", "arguments": [1e-5, 600]}),
        ("linear", {"name": "linear_schedule", "arguments": [1e-5, 0.0, 600]}),
        ("unknown-schedule", None),
    ],
)
def test_build_lr_schedule(name, expected):
    assert worker._build_lr_schedule(name, 1e-5, 600) == expected


def test_run_training_calls_mlx_run_and_emits_done(settings, tmp_path, capsys):
    run_dir = tmp_path / "runs" / "run_4"
    run_dir.mkdir(parents=True)
    config = make_config(iters=10)

    FakeTrainModule.captured_args = None
    FakeTrainModule.captured_callback = None
    worker._run_training(run_dir, config, train_mod=FakeTrainModule)

    assert FakeTrainModule.captured_args is not None
    assert FakeTrainModule.captured_callback is not None

    out_lines = [line for line in capsys.readouterr().out.splitlines() if line.strip()]
    assert len(out_lines) == 1
    done_event = json.loads(out_lines[0])
    assert done_event["event"] == "done"
    assert done_event["adapter_path"] == str(run_dir / "adapters")


def test_run_training_rejects_unsupported_mode(settings, tmp_path):
    run_dir = tmp_path / "runs" / "run_5"
    run_dir.mkdir(parents=True)

    class _FakeEnum:
        value = "ppo"

    class _FakeConfig:
        train_mode = _FakeEnum()

    with pytest.raises(RuntimeError, match="mode not yet supported"):
        worker._run_training(run_dir, _FakeConfig(), train_mod=FakeTrainModule)


def test_load_config_round_trips_training_config(tmp_path):
    run_dir = tmp_path / "runs" / "run_6"
    run_dir.mkdir(parents=True)
    config = make_config()
    (run_dir / "config.json").write_text(config.model_dump_json())

    loaded = worker._load_config(run_dir)
    assert loaded == config


def test_worker_callback_emits_metric_and_checkpoint_jsonl(capsys):
    callback = worker.WorkerCallback(adapter_path="/tmp/adapters", save_every=10)

    callback.on_train_loss_report(
        {
            "iteration": 10,
            "train_loss": 1.5,
            "learning_rate": 1e-5,
            "iterations_per_second": 4.2,
            "tokens_per_second": 512.0,
            "trained_tokens": 1000,
            "peak_memory": 3.4,
        }
    )
    callback.on_val_loss_report({"iteration": 10, "val_loss": 1.4, "val_time": 0.5})

    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines() if line.strip()]
    assert len(lines) == 3  # metric, checkpoint (step % save_every == 0), val_metric

    metric_event, checkpoint_event, val_event = lines
    assert metric_event == {
        "event": "metric",
        "step": 10,
        "loss": 1.5,
        "learning_rate": 1e-5,
        "it_per_sec": 4.2,
        "tokens_per_sec": 512.0,
        "peak_memory_gb": 3.4,
    }
    assert checkpoint_event == {
        "event": "checkpoint",
        "step": 10,
        "adapter_path": "/tmp/adapters/0000010_adapters.safetensors",
    }
    assert val_event == {"event": "val_metric", "step": 10, "loss": 1.4}

    assert callback.last_train_loss == 1.5
    assert callback.last_val_loss == 1.4


def test_worker_callback_skips_checkpoint_when_not_on_save_boundary(capsys):
    callback = worker.WorkerCallback(adapter_path="/tmp/adapters", save_every=100)
    callback.on_train_loss_report(
        {
            "iteration": 5,
            "train_loss": 2.0,
            "learning_rate": 1e-5,
            "iterations_per_second": 4.0,
            "tokens_per_second": 400.0,
            "peak_memory": 2.0,
        }
    )
    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines() if line.strip()]
    assert len(lines) == 1
    assert lines[0]["event"] == "metric"
