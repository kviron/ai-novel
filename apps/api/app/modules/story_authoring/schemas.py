from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field


class StrictAuthorModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


ShortText = Annotated[str, Field(max_length=120)]
Prose = Annotated[str, Field(max_length=6000)]
ShortList = Annotated[list[ShortText], Field(max_length=24)]


class StoryIdentitySection(StrictAuthorModel):
    title: ShortText = ""
    slug: ShortText = ""
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
    role: ShortText = "cast"
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
    role: ShortText = ""


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
