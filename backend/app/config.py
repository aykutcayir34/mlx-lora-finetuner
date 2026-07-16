from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="MLXLF_", env_file=".env", extra="ignore")

    data_dir: Path = Path.home() / ".mlx-lora-finetuner"
    host: str = "127.0.0.1"
    port: int = 8000
    hf_token: str | None = None
    llama_cpp_dir: Path | None = None
    # Built frontend to serve from FastAPI in production. Defaults to the
    # repo's `frontend/dist` (resolved relative to this file, so a
    # `make build && mlxlf` from a git clone just works); override with
    # MLXLF_STATIC_DIR. When the directory has no index.html, nothing is
    # mounted and the app is API-only (the dev/test default).
    static_dir: Path = Path(__file__).resolve().parents[2] / "frontend" / "dist"

    @property
    def models_dir(self) -> Path:
        return self.data_dir / "models"

    @property
    def datasets_dir(self) -> Path:
        return self.data_dir / "datasets"

    @property
    def runs_dir(self) -> Path:
        return self.data_dir / "runs"

    @property
    def exports_dir(self) -> Path:
        return self.data_dir / "exports"

    @property
    def cache_dir(self) -> Path:
        return self.data_dir / "cache"

    @property
    def db_path(self) -> Path:
        return self.data_dir / "app.db"


@lru_cache
def get_settings() -> Settings:
    return Settings()
