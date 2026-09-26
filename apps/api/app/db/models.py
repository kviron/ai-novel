from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import CheckConstraint, Index, UniqueConstraint, text
from sqlmodel import Field, SQLModel


def new_public_id() -> str:
    return str(uuid4())


def utc_timestamp() -> str:
    return datetime.now(UTC).isoformat()


class Story(SQLModel, table=True):
    __tablename__ = "stories"

    id: str = Field(default_factory=new_public_id, primary_key=True)
    slug: str = Field(index=True, unique=True)
    title: str
    premise: str
    description: str = ""
    cover_image_url: str | None = None
    theme_labels: str = "[]"
    state_version: int = 1
    story_mode: str = "hybrid"
    content_version: int = 1
    hero_policy: str = "choice"
    hero_policy_version: int = 1
    hero_allowed_sources: str = '["catalog", "draft"]'
    fixed_hero_revision_id: str | None = Field(default=None, foreign_key="character_revisions.id")
    playable_character_ids: str = "[]"
    current_scene: str
    recommended_provider_id: str = "ollama"
    recommended_model_id: str = "qwen3:14b-q4_K_M"
    current_published_version_id: str | None = Field(default=None, foreign_key="story_versions.id")
    created_at: str = Field(default_factory=utc_timestamp)


class StoryMaterial(SQLModel, table=True):
    __tablename__ = "story_materials"

    id: str = Field(default_factory=new_public_id, primary_key=True)
    story_id: str = Field(foreign_key="stories.id", index=True)
    sha256: str
    mime_type: str
    filename: str
    creator: str
    license: str
    source: str
    asset_path: str
    created_at: str = Field(default_factory=utc_timestamp)


class StoryVersion(SQLModel, table=True):
    __tablename__ = "story_versions"
    __table_args__ = (
        UniqueConstraint("story_id", "version_number"),
        Index("uq_story_versions_one_draft", "story_id", unique=True, sqlite_where=text("status = 'draft'")),
    )

    id: str = Field(default_factory=new_public_id, primary_key=True)
    story_id: str = Field(foreign_key="stories.id", index=True)
    version_number: int
    status: str = "draft"
    draft_revision: int = 1
    based_on_version_id: str | None = Field(default=None, foreign_key="story_versions.id")
    mode: str
    title: str
    slug: str
    short_description: str = ""
    premise: str = ""
    cover_material_id: str | None = Field(default=None, foreign_key="story_materials.id")
    genres: str = "[]"
    tone: str = "[]"
    setting: str = ""
    opening_situation: str = ""
    content_rating: str = "adult_18_plus"
    themes_allowed: str = "[]"
    themes_blocked: str = "[]"
    creative_goals: str = ""
    ending_policy: str = "open_ended"
    hero_policy: str = "choice"
    hero_allowed_sources: str = '["catalog", "draft"]'
    fixed_hero_revision_id: str | None = Field(default=None, foreign_key="character_revisions.id")
    recommended_provider_id: str = "ollama"
    recommended_model_id: str = "qwen3:14b-q4_K_M"
    narration_perspective: str = "second_person"
    prose_density: str = "balanced"
    choice_policy: str = "choices_and_free_input"
    min_choices: int = 2
    max_choices: int = 4
    allow_romance: bool = True
    allow_violence: bool = True
    allow_horror: bool = True
    allow_sexual_themes: bool = False
    desired_themes: str = ""
    forbidden_outcomes: str = ""
    rules_version: int = 1
    created_at: str = Field(default_factory=utc_timestamp)
    published_at: str | None = None


class StoryVersionCharacter(SQLModel, table=True):
    __tablename__ = "story_version_characters"
    __table_args__ = (
        UniqueConstraint("version_id", "character_id"),
        UniqueConstraint("version_id", "order_index"),
    )

    id: str = Field(default_factory=new_public_id, primary_key=True)
    version_id: str = Field(foreign_key="story_versions.id", index=True)
    character_id: str = Field(foreign_key="characters.id")
    revision_id: str = Field(foreign_key="character_revisions.id")
    order_index: int
    role: str = "cast"
    color: str = "#D9A75F"
    playable: bool = False


class CanonFact(SQLModel, table=True):
    __tablename__ = "canon_facts"
    __table_args__ = (UniqueConstraint("version_id", "order_index"),)

    id: str = Field(default_factory=new_public_id, primary_key=True)
    version_id: str = Field(foreign_key="story_versions.id", index=True)
    order_index: int
    title: str
    statement: str
    severity: str = "hard"
    scope: str = "world"
    referenced_character_ids: str = "[]"


class StoryBeat(SQLModel, table=True):
    __tablename__ = "story_beats"
    __table_args__ = (UniqueConstraint("version_id", "order_index"),)

    id: str = Field(default_factory=new_public_id, primary_key=True)
    version_id: str = Field(foreign_key="story_versions.id", index=True)
    order_index: int
    title: str
    description: str
    activation_condition: str = '{"type":"always"}'
    completion_evidence: str = ""
    required: bool = True
    ending_gate: bool = False


class StoryDraftSnapshot(SQLModel, table=True):
    __tablename__ = "story_draft_snapshots"

    id: str = Field(default_factory=new_public_id, primary_key=True)
    version_id: str = Field(foreign_key="story_versions.id", index=True)
    payload: str
    sha256: str
    source_draft_revision: int
    created_at: str = Field(default_factory=utc_timestamp)


class Character(SQLModel, table=True):
    __tablename__ = "characters"

    id: str = Field(default_factory=new_public_id, primary_key=True)
    story_id: str | None = Field(default=None, foreign_key="stories.id", index=True)
    name: str
    gender: str = "unspecified"
    age: int
    personality: str
    appearance: str
    visual_profile_version: int = 1
    current_revision_id: str | None = None
    source_type: str = "local"
    origin_character_id: str | None = None


class CharacterRevision(SQLModel, table=True):
    __tablename__ = "character_revisions"
    __table_args__ = (UniqueConstraint("character_id", "revision_number"),)

    id: str = Field(default_factory=new_public_id, primary_key=True)
    character_id: str = Field(foreign_key="characters.id", index=True)
    revision_number: int
    name: str
    gender: str
    age: int
    personality: str
    appearance: str
    biography: str = ""
    speech: str = ""
    role: str = ""
    created_at: str = Field(default_factory=utc_timestamp)


class CharacterMaterial(SQLModel, table=True):
    __tablename__ = "character_materials"
    __table_args__ = (UniqueConstraint("revision_id", "kind"),)

    id: str = Field(default_factory=new_public_id, primary_key=True)
    revision_id: str = Field(foreign_key="character_revisions.id", index=True)
    kind: str = "avatar"
    sha256: str
    mime_type: str
    filename: str
    creator: str
    license: str
    source: str
    created_at: str = Field(default_factory=utc_timestamp)


class StoryCharacter(SQLModel, table=True):
    __tablename__ = "story_characters"

    story_id: str = Field(foreign_key="stories.id", primary_key=True)
    character_id: str = Field(foreign_key="characters.id", primary_key=True)
    revision_id: str = Field(foreign_key="character_revisions.id")
    role: str = "cast"
    color: str = "#D9A75F"


class SessionCharacter(SQLModel, table=True):
    __tablename__ = "session_characters"

    session_id: str = Field(foreign_key="story_sessions.id", primary_key=True)
    character_id: str = Field(foreign_key="characters.id", primary_key=True)
    revision_id: str = Field(foreign_key="character_revisions.id")
    role: str = "cast"
    color: str = "#D9A75F"


class StorySession(SQLModel, table=True):
    __tablename__ = "story_sessions"
    __table_args__ = (
        CheckConstraint(
            "(story_version_id IS NOT NULL AND draft_snapshot_id IS NULL) OR "
            "(story_version_id IS NULL AND draft_snapshot_id IS NOT NULL)",
            name="ck_story_session_one_version_source",
        ),
    )

    id: str = Field(default_factory=new_public_id, primary_key=True)
    story_id: str = Field(foreign_key="stories.id", index=True)
    story_version_id: str | None = Field(default=None, foreign_key="story_versions.id")
    draft_snapshot_id: str | None = Field(default=None, foreign_key="story_draft_snapshots.id")
    kind: str = "player"
    active_turn_id: str | None = None
    rewind_count: int = 0
    state_version: int = 1
    current_scene: str
    provider_id: str
    model_id: str
    created_at: str = Field(default_factory=utc_timestamp)
    updated_at: str = Field(default_factory=utc_timestamp)


class SessionProtagonist(SQLModel, table=True):
    __tablename__ = "session_protagonists"

    session_id: str = Field(foreign_key="story_sessions.id", primary_key=True)
    source_kind: str
    source_character_id: str | None = Field(default=None, foreign_key="characters.id")
    source_revision_id: str | None = Field(default=None, foreign_key="character_revisions.id")
    policy_version: int = 1
    name: str
    address: str
    gender: str = "unspecified"
    appearance: str = ""
    biography: str = ""
    personality: str = ""
    age: int | None = None


class ProtagonistExport(SQLModel, table=True):
    __tablename__ = "protagonist_exports"

    session_id: str = Field(foreign_key="story_sessions.id", primary_key=True)
    character_id: str = Field(foreign_key="characters.id", unique=True)


class Turn(SQLModel, table=True):
    __tablename__ = "turns"
    __table_args__ = (
        UniqueConstraint("session_id", "request_id"),
        UniqueConstraint("session_id", "state_version"),
    )

    id: str = Field(default_factory=new_public_id, primary_key=True)
    session_id: str = Field(foreign_key="story_sessions.id", index=True)
    parent_turn_id: str | None = None
    scene_after: str = ""
    request_id: str
    state_version: int
    legacy_state_version: int | None = None
    action: str
    speaker: str
    narration: str
    dialogue: str
    segments: str | None = None
    choices: str
    visual_directive: str
    raw_response: str
    provider_id: str
    model_id: str
    prompt_version: str
    created_at: str = Field(default_factory=utc_timestamp)


class Autosave(SQLModel, table=True):
    __tablename__ = "autosaves"

    story_id: str = Field(foreign_key="stories.id", primary_key=True)
    session_id: str = Field(foreign_key="story_sessions.id")


class SessionBeat(SQLModel, table=True):
    __tablename__ = "session_beats"

    session_id: str = Field(foreign_key="story_sessions.id", primary_key=True)
    beat_id: str = Field(foreign_key="story_beats.id", primary_key=True)
    status: str = "locked"
    completed_turn_id: str | None = Field(default=None, foreign_key="turns.id")
