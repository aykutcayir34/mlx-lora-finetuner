from pathlib import Path

import pytest

from app.config import get_settings
from app.db.repositories import DatasetsRepo, RunsRepo

FIXTURES = Path(__file__).parent.parent / "fixtures" / "datasets"


def _multipart(fixture_name: str, filename: str | None = None):
    content = (FIXTURES / fixture_name).read_bytes()
    return {"file": (filename or fixture_name, content, "application/octet-stream")}


async def _upload(client, fixture_name: str, name: str | None = None, filename: str | None = None):
    data = {"name": name} if name else {}
    return await client.post(
        "/api/v1/datasets/upload", files=_multipart(fixture_name, filename), data=data
    )


# --------------------------------------------------------------------------
# Upload + format sniffing
# --------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "fixture_name,expected_format,expected_rows",
    [
        ("chat_valid.jsonl", "chat", 3),
        ("completions_valid.jsonl", "completions", 2),
        ("text_valid.jsonl", "text", 2),
        ("dpo_valid.jsonl", "dpo", 2),
        ("orpo_valid.jsonl", "orpo", 2),
        ("grpo_valid.jsonl", "grpo", 2),
    ],
)
async def test_upload_detects_each_format(client, fixture_name, expected_format, expected_rows):
    response = await _upload(client, fixture_name)
    assert response.status_code == 201, response.text
    data = response.json()
    assert data["format"] == expected_format
    assert data["row_count"] == expected_rows
    assert data["dataset_id"].startswith("ds_")
    assert data["splits"] is None


@pytest.mark.asyncio
async def test_upload_uses_filename_stem_as_default_name(client):
    response = await _upload(client, "chat_valid.jsonl")
    assert response.status_code == 201
    assert response.json()["name"] == "chat_valid"


@pytest.mark.asyncio
async def test_upload_uses_explicit_name(client):
    response = await _upload(client, "chat_valid.jsonl", name="my-custom-name")
    assert response.status_code == 201
    assert response.json()["name"] == "my-custom-name"


@pytest.mark.asyncio
async def test_upload_dpo_vs_orpo_distinction(client):
    dpo_resp = await _upload(client, "dpo_valid.jsonl")
    orpo_resp = await _upload(client, "orpo_valid.jsonl")
    assert dpo_resp.json()["format"] == "dpo"
    assert orpo_resp.json()["format"] == "orpo"


@pytest.mark.asyncio
async def test_upload_mixed_garbage_is_422(client):
    response = await _upload(client, "mixed_garbage.jsonl")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


@pytest.mark.asyncio
async def test_upload_empty_file_is_422(client):
    response = await _upload(client, "empty.jsonl")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


@pytest.mark.asyncio
async def test_upload_non_jsonl_file_is_422(client):
    response = await _upload(client, "not_jsonl.txt")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


# --------------------------------------------------------------------------
# List
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_datasets_returns_uploaded_datasets(client):
    await _upload(client, "chat_valid.jsonl")
    await _upload(client, "text_valid.jsonl")

    response = await client.get("/api/v1/datasets")
    assert response.status_code == 200
    datasets = response.json()["datasets"]
    assert len(datasets) == 2


# --------------------------------------------------------------------------
# Validate
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_validate_returns_report_matching_contract_shape(client, db_conn):
    # chat_broken.jsonl mixes valid rows with rows carrying entirely wrong keys,
    # which upload's strict format-sniffing would reject outright — so seed the
    # dataset directly to exercise /validate's line-precise reporting instead.
    settings = get_settings()
    dataset_id = "ds_broken_chat"
    dataset_dir = settings.datasets_dir / dataset_id
    dataset_dir.mkdir(parents=True)
    (dataset_dir / "raw.jsonl").write_text(
        (FIXTURES / "chat_broken.jsonl").read_text(encoding="utf-8"), encoding="utf-8"
    )
    await DatasetsRepo(db_conn).insert(
        id=dataset_id,
        name="broken",
        format="chat",
        path=str(dataset_dir),
        row_count=6,
        splits_json=None,
        created_at="2026-07-12T00:00:00Z",
    )

    response = await client.post(f"/api/v1/datasets/{dataset_id}/validate")
    assert response.status_code == 200
    data = response.json()
    assert data["dataset_id"] == dataset_id
    assert data["format"] == "chat"
    assert data["total_rows"] == 6
    assert data["valid_rows"] == 1
    assert len(data["errors"]) == 5
    assert all("line" in e and "message" in e for e in data["errors"])


@pytest.mark.asyncio
async def test_validate_unknown_dataset_is_404(client):
    response = await client.post("/api/v1/datasets/ds_does_not_exist/validate")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


# --------------------------------------------------------------------------
# Split
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_split_updates_dataset_info_with_splits(client):
    upload_resp = await _upload(client, "chat_valid.jsonl")
    dataset_id = upload_resp.json()["dataset_id"]

    response = await client.post(
        f"/api/v1/datasets/{dataset_id}/split",
        json={"train": 0.34, "valid": 0.33, "test": 0.33, "seed": 1, "shuffle": True},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["splits"]["train"] >= 1
    assert data["splits"]["valid"] >= 1
    assert data["splits"]["test"] >= 1
    assert sum(data["splits"].values()) == 3


@pytest.mark.asyncio
async def test_split_ratios_not_summing_to_one_is_422(client):
    upload_resp = await _upload(client, "chat_valid.jsonl")
    dataset_id = upload_resp.json()["dataset_id"]

    response = await client.post(
        f"/api/v1/datasets/{dataset_id}/split",
        json={"train": 0.5, "valid": 0.3, "test": 0.1, "seed": 1, "shuffle": True},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


@pytest.mark.asyncio
async def test_split_unknown_dataset_is_404(client):
    response = await client.post(
        "/api/v1/datasets/ds_does_not_exist/split",
        json={"train": 0.8, "valid": 0.1, "test": 0.1, "seed": 1, "shuffle": True},
    )
    assert response.status_code == 404


# --------------------------------------------------------------------------
# Preview
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_preview_raw_split_before_splitting(client):
    upload_resp = await _upload(client, "chat_valid.jsonl")
    dataset_id = upload_resp.json()["dataset_id"]

    response = await client.get(f"/api/v1/datasets/{dataset_id}/preview?split=raw&page=1&size=2")
    assert response.status_code == 200
    data = response.json()
    assert data["total_rows"] == 3
    assert len(data["rows"]) == 2
    assert data["page"] == 1
    assert data["size"] == 2


@pytest.mark.asyncio
async def test_preview_train_split_404_before_split_performed(client):
    upload_resp = await _upload(client, "chat_valid.jsonl")
    dataset_id = upload_resp.json()["dataset_id"]

    response = await client.get(f"/api/v1/datasets/{dataset_id}/preview?split=train")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_preview_train_split_after_split_performed(client):
    upload_resp = await _upload(client, "chat_valid.jsonl")
    dataset_id = upload_resp.json()["dataset_id"]
    await client.post(
        f"/api/v1/datasets/{dataset_id}/split",
        json={"train": 0.34, "valid": 0.33, "test": 0.33, "seed": 1, "shuffle": False},
    )

    response = await client.get(f"/api/v1/datasets/{dataset_id}/preview?split=train")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_preview_bad_split_name_is_404(client):
    upload_resp = await _upload(client, "chat_valid.jsonl")
    dataset_id = upload_resp.json()["dataset_id"]

    response = await client.get(f"/api/v1/datasets/{dataset_id}/preview?split=bogus")
    assert response.status_code == 404


# --------------------------------------------------------------------------
# Delete
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_dataset_returns_204(client):
    upload_resp = await _upload(client, "chat_valid.jsonl")
    dataset_id = upload_resp.json()["dataset_id"]

    response = await client.delete(f"/api/v1/datasets/{dataset_id}")
    assert response.status_code == 204

    list_response = await client.get("/api/v1/datasets")
    assert list_response.json()["datasets"] == []


@pytest.mark.asyncio
async def test_delete_unknown_dataset_is_404(client):
    response = await client.delete("/api/v1/datasets/ds_does_not_exist")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


@pytest.mark.asyncio
async def test_delete_dataset_used_by_active_run_is_409(client, db_conn):
    upload_resp = await _upload(client, "chat_valid.jsonl")
    dataset_id = upload_resp.json()["dataset_id"]

    runs_repo = RunsRepo(db_conn)
    await runs_repo.insert(
        run_id="run_1",
        name="my-run",
        status="running",
        config_json="{}",
        model_id="mlx-community/x",
        dataset_id=dataset_id,
        train_mode="sft",
        created_at="2026-07-12T00:00:00Z",
    )

    response = await client.delete(f"/api/v1/datasets/{dataset_id}")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "training_active"
