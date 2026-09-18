from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

APP_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """Validated application infrastructure configuration."""

    database_path: Path = Path("data/visual-novel.db")
    ollama_base_url: str = "http://127.0.0.1:11434"
    provider_timeout_seconds: float = 120.0

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @field_validator("database_path")
    @classmethod
    def resolve_database_path(cls, value: Path) -> Path:
        return value if value.is_absolute() else (APP_ROOT / value).resolve()


@lru_cache
def get_settings() -> Settings:
    return Settings()
