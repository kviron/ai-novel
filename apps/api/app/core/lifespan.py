from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI, Request
from pydantic import BaseModel
from sqlalchemy import Engine
from sqlmodel import Session

from app.core.config import Settings
from app.db.engine import create_engine_from_settings
from app.db.migrate import run_migrations
from app.modules.characters.materials import seed_builtin_materials
from app.modules.providers.ollama import OllamaProvider
from app.modules.providers.service import ProviderRegistry
from app.modules.stories.seed import seed_akane_story


class HealthResponse(BaseModel):
    status: str
    mode: str


router = APIRouter(tags=["Система"])


@router.get("/health", response_model=HealthResponse)
def read_health(request: Request) -> HealthResponse:
    with request.app.state.engine.connect() as connection:
        connection.exec_driver_sql("SELECT 1")
    return HealthResponse(status="ok", mode=request.app.state.settings.app_mode)


def create_provider_registry(settings: Settings) -> ProviderRegistry:
    """Create the production provider graph and its owned HTTP resources."""
    return ProviderRegistry(
        [
            OllamaProvider(
                base_url=settings.ollama_base_url,
                timeout_seconds=settings.provider_timeout_seconds,
            )
        ]
    )


def create_lifespan(
    settings: Settings,
    providers: ProviderRegistry,
    *,
    owns_providers: bool,
):
    """Build an atomic startup/shutdown boundary for database and provider resources."""

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        engine: Engine | None = None
        try:
            run_migrations(settings.database_path)
            engine = create_engine_from_settings(settings)
            app.state.engine = engine
            settings.asset_dir.mkdir(parents=True, exist_ok=True)
            with Session(engine) as session:
                seed_akane_story(session)
                seed_builtin_materials(session, settings.asset_dir)
                session.commit()
            yield
        finally:
            if engine is not None:
                engine.dispose()
            if owns_providers:
                providers.close()

    return lifespan
