import pytest


@pytest.mark.asyncio
async def test_unknown_route_returns_plain_404(client):
    response = await client.get("/api/v1/does-not-exist")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_stub_endpoint_returns_not_implemented_error_shape(client):
    response = await client.get("/api/v1/models")
    assert response.status_code == 501
    data = response.json()
    assert data["error"]["code"] == "not_implemented"


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
