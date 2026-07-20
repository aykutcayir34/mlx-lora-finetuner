"""`python -m app.training.worker --run-dir <dir>` subprocess giriş noktası.

`runs/<run_id>/config.json`'dan `TrainingConfig`'i okur, `mlx-lm-lora==3.0.0`
kütüphanesine köprü kurar ve docs/api.md'deki "Worker event protocol"üne
uygun tek satırlık JSON olayları stdout'a basar (flush=True).

Kütüphane API'si (kaynak incelemesiyle doğrulandı, bkz. rapor):
- `mlx_lm_lora.train.run(args, training_callback=...)` — model/dataset
  yükleme, eğitim modu dispatch'i (sft/dpo/orpo/cpo/grpo/ftpo) ve adapter
  kaydını uçtan uca yapan tek fonksiyon. `main()` CLI sarmalayıcısı
  `training_callback` kabul etmediği için doğrudan `run()` çağrılıyor.
- v3 eklemeleri: `ftpo` train-mode (final-token preference optimization;
  referans modelini `run()` kendisi yükler) ve yeni opsiyonel argümanlar —
  `sft_loss_type` (nll|chunked_nll|dft, sadece sft) ile ftpo hiperparametreleri
  `lambda_mse_target`/`tau_mse_target`/`lambda_mse`/`clip_epsilon_logits`.
  Hepsi `CONFIG_DEFAULTS` içinde olduğundan set edilmediklerinde
  varsayılan-doldurma yolu onları zaten karşılıyor.
- `args`, `mlx_lm_lora.train.build_parser()` argparse varsayılanlarının
  `CONFIG_DEFAULTS` ile doldurulup bizim override'larımızla güncellendiği bir
  `types.SimpleNamespace` — `main()`'in dict-mode'unun yaptığı birleştirmenin
  aynısı, kütüphaneyi fork etmeden.
- `mlx_lm.tuner.callbacks.TrainingCallback.on_train_loss_report(dict)` ve
  `.on_val_loss_report(dict)` — dict anahtarları kaynaktan doğrulandı:
  train: iteration, train_loss, learning_rate, iterations_per_second,
  tokens_per_second, trained_tokens, peak_memory; val: iteration, val_loss,
  val_time.

ÖNEMLİ: Bu modülde mlx'e bağımlı tüm importlar fonksiyon içinde yapılır —
modül import edildiğinde (ör. testlerde) mlx kurulu olmasa bile patlamaz.
Testler, gerçek `mlx_lm_lora.train` modülünü enjekte edilebilir bir
`train_mod` parametresiyle sahte bir modülle değiştirir ("mlx mocked via
import indirection").
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import traceback
from pathlib import Path
from typing import Any

SUPPORTED_TRAIN_MODES = {"sft", "dpo", "orpo", "cpo", "grpo", "ftpo"}

# train_mode başına referans modele ihtiyaç duyan modlar (kütüphane kaynağına
# göre): dpo, grpo ve ftpo — üçünde de referans modeli `run()` kendisi yükler
# (`reference_model_path` None ise base model'e düşer). orpo/cpo referans
# model kullanmıyor. Bilgi amaçlı set; worker ek bir şey yapmıyor.
_MODES_NEEDING_REFERENCE_MODEL = {"dpo", "grpo", "ftpo"}


def _emit(event: dict[str, Any]) -> None:
    print(json.dumps(event), flush=True)


def _load_config(run_dir: Path):
    from app.schemas.training import TrainingConfig

    data = json.loads((run_dir / "config.json").read_text())
    return TrainingConfig.model_validate(data)


def _build_lr_schedule(
    name: str | None, learning_rate: float, iters: int
) -> dict[str, Any] | None:
    """Map our plain `lr_schedule` string to mlx-lm's schedule-config dict.

    `mlx_lm.tuner.utils.build_schedule` expects
    `{"name": "<mx.optimizers.schedulers fn>", "arguments": [...], "warmup": n}`,
    not a bare string. `None` means "use the flat `learning_rate`" (constant).
    """
    if not name or name == "constant":
        return None
    if name == "cosine":
        return {"name": "cosine_decay", "arguments": [learning_rate, max(iters, 1)]}
    if name == "linear":
        return {"name": "linear_schedule", "arguments": [learning_rate, 0.0, max(iters, 1)]}
    return None


def _import_mlx_train_module():
    import mlx_lm_lora.train as train_mod

    return train_mod


def _build_worker_args(run_dir: Path, config, train_mod=None):
    """Build the `SimpleNamespace` expected by `mlx_lm_lora.train.run`.

    Mirrors what `mlx_lm_lora.train.main()` does when called with a dict:
    take the argparse defaults, fill any `None` from `CONFIG_DEFAULTS`, then
    apply our mapped overrides on top.
    """
    import types

    from app.config import get_settings
    from app.core.paths import model_dirname

    if train_mod is None:
        train_mod = _import_mlx_train_module()

    settings = get_settings()
    model_path = str(settings.models_dir / model_dirname(config.model_id))
    dataset_data_dir = str(settings.datasets_dir / config.dataset_id / "data")
    adapter_path = str(run_dir / "adapters")

    default_args: dict[str, Any] = vars(train_mod.build_parser().parse_args([]))
    for key, value in train_mod.CONFIG_DEFAULTS.items():
        if default_args.get(key) is None:
            default_args[key] = value

    overrides: dict[str, Any] = {
        "model": model_path,
        "data": dataset_data_dir,
        "train": True,
        "test": False,
        # Keep raw LoRA adapters only — fusing into a full model is a
        # separate, explicit step owned by the export pipeline.
        "fuse": False,
        "train_type": config.train_type.value,
        "train_mode": config.train_mode.value,
        "batch_size": config.batch_size,
        "iters": config.iters,
        "learning_rate": config.learning_rate,
        "max_seq_length": config.max_seq_length,
        "num_layers": config.num_layers,
        "lora_parameters": {
            "rank": config.lora.rank,
            "dropout": config.lora.dropout,
            "scale": config.lora.scale,
        },
        "optimizer": config.optimizer,
        "lr_schedule": _build_lr_schedule(config.lr_schedule, config.learning_rate, config.iters),
        "grad_checkpoint": config.grad_checkpoint,
        "save_every": config.save_every,
        "steps_per_report": config.steps_per_report,
        "steps_per_eval": config.steps_per_eval,
        "val_batches": config.val_batches,
        "seed": config.seed,
        "adapter_path": adapter_path,
        "wandb": None,
        "load_in_4bits": config.load_in_bits == 4,
        "load_in_6bits": config.load_in_bits == 6,
        "load_in_8bits": config.load_in_bits == 8,
        "load_in_mxfp4": False,
    }
    default_args.update(overrides)

    # Mode-specific knobs: only override when the caller actually set a
    # value. These fields are optional on `TrainingConfig` even for the modes
    # that use them (only dpo/orpo/cpo require `beta`; grpo only requires
    # `group_size` — see `TrainingConfig.check_mode_conditional_fields`). If
    # we always overrode with `config.<field>`, a `None` would stomp the
    # library's own argparse/CONFIG_DEFAULTS defaults (e.g. GRPO's beta=0.1,
    # temperature=1.0, max_completion_length=512; sft_loss_type="nll" and the
    # ftpo hyperparameters 0.05/1.0/0.4/2.0) with `None`, which then blows up
    # numeric ops (e.g. `beta * kl_term`) inside mlx-lm-lora's trainers.
    optional_overrides: dict[str, Any] = {
        "gradient_accumulation_steps": config.gradient_accumulation_steps,
        "beta": config.beta,
        "group_size": config.group_size,
        "temperature": config.temperature,
        "max_completion_length": config.max_completion_length,
        "sft_loss_type": config.sft_loss_type.value if config.sft_loss_type else None,
        "lambda_mse_target": config.lambda_mse_target,
        "tau_mse_target": config.tau_mse_target,
        "lambda_mse": config.lambda_mse,
        "clip_epsilon_logits": config.clip_epsilon_logits,
    }
    for key, value in optional_overrides.items():
        if value is not None:
            default_args[key] = value
    if config.reward_functions:
        default_args["reward_functions"] = ",".join(config.reward_functions)
    if config.reward_functions_file:
        # Absolute path under MLXLF_DATA_DIR/rewards; the library importlib-
        # execs the file (registering its @register_reward_function functions)
        # BEFORE resolving reward_functions names, so custom names become valid.
        default_args["reward_functions_file"] = str(
            settings.rewards_dir / f"{config.reward_functions_file}.py"
        )

    return types.SimpleNamespace(**default_args)


class WorkerCallback:
    """Bridges `mlx_lm.tuner.callbacks.TrainingCallback` to our JSONL events."""

    def __init__(self, adapter_path: str, save_every: int) -> None:
        self._adapter_path = adapter_path
        self._save_every = save_every
        self.last_train_loss: float | None = None
        self.last_val_loss: float | None = None

    def _checkpoint_path(self, step: int) -> str:
        return str(Path(self._adapter_path) / f"{step:07d}_adapters.safetensors")

    def on_train_loss_report(self, train_info: dict[str, Any]) -> None:
        step = train_info.get("iteration")
        loss = train_info.get("train_loss")
        self.last_train_loss = loss
        _emit(
            {
                "event": "metric",
                "step": step,
                "loss": loss,
                "learning_rate": train_info.get("learning_rate"),
                "it_per_sec": train_info.get("iterations_per_second"),
                "tokens_per_sec": train_info.get("tokens_per_second"),
                "peak_memory_gb": train_info.get("peak_memory"),
            }
        )
        if step is not None and self._save_every and step % self._save_every == 0:
            _emit(
                {
                    "event": "checkpoint",
                    "step": step,
                    "adapter_path": self._checkpoint_path(step),
                }
            )

    def on_val_loss_report(self, val_info: dict[str, Any]) -> None:
        self.last_val_loss = val_info.get("val_loss")
        _emit(
            {
                "event": "val_metric",
                "step": val_info.get("iteration"),
                "loss": val_info.get("val_loss"),
            }
        )


def _run_training(run_dir: Path, config, train_mod=None) -> None:
    if config.train_mode.value not in SUPPORTED_TRAIN_MODES:
        raise RuntimeError(f"mode not yet supported: {config.train_mode.value}")

    if train_mod is None:
        train_mod = _import_mlx_train_module()

    args = _build_worker_args(run_dir, config, train_mod=train_mod)
    adapter_path = str(run_dir / "adapters")
    callback = WorkerCallback(adapter_path=adapter_path, save_every=config.save_every)

    train_mod.run(args, training_callback=callback)

    _emit(
        {
            "event": "done",
            "adapter_path": adapter_path,
            "final_train_loss": callback.last_train_loss,
            "final_val_loss": callback.last_val_loss,
        }
    )


def _install_sigterm_handler() -> None:
    import signal

    def _handler(signum, frame):  # noqa: ARG001
        # mlx'in eğitim döngüsü adım-ortasında kesintiye açık olmayabilir;
        # süreç-grubu SIGKILL'i (JobManager.cancel) nihai güvenlik ağıdır.
        # Burada elden geldiğince hızlı çıkıyoruz.
        os._exit(143)

    signal.signal(signal.SIGTERM, _handler)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-dir", required=True)
    args = parser.parse_args(argv)
    run_dir = Path(args.run_dir)

    _install_sigterm_handler()

    config = _load_config(run_dir)
    _emit({"event": "started", "pid": os.getpid()})

    try:
        _run_training(run_dir, config)
    except Exception as exc:  # noqa: BLE001 — must report every failure as an event
        _emit({"event": "error", "message": str(exc), "traceback": traceback.format_exc()})
        sys.exit(1)


if __name__ == "__main__":
    main()
