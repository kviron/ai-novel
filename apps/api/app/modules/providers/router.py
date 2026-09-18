from typing import Annotated

from fastapi import APIRouter, Depends, Request

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
