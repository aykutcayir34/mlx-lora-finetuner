from dataclasses import dataclass

import pytest

from app.core.errors import InternalError
from app.services.model_registry import ModelRegistry
from tests.unit.models.conftest import write_local_model


@dataclass
class _FakeHit:
    id: str
    downloads: int | None = 0
    likes: int | None = 0


class _FakeHfApi:
    """Stand-in for huggingface_hub.HfApi capturing call kwargs for assertions."""

    last_kwargs: dict | None = None
    hits: list[_FakeHit] = []
    raise_error: Exception | None = None

    def __init__(self, token=None):
        self.token = token

    def list_models(self, **kwargs):
        _FakeHfApi.last_kwargs = kwargs
        if _FakeHfApi.raise_error is not None:
            raise _FakeHfApi.raise_error
        return list(_FakeHfApi.hits)


@pytest.fixture(autouse=True)
def _reset_fake_api():
    _FakeHfApi.last_kwargs = None
    _FakeHfApi.hits = []
    _FakeHfApi.raise_error = None
    yield


@pytest.mark.asyncio
async def test_default_author_applied_when_omitted_and_no_slash_in_q(registry_settings, monkeypatch):
    monkeypatch.setattr("app.services.model_registry.HfApi", _FakeHfApi)
    registry = ModelRegistry(registry_settings)

    await registry.search_models(q="smol", author=None, limit=20)

    assert _FakeHfApi.last_kwargs["author"] == "mlx-community"
    assert _FakeHfApi.last_kwargs["search"] == "smol"


@pytest.mark.asyncio
async def test_default_author_not_applied_when_q_has_slash(registry_settings, monkeypatch):
    monkeypatch.setattr("app.services.model_registry.HfApi", _FakeHfApi)
    registry = ModelRegistry(registry_settings)

    await registry.search_models(q="mlx-community/SmolLM-135M", author=None, limit=20)

    assert _FakeHfApi.last_kwargs["author"] is None


@pytest.mark.asyncio
async def test_explicit_author_is_respected(registry_settings, monkeypatch):
    monkeypatch.setattr("app.services.model_registry.HfApi", _FakeHfApi)
    registry = ModelRegistry(registry_settings)

    await registry.search_models(q=None, author="someone-else", limit=20)

    assert _FakeHfApi.last_kwargs["author"] == "someone-else"


@pytest.mark.asyncio
async def test_search_annotates_downloaded_from_local_registry(registry_settings, monkeypatch):
    write_local_model(
        registry_settings.models_dir,
        "mlx-community",
        "SmolLM-135M-Instruct-4bit",
        {"model_type": "llama"},
    )
    monkeypatch.setattr("app.services.model_registry.HfApi", _FakeHfApi)
    _FakeHfApi.hits = [
        _FakeHit(id="mlx-community/SmolLM-135M-Instruct-4bit", downloads=100, likes=5),
        _FakeHit(id="mlx-community/Other-Model", downloads=3, likes=1),
    ]
    registry = ModelRegistry(registry_settings)

    results = await registry.search_models(q=None, author=None, limit=20)

    by_id = {r.model_id: r for r in results}
    assert by_id["mlx-community/SmolLM-135M-Instruct-4bit"].downloaded is True
    assert by_id["mlx-community/Other-Model"].downloaded is False
    assert by_id["mlx-community/SmolLM-135M-Instruct-4bit"].downloads == 100
    assert by_id["mlx-community/SmolLM-135M-Instruct-4bit"].likes == 5
    assert by_id["mlx-community/SmolLM-135M-Instruct-4bit"].size_bytes is None


@pytest.mark.asyncio
async def test_search_hf_error_becomes_internal_error(registry_settings, monkeypatch):
    monkeypatch.setattr("app.services.model_registry.HfApi", _FakeHfApi)
    _FakeHfApi.raise_error = ConnectionError("boom")
    registry = ModelRegistry(registry_settings)

    with pytest.raises(InternalError) as exc_info:
        await registry.search_models(q="x", author=None, limit=20)

    assert exc_info.value.status_code == 502
