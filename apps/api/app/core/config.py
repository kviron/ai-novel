from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

APP_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """Validated application infrastructure configuration."""

    app_mode: str = "demo"
    database_path: Path = Path("data/visual-novel.db")
    asset_dir: Path = Path("data/assets")
    ollama_base_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "qwen3:14b-q4_K_M"
    ollama_context_tokens: int = 16384
    provider_timeout_seconds: float = 120.0
    cors_origins: str = "http://localhost:5173"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @field_validator("database_path")
    @classmethod
    def resolve_database_path(cls, value: Path) -> Path:
        return value if value.is_absolute() else (APP_ROOT / value).resolve()

    @field_validator("asset_dir")
    @classmethod
    def resolve_asset_dir(cls, value: Path) -> Path:
        return value if value.is_absolute() else (APP_ROOT / value).resolve()


@lru_cache
def get_settings() -> Settings:
    return Settings()
