import pytest
from httpx import ASGITransport, AsyncClient


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
    # Typed AppErrors keep their real, useful message (unlike unexpected
    # exceptions, which are made generic — see the 500 test below).
    assert "ex_does_not_exist" in data["error"]["message"]


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


@pytest.mark.asyncio
async def test_unexpected_exception_returns_generic_500_without_leaking_detail(app):
    secret = "RuntimeError-with-secret-path-/home/someone/.ssh/id_rsa"

    async def _boom():
        raise RuntimeError(secret)

    app.router.add_api_route("/api/v1/_test/boom", _boom, methods=["GET"])

    # Starlette re-raises the exception after sending the 500 response, so the
    # ASGI test transport must be told not to propagate it into the test.
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        response = await ac.get("/api/v1/_test/boom")

    assert response.status_code == 500
    data = response.json()
    assert data["error"] == {"code": "internal", "message": "internal server error", "detail": {}}
    assert secret not in response.text
