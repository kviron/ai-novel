from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request

from app.core.config import RuntimeSettingsDep
from app.core.errors import ProviderResponseError, ProviderUnavailableError
from app.modules.llm_harness.models import UnknownModelProfileError, catalog_for_model

from .contracts import ProviderStatus
from .service import ProviderRegistry, list_provider_statuses

router = APIRouter(prefix="/api/providers", tags=["Providers"])


def get_provider_registry(request: Request) -> ProviderRegistry:
    """Return the one registry assembled and owned by the application factory."""
    return request.app.state.providers


ProviderRegistryDep = Annotated[ProviderRegistry, Depends(get_provider_registry)]


@router.get("", response_model=list[ProviderStatus])
def read_provider_statuses(registry: ProviderRegistryDep) -> list[ProviderStatus]:
    return list_provider_statuses(registry)


@router.get("/traces/latest")
def read_latest_trace(registry: ProviderRegistryDep) -> dict:
    trace = registry.latest_trace()
    if trace is None:
        raise HTTPException(status_code=404, detail="No generation trace")
    return trace


@router.get("/profiles")
def read_model_profiles(registry: ProviderRegistryDep, settings: RuntimeSettingsDep) -> list[dict]:
    profiles: list[dict] = []
    for provider in registry.all():
        try:
            models = provider.list_models()
        except (ProviderUnavailableError, ProviderResponseError):
            continue
        for model_id in models:
            try:
                profile = catalog_for_model(
                    registry,
                    settings.ollama_context_tokens,
                    settings.model_context_windows,
                    provider.provider_id,
                    model_id,
                ).resolve(provider.provider_id, model_id)
            except (ProviderUnavailableError, ProviderResponseError, UnknownModelProfileError):
                profiles.append({"provider_id": provider.provider_id, "model_id": model_id, "usable": False})
                continue
            profiles.append(
                {
                    "provider_id": provider.provider_id,
                    "model_id": model_id,
                    "usable": True,
                    "native_window": profile.native_window,
                    "working_window": profile.working_window,
                }
            )
    return profiles
