"""Train-mode/model-boyutuna göre önerilen varsayılan hiper-parametreler.

Bu modül herhangi bir API endpoint'i tarafından çağrılmaz (Faz 1'de UI
"akıllı varsayılan" önerisi göstermiyor). İleride /train/jobs formunu
önceden doldurmak isteyen bir bileşenin kullanabileceği dahili bir yardımcı
olarak burada duruyor.
"""

from __future__ import annotations

from app.schemas.training import TrainMode

# Yaklaşık parametre sayısı eşikleri (milyon cinsinden).
_SMALL_MODEL_PARAMS_M = 1_000
_MEDIUM_MODEL_PARAMS_M = 8_000


def suggest_hyperparameters(
    train_mode: TrainMode, model_param_count_m: float | None = None
) -> dict[str, object]:
    """Return suggested `TrainingConfig` overrides for the given mode/size.

    `model_param_count_m`: yaklaşık parametre sayısı (milyon), örn. SmolLM-135M
    için 135. Bilinmiyorsa orta ölçek varsayımları kullanılır.
    """
    if model_param_count_m is None or model_param_count_m <= _SMALL_MODEL_PARAMS_M:
        batch_size, max_seq_length = 4, 2048
    elif model_param_count_m <= _MEDIUM_MODEL_PARAMS_M:
        batch_size, max_seq_length = 2, 2048
    else:
        batch_size, max_seq_length = 1, 1024

    defaults: dict[str, object] = {
        "batch_size": batch_size,
        "max_seq_length": max_seq_length,
        "iters": 600,
        "learning_rate": 1e-5,
        "save_every": 100,
        "steps_per_report": 10,
        "steps_per_eval": 100,
        "val_batches": 25,
    }

    if train_mode in (TrainMode.DPO, TrainMode.ORPO, TrainMode.CPO):
        defaults["beta"] = 0.1
    if train_mode == TrainMode.GRPO:
        defaults["group_size"] = 4
        defaults["max_completion_length"] = 512
        defaults["temperature"] = 0.8

    return defaults
