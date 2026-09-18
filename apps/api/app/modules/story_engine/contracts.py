from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


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
