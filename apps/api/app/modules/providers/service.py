from collections import deque
from collections.abc import Iterable
from dataclasses import asdict
from threading import Lock
from typing import Any

from app.core.errors import ProviderResponseError, ProviderUnavailableError

from .contracts import LLMProvider, ProviderStatus


class ProviderRegistry:
    """Select configured providers by their stable public identifier."""

    def __init__(self, providers: Iterable[LLMProvider]) -> None:
        self._providers = {provider.provider_id: provider for provider in providers}
        self._traces: deque[dict[str, Any]] = deque(maxlen=100)
        self._trace_lock = Lock()

    def record_trace(self, trace: Any) -> None:
        with self._trace_lock:
            self._traces.append(asdict(trace))

    def latest_trace(self) -> dict[str, Any] | None:
        with self._trace_lock:
            return dict(self._traces[-1]) if self._traces else None

    def get(self, provider_id: str) -> LLMProvider:
        return self._providers[provider_id]

    def all(self) -> list[LLMProvider]:
        return list(self._providers.values())

    def close(self) -> None:
        """Close provider-owned resources when the registry itself is application-owned."""
        for provider in self._providers.values():
            close = getattr(provider, "close", None)
            if close is not None:
                close()


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
