from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class StartSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider_id: str = Field(default="ollama", min_length=1, max_length=40)
    model_id: str | None = Field(default=None, max_length=160)
    kind: Literal["player", "author"] = "player"


class StorySummary(BaseModel):
    id: str
    slug: str
    title: str
    premise: str
    description: str
    cover_image_url: str | None
    story_mode: Literal["hybrid", "free"]
    recommended_provider_id: str
    recommended_model_id: str


class CharacterDetail(BaseModel):
    id: str
    name: str
    age: int
    personality: str
    appearance: str
    visual_profile_version: int


class StoryDetail(StorySummary):
    current_scene: str
    characters: list[CharacterDetail]


class VisualState(BaseModel):
    emotion: str = "neutral"
    pose: str = "default"
    outfit: str = "red_dress"


class TurnDetail(BaseModel):
    id: str
    state_version: int
    action: str
    prompt_version: str
    speaker: str
    narration: str
    dialogue: str
    choices: list[str]
    visual_directive: dict[str, str]


class SessionDetail(BaseModel):
    id: str
    story: StorySummary
    characters: list[CharacterDetail]
    state_version: int
    current_scene: str
    provider_id: str
    model_id: str
    latest_turn: TurnDetail | None
    visual_state: VisualState


class SessionSummary(BaseModel):
    id: str
    story: StorySummary
    state_version: int
    current_scene: str
    created_at: str
    updated_at: str
