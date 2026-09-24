import re

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.routing import APIRoute

from app.core.config import Settings, get_settings
from app.core.errors import install_exception_handlers
from app.core.lifespan import create_lifespan, create_provider_registry
from app.core.lifespan import router as health_router
from app.modules.characters.router import router as characters_router
from app.modules.providers.router import router as providers_router
from app.modules.providers.service import ProviderRegistry
from app.modules.stories.router import router as stories_router
from app.modules.story_engine.router import router as story_engine_router


def _operation_id(route: APIRoute) -> str:
    method = min(route.methods).lower()
    path = re.sub(r"[^a-zA-Z0-9]+", "_", route.path).strip("_") or "root"
    return f"{method}_{path}"


def create_app(
    settings_override: Settings | None = None,
    provider_registry_override: ProviderRegistry | None = None,
) -> FastAPI:
    """Assemble one application graph for both Uvicorn and tests."""
    settings = settings_override if settings_override is not None else get_settings()
    owns_providers = provider_registry_override is None
    providers = (
        provider_registry_override if provider_registry_override is not None else create_provider_registry(settings)
    )
    app = FastAPI(
        title="API нейровизуальной новеллы",
        version="0.2.0",
        lifespan=create_lifespan(settings, providers, owns_providers=owns_providers),
        generate_unique_id_function=_operation_id,
    )
    app.state.settings = settings
    app.state.providers = providers
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()],
        allow_methods=["GET", "POST", "PUT"],
        allow_headers=["Content-Type"],
    )
    install_exception_handlers(app)
    app.include_router(health_router)
    app.include_router(providers_router)
    app.include_router(stories_router)
    app.include_router(characters_router)
    app.include_router(story_engine_router)
    return app


app = create_app()
