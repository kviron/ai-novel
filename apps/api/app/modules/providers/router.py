from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request

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
