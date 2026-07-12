import pytest

ROUTES: list[tuple[str, str]] = [
    ("GET", "/models"),
    ("GET", "/models/search"),
    ("POST", "/models/download"),
    ("GET", "/models/downloads"),
    ("DELETE", "/models/foo"),
    ("GET", "/datasets"),
    ("POST", "/datasets/upload"),
    ("POST", "/datasets/ds_1/validate"),
    ("POST", "/datasets/ds_1/split"),
    ("GET", "/datasets/ds_1/preview"),
    ("DELETE", "/datasets/ds_1"),
    ("POST", "/train/jobs"),
    ("GET", "/train/jobs"),
    ("GET", "/train/jobs/run_1"),
    ("POST", "/train/jobs/run_1/cancel"),
    ("GET", "/train/jobs/run_1/metrics"),
    ("GET", "/train/jobs/run_1/logs"),
    ("GET", "/adapters"),
    ("POST", "/export/fuse"),
    ("GET", "/export/gguf/preflight?model_path=/tmp/x"),
    ("POST", "/export/gguf"),
    ("POST", "/export/ollama-modelfile"),
    ("GET", "/export/jobs/ex_1"),
    ("GET", "/export/artifacts"),
    ("GET", "/system/health"),
    ("GET", "/system/stats"),
]


@pytest.mark.asyncio
@pytest.mark.parametrize("method,path", ROUTES, ids=[f"{m} {p}" for m, p in ROUTES])
async def test_route_exists_and_does_not_404(client, method, path):
    url = f"/api/v1{path}"
    if method == "POST":
        response = await client.post(url, json={})
    elif method == "DELETE":
        response = await client.delete(url)
    else:
        response = await client.get(url)

    if response.status_code == 404:
        # A domain 404 in the contract error shape proves the route exists
        # (implemented endpoints correctly return not_found for fake ids);
        # a missing route yields FastAPI's default {"detail": "Not Found"}.
        assert response.json().get("error", {}).get("code") == "not_found"
