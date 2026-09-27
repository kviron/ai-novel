from collections.abc import Sequence

from .models import ModelProfile, PromptLayer, PromptPackage


class ContextBudgetError(Exception):
    """Required context or requested output cannot fit the selected model."""


def estimate_tokens(text: str) -> int:
    """Estimate without a tokenizer, biased high for mixed Russian and JSON text."""
    return (len(text.encode("utf-8")) + 1) // 2


def _layer_size(layer: PromptLayer) -> int:
    # Reserve role/message framing as well as text; native provider count can replace this estimate.
    return estimate_tokens(layer.text) + estimate_tokens(layer.role) + 32


def fit_layers(profile: ModelProfile, layers: Sequence[PromptLayer], output_reserve: int) -> PromptPackage:
    """Keep all required layers, then fit optional layers by descending priority."""
    if not 0 < output_reserve <= profile.output_limit:
        raise ContextBudgetError("Invalid response reserve")
    available = profile.working_window - output_reserve - profile.token_safety_margin
    if available <= 0:
        raise ContextBudgetError("No prompt budget remains")
    keys = [layer.key for layer in layers]
    if len(keys) != len(set(keys)):
        raise ValueError("Prompt layer keys must be unique")

    required = [layer for layer in layers if layer.required]
    used = sum(_layer_size(layer) for layer in required)
    if used > available:
        raise ContextBudgetError("Required prompt layers exceed the model budget")

    included = {layer.key for layer in required}
    optional = sorted((layer for layer in layers if not layer.required), key=lambda layer: -layer.priority)
    for layer in optional:
        size = _layer_size(layer)
        if used + size <= available:
            included.add(layer.key)
            used += size

    return PromptPackage(
        layers=tuple(layer for layer in layers if layer.key in included),
        omitted_keys=tuple(layer.key for layer in layers if layer.key not in included),
        estimated_tokens=used,
    )
