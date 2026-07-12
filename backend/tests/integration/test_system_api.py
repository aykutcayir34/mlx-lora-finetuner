import pytest


@pytest.mark.asyncio
async def test_health_returns_ok_status(client):
    response = await client.get("/api/v1/system/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "version" in data
    assert "mlx_version" in data
    assert "mlx_lm_lora_version" in data


@pytest.mark.asyncio
async def test_stats_returns_expected_shape(client):
    response = await client.get("/api/v1/system/stats")
    assert response.status_code == 200
    data = response.json()

    assert isinstance(data["memory"]["total_gb"], (int, float))
    assert isinstance(data["memory"]["used_gb"], (int, float))

    assert isinstance(data["disk"]["models_gb"], (int, float))
    assert isinstance(data["disk"]["datasets_gb"], (int, float))
    assert isinstance(data["disk"]["runs_gb"], (int, float))
    assert isinstance(data["disk"]["exports_gb"], (int, float))
    assert isinstance(data["disk"]["free_gb"], (int, float))

    assert data["active_run_id"] is None
    assert isinstance(data["data_dir"], str)
