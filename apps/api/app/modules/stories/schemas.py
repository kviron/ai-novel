from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.modules.characters.schemas import SpriteVariant
from app.modules.providers.contracts import SceneSegment


class FixedHeroChoice(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_kind: Literal["fixed"]


class CatalogHeroChoice(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_kind: Literal["catalog"]
    character_id: str
    revision_id: str


class DraftHeroChoice(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    source_kind: Literal["draft"]
    name: str = Field(min_length=1, max_length=120)
    address: str | None = Field(default=None, max_length=120)
    gender: Literal["female", "male", "unspecified"] = "unspecified"
    appearance: str = Field(default="", max_length=6000)
    biography: str = Field(default="", max_length=6000)


HeroChoice = Annotated[FixedHeroChoice | CatalogHeroChoice | DraftHeroChoice, Field(discriminator="source_kind")]


class StartSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider_id: str = Field(default="ollama", min_length=1, max_length=40)
    model_id: str | None = Field(default=None, max_length=160)
    kind: Literal["player", "author"] = "player"
    hero: HeroChoice | None = None


class ProtagonistDetail(BaseModel):
    session_id: str
    source_kind: Literal["fixed", "catalog", "draft", "legacy"]
    source_character_id: str | None
    source_revision_id: str | None
    policy_version: int
    name: str
    address: str
    gender: str
    appearance: str
    biography: str
    personality: str
    age: int | None
    sprites: dict[str, list[SpriteVariant]] = Field(default_factory=dict)


class StorySummary(BaseModel):
    id: str
    current_published_version_id: str
    slug: str
    title: str
    premise: str
    description: str
    cover_image_url: str | None
    story_mode: Literal["hybrid", "freeform"]
    recommended_provider_id: str
    recommended_model_id: str


class CharacterDetail(BaseModel):
    id: str
    revision_id: str
    name: str
    gender: str
    age: int
    personality: str
    appearance: str
    role: str
    color: str = "#D9A75F"
    visual_profile_version: int
    sprite_contract_version: int = 1
    sprites: dict[str, list[SpriteVariant]] = Field(default_factory=dict)


class FixedHeroDetail(CharacterDetail):
    biography: str


class StorySetup(BaseModel):
    story_id: str
    policy: Literal["fixed", "choice"]
    policy_version: int
    allowed_sources: list[Literal["catalog", "draft"]]
    playable_character_ids: list[str]
    fixed_hero: FixedHeroDetail | None = None


class ProtagonistCatalogCompletion(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    age: int | None = Field(default=None, ge=18)
    personality: str | None = Field(default=None, min_length=1, max_length=6000)
    appearance: str | None = Field(default=None, min_length=1, max_length=6000)


class StoryDetail(StorySummary):
    current_scene: str
    characters: list[CharacterDetail]


class VisualState(BaseModel):
    emotion: str = "neutral"
    pose: str = "default"
    outfit: str = "red_dress"
    background: str = "neon_crossroads"


class TurnDetail(BaseModel):
    id: str
    state_version: int
    action: str
    prompt_version: str
    speaker: str
    narration: str
    dialogue: str
    segments: list[SceneSegment]
    choices: list[str]
    visual_directive: dict[str, str | list[str]]


class SessionDetail(BaseModel):
    id: str
    story: StorySummary
    characters: list[CharacterDetail]
    protagonist: ProtagonistDetail
    state_version: int
    can_rewind: bool
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
