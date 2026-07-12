import pytest


@pytest.mark.asyncio
async def test_unknown_route_returns_plain_404(client):
    response = await client.get("/api/v1/does-not-exist")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_app_error_returns_contract_error_shape(client):
    # Any AppError must render as {"error": {"code", "message", "detail"}};
    # a domain not_found on an implemented endpoint exercises the handler.
    response = await client.get("/api/v1/export/jobs/ex_does_not_exist")
    assert response.status_code == 404
    data = response.json()
    assert data["error"]["code"] == "not_found"
    assert "message" in data["error"]


@pytest.mark.asyncio
async def test_train_jobs_validation_error_has_standard_shape(client):
    response = await client.post(
        "/api/v1/train/jobs",
        json={
            "name": "my-run",
            "model_id": "mlx-community/x",
            "dataset_id": "ds_1",
            "train_mode": "dpo",
        },
    )
    assert response.status_code == 422
    data = response.json()
    assert data["error"]["code"] == "validation_error"
