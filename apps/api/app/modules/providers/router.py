from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends

from app.core.config import get_settings

from .contracts import ProviderStatus
from .ollama import OllamaProvider
from .service import ProviderRegistry, list_provider_statuses

router = APIRouter(prefix="/api/providers", tags=["Providers"])


@lru_cache
def get_provider_registry() -> ProviderRegistry:
    settings = get_settings()
    return ProviderRegistry(
        [
            OllamaProvider(
                base_url=settings.ollama_base_url,
                timeout_seconds=settings.provider_timeout_seconds,
            )
        ]
    )


ProviderRegistryDep = Annotated[ProviderRegistry, Depends(get_provider_registry)]


@router.get("", response_model=list[ProviderStatus])
def read_provider_statuses(registry: ProviderRegistryDep) -> list[ProviderStatus]:
    return list_provider_statuses(registry)
