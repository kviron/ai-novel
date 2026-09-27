from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal

from app.modules.providers.service import ProviderRegistry


class UnknownModelProfileError(ValueError):
    pass


@dataclass(frozen=True)
class ModelProfile:
    """Verified limits for one provider/model pair and the configured working window."""

    provider_id: str
    model_id: str
    context_window: int
    working_window: int
    output_limit: int
    token_safety_margin: int
    native_window: int | None = None

    def __post_init__(self) -> None:
        if not self.provider_id or not self.model_id:
            raise ValueError("A model profile needs provider and model IDs")
        if self.context_window <= 0 or not 0 < self.working_window <= self.context_window:
            raise ValueError("The working window must fit the model context window")
        if self.output_limit <= 0 or self.token_safety_margin < 0:
            raise ValueError("Output limit and safety margin must be valid")


class ModelCatalog:
    """Resolve configured working windows without guessing cloud model limits."""

    def __init__(
        self,
        default_ollama_window: int,
        windows: Mapping[str, int] | None = None,
        native_windows: Mapping[str, int] | None = None,
        configured_windows: Mapping[str, int] | None = None,
    ) -> None:
        if default_ollama_window <= 0:
            raise ValueError("Default Ollama context must be positive")
        self._default_ollama_window = default_ollama_window
        self._windows = dict(windows or {})
        self._native_windows = dict(native_windows or {})
        self._configured_windows = dict(configured_windows or {})
        if any(window <= 0 for window in self._windows.values()):
            raise ValueError("Model windows must be positive")
        if any(window <= 0 for window in self._native_windows.values()):
            raise ValueError("Native model windows must be positive")
        if any(window <= 0 for window in self._configured_windows.values()):
            raise ValueError("Configured model windows must be positive")

    def resolve(self, provider_id: str, model_id: str) -> ModelProfile:
        key = f"{provider_id}:{model_id}"
        window = self._windows.get(key)
        if window is None:
            window = self._configured_windows.get(key)
        if window is None and (provider_id == "ollama" or (provider_id, model_id) == ("legacy", "legacy")):
            window = self._default_ollama_window
        if window is None:
            raise UnknownModelProfileError(f"No verified context window for {provider_id}/{model_id}")
        native = self._native_windows.get(key)
        working = min(window, native) if native is not None else window
        return ModelProfile(
            provider_id=provider_id,
            model_id=model_id,
            context_window=native or window,
            working_window=working,
            output_limit=min(4096, max(256, working // 4)),
            token_safety_margin=max(128, working * 15 // 100),
            native_window=native,
        )


def catalog_for_model(
    registry: ProviderRegistry,
    default_ollama_window: int,
    windows: Mapping[str, int] | None,
    provider_id: str,
    model_id: str,
) -> ModelCatalog:
    """Pin the native limit for this invocation when the adapter can report it."""
    try:
        provider = registry.get(provider_id)
    except KeyError:
        return ModelCatalog(default_ollama_window, windows)
    read_limit = getattr(provider, "model_context_window", None)
    native = read_limit(model_id) if callable(read_limit) else None
    read_configured = getattr(provider, "model_configured_context_window", None)
    configured = read_configured(model_id) if callable(read_configured) else None
    key = f"{provider_id}:{model_id}"
    return ModelCatalog(
        default_ollama_window,
        windows,
        {key: native} if native is not None else None,
        {key: configured} if configured is not None else None,
    )


@dataclass(frozen=True)
class PromptLayer:
    """One separately measurable piece of context with a stable source key."""

    key: str
    role: Literal["system", "user", "schema"]
    text: str
    required: bool = False
    priority: int = 0


@dataclass(frozen=True)
class PromptPackage:
    layers: tuple[PromptLayer, ...]
    omitted_keys: tuple[str, ...]
    estimated_tokens: int

    @property
    def layer_keys(self) -> tuple[str, ...]:
        return tuple(layer.key for layer in self.layers)

    def content(self, role: Literal["system", "user"]) -> str:
        return "\n\n".join(layer.text for layer in self.layers if layer.role == role)
