"""Faz-2 T18: GET /runs/history filters/sort/pagination + POST /train/jobs/{id}/clone.

Runs are seeded directly via `RunsRepo` (no worker/job manager involved) per
the task instructions — this endpoint only ever reads the `runs` table.
"""

from __future__ import annotations

import json

import aiosqlite
import pytest

from app.config import get_settings
from app.db.repositories import RunsRepo

CONFIG_TEMPLATE = {
    "name": "my-run",
    "model_id": "mlx-community/Tiny-1",
    "dataset_id": "ds_1",
    "train_mode": "sft",
    "train_type": "lora",
    "batch_size": 1,
    "iters": 3,
}


def _config_json(**overrides) -> str:
    payload = {**CONFIG_TEMPLATE, **overrides}
    if payload["train_mode"] in ("dpo", "orpo", "cpo") and payload.get("beta") is None:
        payload["beta"] = 0.1
    return json.dumps(payload)


async def _seed_run(
    *,
    run_id: str,
    name: str = "my-run",
    status: str = "completed",
    model_id: str = "mlx-community/Tiny-1",
    dataset_id: str = "ds_1",
    train_mode: str = "sft",
    created_at: str,
    final_train_loss: float | None = None,
    final_val_loss: float | None = None,
) -> None:
    settings = get_settings()
    config_json = _config_json(
        name=name, model_id=model_id, dataset_id=dataset_id, train_mode=train_mode
    )
    async with aiosqlite.connect(settings.db_path) as conn:
        repo = RunsRepo(conn)
        await repo.insert(
            run_id=run_id,
            name=name,
            status=status,
            config_json=config_json,
            model_id=model_id,
            dataset_id=dataset_id,
            train_mode=train_mode,
            created_at=created_at,
        )
        if status != "queued":
            await repo.finish(
                run_id,
                status,
                finished_at=created_at,
                final_train_loss=final_train_loss,
                final_val_loss=final_val_loss,
            )


@pytest.fixture
async def seeded_runs(app):
    # run_1: earliest, sft, completed, has losses
    await _seed_run(
        run_id="run_1",
        model_id="mlx-community/Tiny-1",
        train_mode="sft",
        status="completed",
        created_at="2026-07-10T00:00:00.000Z",
        final_train_loss=2.0,
        final_val_loss=2.1,
    )
    # run_2: mid, dpo, failed, no losses (NULL final_train_loss)
    await _seed_run(
        run_id="run_2",
        model_id="mlx-community/Tiny-2",
        train_mode="dpo",
        status="failed",
        created_at="2026-07-11T00:00:00.000Z",
        final_train_loss=None,
        final_val_loss=None,
    )
    # run_3: latest, sft, completed, lower loss than run_1
    await _seed_run(
        run_id="run_3",
        model_id="mlx-community/Tiny-1",
        train_mode="sft",
        status="completed",
        created_at="2026-07-12T00:00:00.000Z",
        final_train_loss=1.0,
        final_val_loss=1.1,
    )
    return None


@pytest.mark.asyncio
async def test_no_filters_returns_all_newest_first(client, seeded_runs):
    resp = await client.get("/api/v1/runs/history")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 3
    assert [r["run_id"] for r in body["runs"]] == ["run_3", "run_2", "run_1"]


@pytest.mark.asyncio
async def test_filter_by_model_id(client, seeded_runs):
    resp = await client.get("/api/v1/runs/history", params={"model_id": "mlx-community/Tiny-2"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert [r["run_id"] for r in body["runs"]] == ["run_2"]


@pytest.mark.asyncio
async def test_filter_by_train_mode(client, seeded_runs):
    resp = await client.get("/api/v1/runs/history", params={"train_mode": "sft"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 2
    assert {r["run_id"] for r in body["runs"]} == {"run_1", "run_3"}


@pytest.mark.asyncio
async def test_filter_by_status(client, seeded_runs):
    resp = await client.get("/api/v1/runs/history", params={"status": "failed"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert body["runs"][0]["run_id"] == "run_2"


@pytest.mark.asyncio
async def test_combined_filters(client, seeded_runs):
    resp = await client.get(
        "/api/v1/runs/history",
        params={"model_id": "mlx-community/Tiny-1", "train_mode": "sft", "status": "completed"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 2
    assert {r["run_id"] for r in body["runs"]} == {"run_1", "run_3"}


@pytest.mark.asyncio
async def test_combined_filters_no_match(client, seeded_runs):
    resp = await client.get(
        "/api/v1/runs/history", params={"model_id": "mlx-community/Tiny-1", "status": "failed"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 0
    assert body["runs"] == []


@pytest.mark.asyncio
async def test_sort_created_at_ascending(client, seeded_runs):
    resp = await client.get("/api/v1/runs/history", params={"sort": "created_at"})
    assert resp.status_code == 200
    assert [r["run_id"] for r in resp.json()["runs"]] == ["run_1", "run_2", "run_3"]


@pytest.mark.asyncio
async def test_sort_created_at_descending_is_default(client, seeded_runs):
    resp = await client.get("/api/v1/runs/history", params={"sort": "-created_at"})
    assert resp.status_code == 200
    assert [r["run_id"] for r in resp.json()["runs"]] == ["run_3", "run_2", "run_1"]


@pytest.mark.asyncio
async def test_sort_final_train_loss_ascending_nulls_last(client, seeded_runs):
    resp = await client.get("/api/v1/runs/history", params={"sort": "final_train_loss"})
    assert resp.status_code == 200
    # run_3 (1.0) < run_1 (2.0) < run_2 (NULL, sorts last)
    assert [r["run_id"] for r in resp.json()["runs"]] == ["run_3", "run_1", "run_2"]


@pytest.mark.asyncio
async def test_sort_final_train_loss_descending_nulls_last(client, seeded_runs):
    resp = await client.get("/api/v1/runs/history", params={"sort": "-final_train_loss"})
    assert resp.status_code == 200
    # run_1 (2.0) > run_3 (1.0), NULL (run_2) still sorts last even descending
    assert [r["run_id"] for r in resp.json()["runs"]] == ["run_1", "run_3", "run_2"]


@pytest.mark.asyncio
async def test_invalid_sort_returns_422(client, seeded_runs):
    resp = await client.get("/api/v1/runs/history", params={"sort": "bogus"})
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "validation_error"


@pytest.mark.asyncio
async def test_pagination_respects_total(client, seeded_runs):
    resp = await client.get("/api/v1/runs/history", params={"limit": 2, "offset": 0})
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 3
    assert len(body["runs"]) == 2
    assert [r["run_id"] for r in body["runs"]] == ["run_3", "run_2"]

    resp2 = await client.get("/api/v1/runs/history", params={"limit": 2, "offset": 2})
    body2 = resp2.json()
    assert body2["total"] == 3
    assert [r["run_id"] for r in body2["runs"]] == ["run_1"]


@pytest.mark.asyncio
async def test_clone_happy_returns_stored_config(client, seeded_runs):
    resp = await client.post("/api/v1/train/jobs/run_1/clone")
    assert resp.status_code == 200
    body = resp.json()
    assert body["model_id"] == "mlx-community/Tiny-1"
    assert body["dataset_id"] == "ds_1"
    assert body["train_mode"] == "sft"


@pytest.mark.asyncio
async def test_clone_missing_run_returns_404(client, seeded_runs):
    resp = await client.post("/api/v1/train/jobs/run_missing/clone")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "not_found"
