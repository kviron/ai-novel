from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class ModelProfile:
    """Verified limits for one provider/model pair and the configured working window."""

    provider_id: str
    model_id: str
    context_window: int
    working_window: int
    output_limit: int
    token_safety_margin: int

    def __post_init__(self) -> None:
        if not self.provider_id or not self.model_id:
            raise ValueError("A model profile needs provider and model IDs")
        if self.context_window <= 0 or not 0 < self.working_window <= self.context_window:
            raise ValueError("The working window must fit the model context window")
        if self.output_limit <= 0 or self.token_safety_margin < 0:
            raise ValueError("Output limit and safety margin must be valid")


class ModelCatalog:
    """Resolve configured working windows without guessing cloud model limits."""

    def __init__(self, default_ollama_window: int, windows: Mapping[str, int] | None = None) -> None:
        if default_ollama_window <= 0:
            raise ValueError("Default Ollama context must be positive")
        self._default_ollama_window = default_ollama_window
        self._windows = dict(windows or {})
        if any(window <= 0 for window in self._windows.values()):
            raise ValueError("Model windows must be positive")

    def resolve(self, provider_id: str, model_id: str) -> ModelProfile:
        window = self._windows.get(f"{provider_id}:{model_id}")
        if window is None and (provider_id == "ollama" or (provider_id, model_id) == ("legacy", "legacy")):
            window = self._default_ollama_window
        if window is None:
            raise ValueError(f"No verified context window for {provider_id}/{model_id}")
        return ModelProfile(
            provider_id=provider_id,
            model_id=model_id,
            context_window=window,
            working_window=window,
            output_limit=min(4096, max(256, window // 4)),
            token_safety_margin=max(128, window * 15 // 100),
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
