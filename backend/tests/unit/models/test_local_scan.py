import pytest

from app.services.model_registry import ModelRegistry
from tests.unit.models.conftest import write_local_model


@pytest.mark.asyncio
async def test_scan_finds_quantized_and_unquantized_models(registry_settings):
    write_local_model(
        registry_settings.models_dir,
        "mlx-community",
        "SmolLM-135M-Instruct-4bit",
        {"model_type": "llama", "quantization": {"bits": 4, "group_size": 64}},
        extra_files={"model.safetensors": b"x" * 100},
    )
    write_local_model(
        registry_settings.models_dir,
        "mlx-community",
        "Qwen2.5-0.5B",
        {"model_type": "qwen2"},
        extra_files={"model.safetensors": b"y" * 50},
    )

    registry = ModelRegistry(registry_settings)
    models = await registry.list_local_models()

    assert len(models) == 2
    by_id = {m.model_id: m for m in models}

    quantized = by_id["mlx-community/SmolLM-135M-Instruct-4bit"]
    assert quantized.quantization is not None
    assert quantized.quantization.bits == 4
    assert quantized.quantization.group_size == 64
    assert quantized.model_type == "llama"
    assert quantized.size_bytes >= 100

    unquantized = by_id["mlx-community/Qwen2.5-0.5B"]
    assert unquantized.quantization is None
    assert unquantized.model_type == "qwen2"
    assert unquantized.size_bytes >= 50


@pytest.mark.asyncio
async def test_scan_ignores_dirs_without_config_json(registry_settings):
    (registry_settings.models_dir / "not-a-model__dir").mkdir(parents=True)
    ((registry_settings.models_dir / "not-a-model__dir") / "readme.txt").write_text("hi")

    registry = ModelRegistry(registry_settings)
    models = await registry.list_local_models()
    assert models == []


@pytest.mark.asyncio
async def test_scan_empty_models_dir_returns_empty_list(registry_settings):
    registry = ModelRegistry(registry_settings)
    assert await registry.list_local_models() == []


@pytest.mark.asyncio
async def test_missing_models_dir_returns_empty_list(tmp_path, monkeypatch):
    from app.config import get_settings

    monkeypatch.setenv("MLXLF_DATA_DIR", str(tmp_path / "does-not-exist-yet"))
    get_settings.cache_clear()
    settings = get_settings()
    registry = ModelRegistry(settings)
    assert await registry.list_local_models() == []
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_size_cache_invalidates_on_dir_mtime_change(registry_settings):
    model_dir = write_local_model(
        registry_settings.models_dir,
        "mlx-community",
        "Tiny",
        {"model_type": "llama"},
        extra_files={"a.bin": b"a" * 10},
    )

    registry = ModelRegistry(registry_settings)
    models = await registry.list_local_models()
    first_size = models[0].size_bytes
    assert first_size >= 10

    # Cache should be hit (same mtime) and return the same cached value.
    cache_key = str(model_dir)
    assert cache_key in registry._size_cache
    cached_mtime, cached_size = registry._size_cache[cache_key]
    assert cached_size == first_size

    # Adding a new file changes the directory's mtime -> cache must invalidate.
    (model_dir / "b.bin").write_bytes(b"b" * 40)
    models_after = await registry.list_local_models()
    second_size = models_after[0].size_bytes
    assert second_size > first_size


@pytest.mark.asyncio
async def test_downloaded_at_reflects_dir_mtime(registry_settings):
    write_local_model(
        registry_settings.models_dir,
        "mlx-community",
        "Tiny",
        {"model_type": "llama"},
    )
    registry = ModelRegistry(registry_settings)
    models = await registry.list_local_models()
    assert models[0].downloaded_at  # non-empty ISO string
    assert "T" in models[0].downloaded_at
