from collections.abc import Mapping
from types import MappingProxyType
from typing import Any, Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator


class DialogueProposal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    character_id: str
    text: str = Field(min_length=1, max_length=4000)


class VisualDirective(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Literal["sprite_scene"] = "sprite_scene"
    emotion: str
    pose: str = "default"
    outfit: str = "red_dress"
    background: str | None = None


class ProposedEffect(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: str
    value: str | int | float | bool


class TurnProposal(BaseModel):
    """Provider output is untrusted until the story engine validates it."""

    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "required": ["narration", "dialogue", "visual_directive", "suggested_choices", "proposed_effects"]
        },
    )

    narration: str = Field(min_length=1, max_length=6000)
    dialogue: DialogueProposal
    visual_directive: VisualDirective
    suggested_choices: list[str] = Field(min_length=2, max_length=4)
    proposed_effects: list[ProposedEffect] = Field(default_factory=list, max_length=20)


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
    response_schema: Mapping[str, Any]
    context_tokens: int = 16384

    @field_validator("response_schema", mode="after")
    @classmethod
    def freeze_response_schema(cls, value: Mapping[str, Any]) -> Mapping[str, Any]:
        return _freeze_json(value)

    @field_serializer("response_schema")
    def serialize_response_schema(self, value: Mapping[str, Any]) -> dict[str, Any]:
        return _mutable_json_copy(value)


class LLMProvider(Protocol):
    provider_id: str

    def health(self) -> ProviderStatus: ...

    def list_models(self) -> list[str]: ...

    def generate_turn(self, request: TurnGenerationRequest) -> TurnProposal: ...


def _freeze_json(value: Any) -> Any:
    if isinstance(value, Mapping):
        return MappingProxyType({key: _freeze_json(item) for key, item in value.items()})
    if isinstance(value, (list, tuple)):
        return tuple(_freeze_json(item) for item in value)
    return value


def _mutable_json_copy(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {key: _mutable_json_copy(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_mutable_json_copy(item) for item in value]
    return value
