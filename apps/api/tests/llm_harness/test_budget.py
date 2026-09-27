import pytest

from app.modules.llm_harness.budget import ContextBudgetError, fit_layers
from app.modules.llm_harness.models import ModelCatalog, ModelProfile, PromptLayer


def profile(window: int) -> ModelProfile:
    return ModelProfile(
        provider_id="ollama",
        model_id="test-model",
        context_window=window,
        working_window=window,
        output_limit=1024,
        token_safety_margin=128,
    )


def test_small_model_keeps_required_content_and_drops_optional():
    layers = [
        PromptLayer(key="rules", role="system", text="rules", required=True),
        PromptLayer(key="history", role="user", text="past " * 2000, priority=10),
        PromptLayer(key="action", role="user", text="continue", required=True),
    ]

    package = fit_layers(profile(4096), layers, output_reserve=512)

    assert package.layer_keys == ("rules", "action")
    assert package.omitted_keys == ("history",)
    assert package.estimated_tokens + 512 + 128 <= 4096


def test_larger_model_keeps_the_same_optional_history():
    layers = [
        PromptLayer(key="rules", role="system", text="rules", required=True),
        PromptLayer(key="history", role="user", text="past " * 2000, priority=10),
    ]

    package = fit_layers(profile(16384), layers, output_reserve=512)

    assert package.layer_keys == ("rules", "history")
    assert package.omitted_keys == ()


def test_required_content_never_truncates():
    layers = [PromptLayer(key="canon", role="system", text="canon " * 300, required=True)]

    with pytest.raises(ContextBudgetError):
        fit_layers(profile(512), layers, output_reserve=128)


def test_priority_selects_more_important_optional_layer_first():
    layers = [
        PromptLayer(key="rules", role="system", text="rules", required=True),
        PromptLayer(key="less", role="user", text="x" * 1600, priority=1),
        PromptLayer(key="more", role="user", text="y" * 1600, priority=2),
    ]

    package = fit_layers(profile(2048), layers, output_reserve=128)

    assert package.layer_keys == ("rules", "more")
    assert package.omitted_keys == ("less",)


def test_catalog_selects_context_by_provider_and_model():
    catalog = ModelCatalog(
        default_ollama_window=4096,
        windows={"ollama:large": 16384, "cloud:large": 32768},
    )

    assert catalog.resolve("ollama", "small").working_window == 4096
    assert catalog.resolve("ollama", "large").working_window == 16384
    assert catalog.resolve("cloud", "large").working_window == 32768
    with pytest.raises(ValueError):
        catalog.resolve("cloud", "unknown")


def test_response_schema_consumes_budget_without_becoming_user_text():
    layers = [
        PromptLayer(key="instruction", role="system", text="respond", required=True),
        PromptLayer(key="schema", role="schema", text="{" + "x" * 500 + "}", required=True),
    ]

    package = fit_layers(profile(1024), layers, output_reserve=128)

    assert package.estimated_tokens > 500
    assert package.content("user") == ""
