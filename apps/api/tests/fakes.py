from app.modules.providers.contracts import ProviderStatus, TextGenerationRequest, TextProposal, TurnGenerationRequest
from app.modules.story_engine.contracts import TurnProposal


class FakeLLMProvider:
    def __init__(
        self,
        *,
        provider_id: str = "ollama",
        responses: list[TurnProposal] | None = None,
        errors: list[Exception] | None = None,
        models: list[str] | None = None,
    ) -> None:
        self.provider_id = provider_id
        self.responses = list(responses or [])
        self.errors = list(errors or [])
        self.models = list(models or [])
        self.call_count = 0
        self.text_responses: list[str] = []
        self.last_text_request: TextGenerationRequest | None = None

    def health(self) -> ProviderStatus:
        self._raise_next_error()
        return ProviderStatus(
            provider_id=self.provider_id,
            available=True,
            detail="available",
            models=self.models,
        )

    def list_models(self) -> list[str]:
        self._raise_next_error()
        return list(self.models)

    def generate_turn(self, request: TurnGenerationRequest) -> TurnProposal:
        self.call_count += 1
        self._raise_next_error()
        if not self.responses:
            raise AssertionError("FakeLLMProvider has no queued response")
        return self.responses.pop(0)

    def generate_text(self, request: TextGenerationRequest) -> TextProposal:
        self.last_text_request = request
        self._raise_next_error()
        if not self.text_responses:
            raise AssertionError("FakeLLMProvider has no queued text response")
        return TextProposal(text=self.text_responses.pop(0))

    def _raise_next_error(self) -> None:
        if self.errors:
            raise self.errors.pop(0)
