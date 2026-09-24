from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class TurnCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    request_id: str = Field(min_length=1, max_length=100)
    expected_state_version: int = Field(ge=1)
    action: str = Field(min_length=1, max_length=4000)


class RewindRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_state_version: int = Field(ge=1)


class ModelChangeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    expected_state_version: int = Field(ge=1)
    model_id: str = Field(min_length=1, max_length=160)


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


class ProposedEffect(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: str
    value: str | int | float | bool


class TurnProposal(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "required": [
                "narration",
                "dialogue",
                "visual_directive",
                "suggested_choices",
                "proposed_effects",
            ]
        },
    )

    narration: str = Field(min_length=1, max_length=6000)
    dialogue: DialogueProposal
    visual_directive: VisualDirective
    suggested_choices: list[str] = Field(min_length=2, max_length=4)
    proposed_effects: list[ProposedEffect] = Field(default_factory=list, max_length=20)


class CanonicalVisualDirective(VisualDirective):
    character_id: str


class AcceptedTurn(BaseModel):
    """Canonical content after domain rules; carries no provider diagnostics."""

    speaker: str
    narration: str
    dialogue: str
    choices: list[str]
    visual_directive: CanonicalVisualDirective


class TurnResult(AcceptedTurn):
    id: str
    session_id: str
    request_id: str
    state_version: int
    action: str
    provider_id: str
    model_id: str
    prompt_version: str
    created_at: str
