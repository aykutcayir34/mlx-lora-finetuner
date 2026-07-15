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

    def test_ftpo_minimal_config_is_valid(self):
        config = TrainingConfig(
            name="my-run",
            model_id="mlx-community/x",
            dataset_id="ds_1",
            train_mode="ftpo",
        )
        assert config.train_mode == "ftpo"
        assert config.lambda_mse_target is None
        assert config.clip_epsilon_logits is None

    def test_ftpo_accepts_its_optional_hyperparameters(self):
        config = TrainingConfig(
            name="my-run",
            model_id="mlx-community/x",
            dataset_id="ds_1",
            train_mode="ftpo",
            lambda_mse_target=0.1,
            tau_mse_target=2.0,
            lambda_mse=0.5,
            clip_epsilon_logits=3.0,
        )
        assert config.lambda_mse == 0.5

    @pytest.mark.parametrize(
        "field", ["lambda_mse_target", "tau_mse_target", "lambda_mse", "clip_epsilon_logits"]
    )
    def test_ftpo_params_rejected_on_non_ftpo_mode(self, field):
        with pytest.raises(ValidationError, match="only accepted for ftpo"):
            TrainingConfig(
                name="my-run",
                model_id="mlx-community/x",
                dataset_id="ds_1",
                train_mode="sft",
                **{field: 0.5},
            )

    def test_sft_loss_type_accepted_on_sft(self):
        config = TrainingConfig(
            name="my-run",
            model_id="mlx-community/x",
            dataset_id="ds_1",
            train_mode="sft",
            sft_loss_type="dft",
        )
        assert config.sft_loss_type == "dft"

    def test_sft_loss_type_rejected_on_non_sft_mode(self):
        with pytest.raises(ValidationError, match="only accepted for sft"):
            TrainingConfig(
                name="my-run",
                model_id="mlx-community/x",
                dataset_id="ds_1",
                train_mode="dpo",
                beta=0.1,
                sft_loss_type="nll",
            )

    def test_sft_loss_type_unknown_value_rejected(self):
        with pytest.raises(ValidationError):
            TrainingConfig(
                name="my-run",
                model_id="mlx-community/x",
                dataset_id="ds_1",
                train_mode="sft",
                sft_loss_type="not-a-loss",
            )


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
    def test_has_exactly_seven_members(self):
        assert len(DatasetFormat) == 7

    def test_member_values(self):
        values = {member.value for member in DatasetFormat}
        assert values == {"chat", "completions", "text", "dpo", "orpo", "grpo", "ftpo"}
