import pytest
from pydantic import ValidationError

from app.schemas.datasets import DatasetFormat
from app.schemas.events import WorkerMetric, parse_worker_line
from app.schemas.training import TrainingConfig


class TestTrainingConfigValidation:
    def test_sft_minimal_config_is_valid(self):
        config = TrainingConfig(
            name="my-run",
            model_id="mlx-community/SmolLM-135M-Instruct-4bit",
            dataset_id="ds_1",
            train_mode="sft",
        )
        assert config.train_mode == "sft"
        assert config.beta is None
        assert config.group_size is None

    def test_dpo_without_beta_raises(self):
        with pytest.raises(ValidationError):
            TrainingConfig(
                name="my-run",
                model_id="mlx-community/x",
                dataset_id="ds_1",
                train_mode="dpo",
            )

    def test_dpo_with_beta_is_valid(self):
        config = TrainingConfig(
            name="my-run",
            model_id="mlx-community/x",
            dataset_id="ds_1",
            train_mode="dpo",
            beta=0.1,
        )
        assert config.beta == 0.1

    def test_grpo_without_group_size_raises(self):
        with pytest.raises(ValidationError):
            TrainingConfig(
                name="my-run",
                model_id="mlx-community/x",
                dataset_id="ds_1",
                train_mode="grpo",
                group_size=None,
            )

    def test_grpo_with_group_size_is_valid(self):
        config = TrainingConfig(
            name="my-run",
            model_id="mlx-community/x",
            dataset_id="ds_1",
            train_mode="grpo",
            group_size=4,
        )
        assert config.group_size == 4


class TestParseWorkerLine:
    def test_valid_metric_event_parses_to_worker_metric(self):
        line = (
            '{"event": "metric", "step": 10, "loss": 2.3, "learning_rate": 1e-5, '
            '"it_per_sec": 4.2, "tokens_per_sec": 512.0, "peak_memory_gb": 3.4}'
        )
        event = parse_worker_line(line)
        assert isinstance(event, WorkerMetric)
        assert event.step == 10
        assert event.loss == 2.3
        assert event.learning_rate == 1e-5
        assert event.it_per_sec == 4.2
        assert event.tokens_per_sec == 512.0
        assert event.peak_memory_gb == 3.4

    def test_invalid_json_returns_none(self):
        assert parse_worker_line("not json {") is None

    def test_missing_event_field_returns_none(self):
        assert parse_worker_line('{"foo": "bar"}') is None

    def test_unknown_event_value_returns_none(self):
        assert parse_worker_line('{"event": "unknown_thing"}') is None


class TestDatasetFormat:
    def test_has_exactly_six_members(self):
        assert len(DatasetFormat) == 6

    def test_member_values(self):
        values = {member.value for member in DatasetFormat}
        assert values == {"chat", "completions", "text", "dpo", "orpo", "grpo"}
