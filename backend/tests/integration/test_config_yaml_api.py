"""GET /train/jobs/{run_id}/config.yaml + POST /train/configs/import (docs/api.md).

Runs are seeded directly via `RunsRepo` (same pattern as the history API
tests) — the export endpoint only ever reads the `runs` table.
"""

from __future__ import annotations

import json

import aiosqlite
import pytest
import yaml

from app.config import get_settings
from app.db.repositories import RunsRepo
from app.schemas.training import TrainingConfig

SFT_CONFIG = {
    "name": "my-run",
    "model_id": "mlx-community/Tiny-1",
    "dataset_id": "ds_1",
    "train_mode": "sft",
}

GRPO_CONFIG = {
    "name": "grpo-run",
    "model_id": "mlx-community/Tiny-1",
    "dataset_id": "ds_grpo",
    "train_mode": "grpo",
    "group_size": 4,
    "temperature": 0.8,
    "reward_functions": ["r1_accuracy_reward_func", "r1_count_xml"],
}

FTPO_CONFIG = {
    "name": "ftpo-run",
    "model_id": "mlx-community/Tiny-1",
    "dataset_id": "ds_ftpo",
    "train_mode": "ftpo",
    "lambda_mse_target": 0.5,
    "tau_mse_target": 1.0,
    "lambda_mse": 0.1,
    "clip_epsilon_logits": 2.0,
}


async def _seed_run(run_id: str, config: dict, status: str = "completed") -> None:
    settings = get_settings()
    async with aiosqlite.connect(settings.db_path) as conn:
        repo = RunsRepo(conn)
        await repo.insert(
            run_id=run_id,
            name=config["name"],
            status=status,
            config_json=json.dumps(config),
            model_id=config["model_id"],
            dataset_id=config["dataset_id"],
            train_mode=config["train_mode"],
            created_at="2026-07-19T00:00:00Z",
        )
        if status == "completed":
            await repo.finish(
                run_id,
                status,
                finished_at="2026-07-19T00:05:00Z",
                final_train_loss=1.23,
                final_val_loss=1.31,
            )


def _import_files(content: bytes) -> dict:
    return {"file": ("config.yaml", content, "application/x-yaml")}


# ------------------------------------------------------------------ export


@pytest.mark.asyncio
async def test_export_yaml_document_and_headers(client):
    await _seed_run("run_sft", SFT_CONFIG)

    resp = await client.get("/api/v1/train/jobs/run_sft/config.yaml")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/x-yaml")
    disposition = resp.headers["content-disposition"]
    assert "attachment" in disposition
    assert "run_sft-config.yaml" in disposition

    document = yaml.safe_load(resp.text)
    assert document["config_schema"] == 1
    metadata = document["metadata"]
    for key in (
        "exported_at",
        "app_version",
        "mlx_lm_lora_version",
        "run_id",
        "status",
        "final_train_loss",
        "final_val_loss",
    ):
        assert key in metadata
    assert metadata["run_id"] == "run_sft"
    assert metadata["status"] == "completed"
    assert metadata["final_train_loss"] == 1.23
    assert document["config"] == TrainingConfig.model_validate(SFT_CONFIG).model_dump(mode="json")


@pytest.mark.asyncio
async def test_export_unknown_run_returns_404(client):
    resp = await client.get("/api/v1/train/jobs/run_missing/config.yaml")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "not_found"


# -------------------------------------------------------------- round trip


@pytest.mark.parametrize(
    ("run_id", "config"),
    [("run_sft", SFT_CONFIG), ("run_grpo", GRPO_CONFIG), ("run_ftpo", FTPO_CONFIG)],
    ids=["sft", "grpo", "ftpo"],
)
@pytest.mark.asyncio
async def test_export_import_round_trip(client, run_id, config):
    await _seed_run(run_id, config)

    exported = await client.get(f"/api/v1/train/jobs/{run_id}/config.yaml")
    assert exported.status_code == 200

    imported = await client.post(
        "/api/v1/train/configs/import", files=_import_files(exported.content)
    )
    assert imported.status_code == 200
    assert imported.json() == TrainingConfig.model_validate(config).model_dump(mode="json")


# ------------------------------------------------------------------ import


@pytest.mark.asyncio
async def test_import_success_returns_exact_config_json(client):
    config = TrainingConfig.model_validate(GRPO_CONFIG)
    document = yaml.safe_dump(
        {"config_schema": 1, "config": config.model_dump(mode="json")}, sort_keys=False
    )
    resp = await client.post(
        "/api/v1/train/configs/import", files=_import_files(document.encode())
    )
    assert resp.status_code == 200
    assert resp.json() == config.model_dump(mode="json")


async def _assert_import_422(client, content: bytes, fragment: str) -> None:
    resp = await client.post("/api/v1/train/configs/import", files=_import_files(content))
    assert resp.status_code == 422
    error = resp.json()["error"]
    assert error["code"] == "validation_error"
    assert fragment in error["message"]


@pytest.mark.asyncio
async def test_import_garbage_bytes_returns_422(client):
    await _assert_import_422(client, b"\x00\x81\xfe\xff{{{not yaml", "not valid YAML")


@pytest.mark.asyncio
async def test_import_non_mapping_yaml_returns_422(client):
    await _assert_import_422(client, b"- a\n- b\n", "must be a mapping")


@pytest.mark.asyncio
async def test_import_missing_config_key_returns_422(client):
    await _assert_import_422(client, b"config_schema: 1\nmetadata: {}\n", "'config' mapping")


@pytest.mark.asyncio
async def test_import_unknown_config_key_named_in_422(client):
    document = {
        "config_schema": 1,
        "config": {**SFT_CONFIG, "totally_bogus_key": 1},
    }
    await _assert_import_422(
        client, yaml.safe_dump(document).encode(), "totally_bogus_key"
    )


@pytest.mark.asyncio
async def test_import_wrong_config_schema_returns_422(client):
    document = {"config_schema": 2, "config": dict(SFT_CONFIG)}
    await _assert_import_422(
        client, yaml.safe_dump(document).encode(), "config_schema must be 1"
    )


@pytest.mark.asyncio
async def test_import_config_violating_rules_returns_422(client):
    document = {"config_schema": 1, "config": {**SFT_CONFIG, "train_mode": "dpo"}}
    await _assert_import_422(
        client, yaml.safe_dump(document).encode(), "beta is required"
    )


@pytest.mark.asyncio
async def test_import_oversize_file_returns_422(client):
    padding = b"# " + b"x" * (256 * 1024) + b"\n"
    await _assert_import_422(client, padding, "too large")
