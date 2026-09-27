from __future__ import annotations

import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

_UNSAFE_ASCII_CONTROL = re.compile(r"[\x00-\x09\x0b-\x1f\x7f]")
_HTML_LIKE_MARKUP = re.compile(r"<(?:/?[A-Za-z]|!|\?)")


def _reject_unsafe_text(value: object) -> object:
    if isinstance(value, str):
        normalized = value.replace("\r\n", "\n")
        if _UNSAFE_ASCII_CONTROL.search(normalized):
            raise ValueError("ASCII control characters are not allowed in author text")
        if _HTML_LIKE_MARKUP.search(normalized):
            raise ValueError("HTML-like markup is not allowed in author text")
        return normalized
    if isinstance(value, dict):
        return {key: _reject_unsafe_text(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_reject_unsafe_text(item) for item in value]
    if isinstance(value, tuple):
        return tuple(_reject_unsafe_text(item) for item in value)
    return value


class StrictAuthorModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    @model_validator(mode="before")
    @classmethod
    def reject_unsafe_author_text(cls, value: object) -> object:
        return _reject_unsafe_text(value)


ShortText = Annotated[str, Field(max_length=120)]
Prose = Annotated[str, Field(max_length=6000)]
ShortList = Annotated[list[ShortText], Field(max_length=24)]


class StoryIdentitySection(StrictAuthorModel):
    title: ShortText = ""
    slug: str = Field(default="", max_length=120, pattern=r"^(?:[a-z0-9]+(?:-[a-z0-9]+)*)?$")
    short_description: str = Field(default="", max_length=500)
    premise: Prose = ""
    cover_material_id: ShortText | None = None
    genres: ShortList = Field(default_factory=list)
    tone: ShortList = Field(default_factory=list)
    setting: Prose = ""
    opening_situation: Prose = ""
    content_rating: Literal["adult_18_plus"] = "adult_18_plus"


class StoryModeSection(StrictAuthorModel):
    mode: Literal["freeform", "hybrid"] = "freeform"


class StoryHeroSection(StrictAuthorModel):
    hero_policy: Literal["fixed", "choice"] = "choice"
    hero_allowed_sources: Annotated[list[Literal["catalog", "draft"]], Field(max_length=24)] = Field(
        default_factory=lambda: ["catalog", "draft"]
    )
    fixed_hero_revision_id: ShortText | None = None


class StoryCastMember(StrictAuthorModel):
    id: ShortText
    character_id: ShortText
    revision_id: ShortText
    order_index: int = Field(ge=0)
    role: Prose = "cast"
    color: str = Field(default="#D9A75F", pattern=r"^#[0-9A-Fa-f]{6}$")
    playable: bool = False


class StoryCastSection(StrictAuthorModel):
    characters: Annotated[list[StoryCastMember], Field(max_length=24)] = Field(default_factory=list)


class GenerationPolicy(StrictAuthorModel):
    narration_perspective: Literal["first_person", "second_person", "third_person"] = "second_person"
    prose_density: Literal["concise", "balanced", "detailed"] = "balanced"
    choice_policy: Literal["choices_and_free_input", "choices_only", "free_input_only"] = "choices_and_free_input"
    min_choices: int = Field(default=2, ge=0, le=6)
    max_choices: int = Field(default=4, ge=0, le=6)
    allow_romance: bool = True
    allow_violence: bool = True
    allow_horror: bool = True
    allow_sexual_themes: bool = False
    desired_themes: Prose = ""
    forbidden_outcomes: Prose = ""


class StoryRulesSection(StrictAuthorModel):
    themes_allowed: ShortList = Field(default_factory=list)
    themes_blocked: ShortList = Field(default_factory=list)
    ending_policy: Literal["open_ended", "model_may_end", "required_beats_then_end"] = "open_ended"
    generation_policy: GenerationPolicy = Field(default_factory=GenerationPolicy)
    recommended_provider_id: ShortText = "ollama"
    recommended_model_id: ShortText = "qwen3:14b-q4_K_M"


class AlwaysCondition(StrictAuthorModel):
    kind: Literal["always"] = "always"


class AfterTurnCountCondition(StrictAuthorModel):
    kind: Literal["after_turn_count"]
    turn_count: int = Field(ge=0)


class AfterBeatCondition(StrictAuthorModel):
    kind: Literal["after_beat"]
    beat_id: str = Field(min_length=1, max_length=120)


BeatCondition = Annotated[
    AlwaysCondition | AfterTurnCountCondition | AfterBeatCondition,
    Field(discriminator="kind"),
]


class CanonFactDefinition(StrictAuthorModel):
    id: ShortText
    order_index: int = Field(ge=0)
    title: ShortText
    statement: Prose
    severity: Literal["hard", "soft"] = "hard"
    scope: Literal["world", "character", "relationship", "plot"] = "world"
    referenced_character_ids: ShortList = Field(default_factory=list)


class StoryBeatDefinition(StrictAuthorModel):
    id: ShortText
    order_index: int = Field(ge=0)
    title: ShortText
    description: Prose
    activation_condition: BeatCondition = Field(default_factory=AlwaysCondition)
    completion_evidence: Prose = ""
    required: bool = True
    ending_gate: bool = False


class StoryCanonSection(StrictAuthorModel):
    creative_goals: Prose = ""
    facts: Annotated[list[CanonFactDefinition], Field(max_length=100)] = Field(default_factory=list)
    beats: Annotated[list[StoryBeatDefinition], Field(max_length=100)] = Field(default_factory=list)


class DraftDiagnostic(StrictAuthorModel):
    code: ShortText
    severity: Literal["error", "warning"]
    step: Literal["identity", "mode", "hero", "cast", "rules", "canon", "review"]
    field: ShortText
    item_id: ShortText | None = None
    message: str = Field(max_length=500)


class DraftValidationResult(StrictAuthorModel):
    valid: bool
    diagnostics: list[DraftDiagnostic] = Field(default_factory=list)


class CharacterRevisionSnapshot(StrictAuthorModel):
    id: ShortText
    character_id: ShortText
    revision_number: int = Field(ge=1)
    name: ShortText
    gender: ShortText
    age: int
    personality: Prose
    appearance: Prose
    biography: Prose = ""
    speech: Prose = ""
    role: Prose = ""


class StoryDraft(StrictAuthorModel):
    story_id: ShortText
    version_id: ShortText
    version_number: int = Field(ge=1)
    status: Literal["draft", "published"]
    draft_revision: int = Field(ge=1)
    based_on_version_id: ShortText | None = None
    rules_version: int = Field(ge=1)
    created_at: ShortText
    published_at: ShortText | None = None
    identity: StoryIdentitySection
    mode: StoryModeSection
    hero: StoryHeroSection
    cast: StoryCastSection
    rules: StoryRulesSection
    canon: StoryCanonSection
    character_revisions: list[CharacterRevisionSnapshot] = Field(default_factory=list)
    diagnostics: list[DraftDiagnostic] = Field(default_factory=list)
