from collections.abc import Iterable

from app.core.errors import ProviderResponseError, ProviderUnavailableError

from .contracts import LLMProvider, ProviderStatus


class ProviderRegistry:
    """Select configured providers by their stable public identifier."""

    def __init__(self, providers: Iterable[LLMProvider]) -> None:
        self._providers = {provider.provider_id: provider for provider in providers}

    def get(self, provider_id: str) -> LLMProvider:
        return self._providers[provider_id]

    def all(self) -> list[LLMProvider]:
        return list(self._providers.values())


def list_provider_statuses(registry: ProviderRegistry) -> list[ProviderStatus]:
    statuses: list[ProviderStatus] = []
    for provider in registry.all():
        try:
            statuses.append(provider.health())
        except (ProviderUnavailableError, ProviderResponseError) as error:
            statuses.append(
                ProviderStatus(
                    provider_id=provider.provider_id,
                    available=False,
                    detail=error.code,
                )
            )
    return statuses
