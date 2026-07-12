import json

import pytest

from app.config import get_settings


@pytest.fixture
def registry_settings(tmp_path, monkeypatch):
    monkeypatch.setenv("MLXLF_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    settings = get_settings()
    settings.models_dir.mkdir(parents=True, exist_ok=True)
    yield settings
    get_settings.cache_clear()


def write_local_model(models_dir, org: str, name: str, config: dict, extra_files: dict | None = None):
    model_dir = models_dir / f"{org}__{name}"
    model_dir.mkdir(parents=True, exist_ok=True)
    (model_dir / "config.json").write_text(json.dumps(config))
    for filename, content in (extra_files or {}).items():
        (model_dir / filename).write_bytes(content)
    return model_dir
