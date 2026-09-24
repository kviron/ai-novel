from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import UniqueConstraint
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
    current_scene: str
    recommended_provider_id: str = "ollama"
    recommended_model_id: str = "qwen3:14b-q4_K_M"
    created_at: str = Field(default_factory=utc_timestamp)


class Character(SQLModel, table=True):
    __tablename__ = "characters"

    id: str = Field(default_factory=new_public_id, primary_key=True)
    story_id: str = Field(foreign_key="stories.id", index=True)
    name: str
    age: int
    personality: str
    appearance: str
    visual_profile_version: int = 1


class StorySession(SQLModel, table=True):
    __tablename__ = "story_sessions"

    id: str = Field(default_factory=new_public_id, primary_key=True)
    story_id: str = Field(foreign_key="stories.id", index=True)
    kind: str = "player"
    state_version: int = 1
    current_scene: str
    provider_id: str
    model_id: str
    created_at: str = Field(default_factory=utc_timestamp)
    updated_at: str = Field(default_factory=utc_timestamp)


class Turn(SQLModel, table=True):
    __tablename__ = "turns"
    __table_args__ = (
        UniqueConstraint("session_id", "request_id"),
        UniqueConstraint("session_id", "state_version"),
    )

    id: str = Field(default_factory=new_public_id, primary_key=True)
    session_id: str = Field(foreign_key="story_sessions.id", index=True)
    request_id: str
    state_version: int
    legacy_state_version: int | None = None
    action: str
    speaker: str
    narration: str
    dialogue: str
    choices: str
    visual_directive: str
    raw_response: str
    provider_id: str
    model_id: str
    prompt_version: str
    created_at: str = Field(default_factory=utc_timestamp)
