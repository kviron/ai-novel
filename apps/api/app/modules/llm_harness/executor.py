import json
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal

from app.core.errors import ProviderResponseError, ProviderUnavailableError
from app.modules.providers.contracts import TextGenerationRequest, TurnGenerationRequest
from app.modules.providers.service import ProviderRegistry

from .budget import estimate_tokens, fit_layers
from .models import ModelCatalog, PromptLayer


@dataclass(frozen=True)
class GenerationTask:
    task_kind: str
    provider_id: str
    model_id: str
    output_kind: Literal["turn", "text"]
    system_prompt: str
    user_prompt: str
    response_schema: dict[str, Any]
    output_reserve: int | None = None
    validator: Callable[[Any], Any] | None = None
    retryable_errors: tuple[type[Exception], ...] = ()


@dataclass(frozen=True)
class GenerationTrace:
    task_kind: str
    provider_id: str
    model_id: str
    estimated_input_tokens: int
    context_window: int
    attempts: int
    omitted_layer_keys: tuple[str, ...]
    layer_sizes: dict[str, int]
    input_tokens_actual: int | None
    output_tokens_actual: int | None


@dataclass(frozen=True)
class GenerationResult:
    value: Any
    raw_response: str
    trace: GenerationTrace


class GenerationRejectedError(Exception):
    def __init__(self, raw_response: str = "") -> None:
        super().__init__("Model response failed validation after one correction")
        self.raw_response = raw_response


class LLMHarness:
    """The only application path that invokes a language-model provider."""

    def __init__(self, registry: ProviderRegistry, catalog: ModelCatalog) -> None:
        self._registry = registry
        self._catalog = catalog

    def run(self, task: GenerationTask) -> GenerationResult:
        profile = self._catalog.resolve(task.provider_id, task.model_id)
        try:
            provider = self._registry.get(task.provider_id)
        except KeyError:
            raise ProviderUnavailableError() from None
        user_prompt = task.user_prompt
        raw_response = ""
        for attempt in range(1, 3):
            layers = [
                PromptLayer("system", "system", task.system_prompt, required=True),
                PromptLayer("user", "user", user_prompt, required=True),
                PromptLayer("schema", "schema", json.dumps(task.response_schema, ensure_ascii=False), required=True),
            ]
            output_reserve = task.output_reserve or min(1024, profile.output_limit)
            package = fit_layers(profile, layers, output_reserve)
            try:
                if task.output_kind == "turn":
                    request = TurnGenerationRequest(
                        model_id=task.model_id,
                        system_prompt=package.content("system"),
                        user_prompt=package.content("user"),
                        response_schema=task.response_schema,
                        context_tokens=profile.working_window,
                        output_tokens=output_reserve,
                    )
                    proposal = provider.generate_turn(request)
                else:
                    request = TextGenerationRequest(
                        model_id=task.model_id,
                        system_prompt=package.content("system"),
                        user_prompt=package.content("user"),
                        context_tokens=profile.working_window,
                        output_tokens=output_reserve,
                    )
                    proposal = provider.generate_text(request)
                raw_response = proposal.model_dump_json()
                value = task.validator(proposal) if task.validator else proposal
                trace = GenerationTrace(
                    task_kind=task.task_kind,
                    provider_id=task.provider_id,
                    model_id=task.model_id,
                    estimated_input_tokens=package.estimated_tokens,
                    context_window=profile.working_window,
                    attempts=attempt,
                    omitted_layer_keys=package.omitted_keys,
                    layer_sizes={layer.key: estimate_tokens(layer.text) for layer in package.layers},
                    input_tokens_actual=getattr(proposal, "_usage", (None, None))[0],
                    output_tokens_actual=getattr(proposal, "_usage", (None, None))[1],
                )
                self._registry.record_trace(trace)
                return GenerationResult(value=value, raw_response=raw_response, trace=trace)
            except ProviderResponseError as error:
                if error.code == "model_unavailable":
                    raise
                raw_response = error.raw_response or ""
                reason = error.code
            except task.retryable_errors as error:
                reason = str(error)
            if attempt == 2:
                raise GenerationRejectedError(raw_response) from None
            # The correction carries a bounded error code, never the full invalid response.
            user_prompt = task.user_prompt + "\nИсправь ответ по схеме. Ошибка: " + reason[:120]
        raise AssertionError("Unreachable")
