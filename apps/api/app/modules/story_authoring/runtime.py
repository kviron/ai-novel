"""One immutable runtime view for published games and frozen author tests."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict
from sqlmodel import Session

from app.db.models import Story, StoryDraftSnapshot, StoryMaterial, StorySession
from app.modules.story_authoring.definition import load_published_story_version
from app.modules.story_authoring.schemas import (
    CanonFactDefinition,
    CharacterRevisionSnapshot,
    GenerationPolicy,
    StoryBeatDefinition,
    StoryCastMember,
    StoryDraft,
)


class RuntimeStoryDefinition(BaseModel):
    """Provider-neutral, immutable story data; callers never parse persistence JSON."""

    model_config = ConfigDict(frozen=True)

    story_id: str
    version_id: str
    version_number: int
    draft_snapshot_id: str | None = None
    title: str
    slug: str
    premise: str
    description: str
    cover_image_url: str | None
    mode: Literal["freeform", "hybrid"]
    opening_situation: str
    setting: str
    recommended_provider_id: str
    recommended_model_id: str
    generation_policy: GenerationPolicy
    themes_allowed: list[str]
    themes_blocked: list[str]
    ending_policy: Literal["open_ended", "model_may_end", "required_beats_then_end"]
    creative_goals: str
    facts: list[CanonFactDefinition]
    beats: list[StoryBeatDefinition]
    hero_policy: Literal["fixed", "choice"]
    hero_allowed_sources: list[Literal["catalog", "draft"]]
    fixed_hero_revision_id: str | None
    cast: list[StoryCastMember]
    character_revisions: list[CharacterRevisionSnapshot]

    def revision(self, revision_id: str | None) -> CharacterRevisionSnapshot | None:
        return next((item for item in self.character_revisions if item.id == revision_id), None)


def load_runtime_story_definition(session: Session, game: StorySession) -> RuntimeStoryDefinition:
    """Resolve either pinned source into the same typed runtime contract."""
    story = session.get(Story, game.story_id)
    if story is None:
        raise LookupError(f"Story not found: {game.story_id}")
    if game.story_version_id is not None and game.draft_snapshot_id is None:
        draft = load_published_story_version(session, game.story_id, game.story_version_id)
    elif game.draft_snapshot_id is not None and game.story_version_id is None:
        snapshot = session.get(StoryDraftSnapshot, game.draft_snapshot_id)
        if snapshot is None or snapshot.version_id == "":
            raise LookupError(f"Draft snapshot not found: {game.draft_snapshot_id}")
        draft = StoryDraft.model_validate_json(snapshot.payload)
        if draft.story_id != game.story_id or draft.version_id != snapshot.version_id:
            raise ValueError("Draft snapshot source does not match its session")
    else:
        raise ValueError("A story session must pin exactly one runtime source")
    return _from_draft(session, story, draft, game.draft_snapshot_id)


def current_published_runtime(session: Session, story: Story) -> RuntimeStoryDefinition:
    """Resolve the catalog's current immutable version without exposing loader details."""
    if story.current_published_version_id is None:
        raise LookupError(f"Story is not published: {story.id}")
    source = StorySession(
        story_id=story.id,
        story_version_id=story.current_published_version_id,
        current_scene="",
        provider_id=story.recommended_provider_id,
        model_id=story.recommended_model_id,
    )
    return load_runtime_story_definition(session, source)


def _from_draft(session: Session, story: Story, draft: StoryDraft, snapshot_id: str | None) -> RuntimeStoryDefinition:
    return RuntimeStoryDefinition(
        story_id=draft.story_id,
        version_id=draft.version_id,
        version_number=draft.version_number,
        draft_snapshot_id=snapshot_id,
        title=draft.identity.title,
        slug=draft.identity.slug,
        premise=draft.identity.premise,
        description=draft.identity.short_description,
        cover_image_url=_runtime_cover_url(session, story, draft),
        mode=draft.mode.mode,
        opening_situation=draft.identity.opening_situation,
        setting=draft.identity.setting,
        recommended_provider_id=draft.rules.recommended_provider_id,
        recommended_model_id=draft.rules.recommended_model_id,
        generation_policy=draft.rules.generation_policy,
        themes_allowed=draft.rules.themes_allowed,
        themes_blocked=draft.rules.themes_blocked,
        ending_policy=draft.rules.ending_policy,
        creative_goals=draft.canon.creative_goals,
        facts=draft.canon.facts,
        beats=draft.canon.beats,
        hero_policy=draft.hero.hero_policy,
        hero_allowed_sources=draft.hero.hero_allowed_sources,
        fixed_hero_revision_id=draft.hero.fixed_hero_revision_id,
        cast=draft.cast.characters,
        character_revisions=draft.character_revisions,
    )


def _runtime_cover_url(session: Session, story: Story, draft: StoryDraft) -> str | None:
    if draft.identity.cover_material_id is None:
        # Migrated built-in stories predate StoryMaterial; their packaged cover is the only legacy fallback.
        return story.cover_image_url
    material = session.get(StoryMaterial, draft.identity.cover_material_id)
    if material is None or material.story_id != story.id:
        raise ValueError("Pinned story cover material is missing or belongs to another story")
    return f"/api/story-materials/{material.id}"
