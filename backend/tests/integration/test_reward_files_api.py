"""Integration tests for /train/reward-files (docs/api.md: custom GRPO reward files)."""

from __future__ import annotations

import pytest

from app.config import get_settings

VALID_SOURCE = (
    b"from mlx_lm_lora.trainer.grpo_reward_functions import register_reward_function\n"
    b"\n"
    b"@register_reward_function()\n"
    b"def my_reward(prompts, completions, answers, types=None):\n"
    b"    return [1.0 for _ in completions]\n"
    b"\n"
    b"@register_reward_function(name='named_reward')\n"
    b"def helper(prompts, completions, answers, types=None):\n"
    b"    return [0.0 for _ in completions]\n"
)


def _upload_files(filename: str = "my_rewards.py", content: bytes = VALID_SOURCE) -> dict:
    return {"file": (filename, content, "text/x-python")}


@pytest.mark.asyncio
async def test_upload_list_delete_happy_path(client):
    upload = await client.post("/api/v1/train/reward-files", files=_upload_files())
    assert upload.status_code == 201
    body = upload.json()
    assert body["name"] == "my_rewards"
    assert body["functions"] == ["my_reward", "named_reward"]
    assert isinstance(body["uploaded_at"], str) and body["uploaded_at"]

    listing = await client.get("/api/v1/train/reward-files")
    assert listing.status_code == 200
    files = listing.json()["files"]
    assert len(files) == 1
    assert files[0]["name"] == "my_rewards"
    assert files[0]["functions"] == ["my_reward", "named_reward"]
    assert set(files[0]) == {"name", "functions", "uploaded_at"}

    deleted = await client.delete("/api/v1/train/reward-files/my_rewards")
    assert deleted.status_code == 204

    empty = await client.get("/api/v1/train/reward-files")
    assert empty.json()["files"] == []


@pytest.mark.asyncio
async def test_upload_writes_under_rewards_dir(client):
    resp = await client.post("/api/v1/train/reward-files", files=_upload_files())
    assert resp.status_code == 201
    assert (get_settings().rewards_dir / "my_rewards.py").is_file()


@pytest.mark.asyncio
async def test_upload_syntax_error_returns_422(client):
    resp = await client.post(
        "/api/v1/train/reward-files",
        files=_upload_files(content=b"def broken(:\n    pass\n"),
    )
    assert resp.status_code == 422
    error = resp.json()["error"]
    assert error["code"] == "validation_error"
    assert "not parseable Python" in error["message"]


@pytest.mark.asyncio
async def test_upload_without_decorated_function_returns_422(client):
    resp = await client.post(
        "/api/v1/train/reward-files",
        files=_upload_files(content=b"def plain():\n    return []\n"),
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "validation_error"


@pytest.mark.asyncio
async def test_upload_bad_name_returns_422(client):
    resp = await client.post(
        "/api/v1/train/reward-files", files=_upload_files(filename=".hidden.py")
    )
    assert resp.status_code == 422

    not_py = await client.post(
        "/api/v1/train/reward-files", files=_upload_files(filename="rewards.txt")
    )
    assert not_py.status_code == 422


@pytest.mark.asyncio
async def test_delete_missing_returns_404(client):
    resp = await client.delete("/api/v1/train/reward-files/nope")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "not_found"


@pytest.mark.asyncio
async def test_config_with_reward_file_on_sft_returns_422(client):
    resp = await client.post(
        "/api/v1/train/jobs",
        json={
            "name": "bad-run",
            "model_id": "mlx-community/Tiny-1",
            "dataset_id": "ds_1",
            "train_mode": "sft",
            "reward_functions_file": "my_rewards",
        },
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "validation_error"
