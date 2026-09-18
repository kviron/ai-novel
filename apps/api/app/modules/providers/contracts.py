from typing import Any, Protocol

from pydantic import BaseModel, ConfigDict, Field

from app.modules.story_engine.contracts import TurnProposal


class ProviderStatus(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider_id: str
    available: bool
    detail: str
    models: list[str] = Field(default_factory=list)


class TurnGenerationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    model_id: str
    system_prompt: str
    user_prompt: str
    response_schema: dict[str, Any]
    context_tokens: int = 16384


class LLMProvider(Protocol):
    provider_id: str

    def health(self) -> ProviderStatus: ...

    def list_models(self) -> list[str]: ...

    def generate_turn(self, request: TurnGenerationRequest) -> TurnProposal: ...
