import pytest

from app.modules.llm_harness.budget import ContextBudgetError
from app.modules.llm_harness.executor import GenerationTask, LLMHarness
from app.modules.llm_harness.models import ModelCatalog
from app.modules.providers.service import ProviderRegistry
from tests.fakes import FakeLLMProvider


def test_text_task_uses_selected_model_and_bounded_context():
    provider = FakeLLMProvider(models=["large"])
    provider.text_responses = ["Готово"]
    harness = LLMHarness(ProviderRegistry([provider]), ModelCatalog(4096, {"ollama:large": 8192}))

    result = harness.run(
        GenerationTask(
            task_kind="character_field",
            provider_id="ollama",
            model_id="large",
            output_kind="text",
            system_prompt="Редактируй",
            user_prompt="Описание",
            response_schema={"type": "object"},
            output_reserve=256,
        )
    )

    assert result.value.text == "Готово"
    assert provider.last_text_request.context_tokens == 8192
    assert result.trace.task_kind == "character_field"
    assert result.trace.estimated_input_tokens > 0


def test_oversized_required_request_never_reaches_provider():
    provider = FakeLLMProvider(models=["small"])
    harness = LLMHarness(ProviderRegistry([provider]), ModelCatalog(1024))

    with pytest.raises(ContextBudgetError):
        harness.run(
            GenerationTask(
                task_kind="character_field",
                provider_id="ollama",
                model_id="small",
                output_kind="text",
                system_prompt="rules",
                user_prompt="x" * 3000,
                response_schema={"type": "object"},
                output_reserve=256,
            )
        )

    assert provider.last_text_request is None


def test_trace_records_only_safe_sizes_and_usage():
    provider = FakeLLMProvider(models=["large"])
    provider.text_responses = ["Готово"]
    registry = ProviderRegistry([provider])
    harness = LLMHarness(registry, ModelCatalog(8192))
    result = harness.run(
        GenerationTask(
            task_kind="character_field",
            provider_id="ollama",
            model_id="large",
            output_kind="text",
            system_prompt="secret system",
            user_prompt="secret draft",
            response_schema={"type": "object"},
        )
    )

    trace = registry.latest_trace()
    assert trace is not None
    assert trace["layer_sizes"]["user"] > 0
    assert trace["input_tokens_actual"] is None
    assert "secret" not in str(trace)
    assert result.trace.attempts == 1
