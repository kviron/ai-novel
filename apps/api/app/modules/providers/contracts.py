from collections.abc import Mapping
from types import MappingProxyType
from typing import Any, Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr, field_serializer, field_validator


class DialogueProposal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    character_id: str
    text: str = Field(min_length=1, max_length=4000)


class SceneSegment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["narration", "dialogue"]
    text: str = Field(min_length=1, max_length=4000)
    character_id: str | None = None


class VisualDirective(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Literal["sprite_scene"] = "sprite_scene"
    emotion: str
    pose: str = "default"
    outfit: str = "red_dress"
    background: str | None = None
    present_character_ids: list[str] | None = Field(default=None, max_length=12)
    protagonist_emotion: str | None = None


class ProposedEffect(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: str
    value: str | int | float | bool


class CanonAssessment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fact_id: str = Field(min_length=1, max_length=120)
    status: Literal["upheld", "violated"]
    evidence: str = Field(min_length=1, max_length=4000)


class TurnProposal(BaseModel):
    """Provider output is untrusted until the story engine validates it."""

    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={"required": ["segments", "visual_directive", "suggested_choices", "proposed_effects"]},
    )
    _usage: tuple[int | None, int | None] = PrivateAttr(default=(None, None))

    # Legacy test/provider payloads remain readable; the new prompt schema requires segments.
    narration: str | None = Field(default=None, max_length=6000)
    dialogue: DialogueProposal | None = None
    segments: list[SceneSegment] | None = Field(default=None, min_length=1, max_length=12)
    visual_directive: VisualDirective
    suggested_choices: list[str] = Field(default_factory=list, max_length=6)
    proposed_effects: list[ProposedEffect] = Field(default_factory=list, max_length=20)
    canon_assessments: list[CanonAssessment] = Field(default_factory=list, max_length=100)
    completed_beat_ids: list[str] = Field(default_factory=list, max_length=100)
    requests_ending: bool = False


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
    output_tokens: int = 1024

    @field_validator("response_schema", mode="after")
    @classmethod
    def freeze_response_schema(cls, value: Mapping[str, Any]) -> Mapping[str, Any]:
        return _freeze_json(value)

    @field_serializer("response_schema")
    def serialize_response_schema(self, value: Mapping[str, Any]) -> dict[str, Any]:
        return _mutable_json_copy(value)


class TextGenerationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    model_id: str
    system_prompt: str
    user_prompt: str
    context_tokens: int = 16384
    output_tokens: int = 1024


class TextProposal(BaseModel):
    model_config = ConfigDict(extra="forbid")
    _usage: tuple[int | None, int | None] = PrivateAttr(default=(None, None))

    text: str = Field(min_length=1, max_length=6000)


class LLMProvider(Protocol):
    provider_id: str

    def health(self) -> ProviderStatus: ...

    def list_models(self) -> list[str]: ...

    def generate_turn(self, request: TurnGenerationRequest) -> TurnProposal: ...

    def generate_text(self, request: TextGenerationRequest) -> TextProposal: ...


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
