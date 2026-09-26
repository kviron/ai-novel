"""Freeze a valid draft and pin its protagonist and cast for an author test."""

import json

from pydantic import BaseModel, ConfigDict, Field
from sqlmodel import Session

from app.db.models import (
    Character,
    CharacterRevision,
    SessionCharacter,
    SessionProtagonist,
    StoryDraftSnapshot,
    StorySession,
)
from app.modules.providers.model_selection import UnsupportedModelError, available_models, choose_model
from app.modules.providers.service import ProviderRegistry
from app.modules.stories.protagonist import HeroSelectionError
from app.modules.stories.schemas import (
    CatalogHeroChoice,
    DraftHeroChoice,
    FixedHeroChoice,
    HeroChoice,
    SessionDetail,
    StorySummary,
)
from app.modules.stories.service import get_session_detail
from app.modules.story_authoring.definition import canonical_snapshot, load_story_draft
from app.modules.story_authoring.service import DraftInvalidError, validate_story_draft


class AuthorTestSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider_id: str = Field(default="ollama", min_length=1, max_length=40)
    model_id: str | None = Field(default=None, max_length=160)
    hero: HeroChoice | None = None


def _pin_protagonist(session: Session, draft, choice: HeroChoice | None, session_id: str) -> str | None:
    hero = draft.hero
    if choice is None:
        if hero.hero_policy == "fixed":
            choice = FixedHeroChoice(source_kind="fixed")
        elif "draft" in hero.hero_allowed_sources:
            choice = DraftHeroChoice(source_kind="draft", name="Игрок")
        else:
            raise HeroSelectionError("hero_choice_required")

    if isinstance(choice, DraftHeroChoice):
        if hero.hero_policy != "choice" or "draft" not in hero.hero_allowed_sources:
            raise HeroSelectionError("draft_not_allowed")
        session.add(
            SessionProtagonist(
                session_id=session_id,
                source_kind="draft",
                name=choice.name,
                address=choice.address or choice.name,
                gender=choice.gender,
                appearance=choice.appearance,
                biography=choice.biography,
            )
        )
        return None

    if isinstance(choice, FixedHeroChoice):
        if hero.hero_policy != "fixed":
            raise HeroSelectionError("fixed_not_allowed")
        revision_id = hero.fixed_hero_revision_id
        source_kind = "fixed"
    elif isinstance(choice, CatalogHeroChoice):
        if hero.hero_policy != "choice" or "catalog" not in hero.hero_allowed_sources:
            raise HeroSelectionError("catalog_not_allowed")
        revision_id = choice.revision_id
        source_kind = "catalog"
    else:
        raise HeroSelectionError("invalid_hero_choice")
    revision = session.get(CharacterRevision, revision_id)
    if revision is None or session.get(Character, revision.character_id) is None:
        raise HeroSelectionError("hero_revision_missing")
    if isinstance(choice, CatalogHeroChoice):
        if revision.character_id != choice.character_id:
            raise HeroSelectionError("hero_revision_mismatch")
        matching = [item for item in draft.cast.characters if item.character_id == revision.character_id]
        if matching and not matching[0].playable:
            raise HeroSelectionError("cast_member_not_playable")
    session.add(
        SessionProtagonist(
            session_id=session_id,
            source_kind=source_kind,
            source_character_id=revision.character_id,
            source_revision_id=revision.id,
            name=revision.name,
            address=revision.name.split()[0],
            gender=revision.gender,
            appearance=revision.appearance,
            biography=revision.biography,
            personality=revision.personality,
            age=revision.age,
        )
    )
    return revision.character_id


def snapshot_aware_session_detail(session: Session, session_id: str) -> SessionDetail:
    """Use the pinned author payload for summary fields shown by the normal session API."""
    detail = get_session_detail(session, session_id)
    story_session = session.get(StorySession, session_id)
    if story_session.draft_snapshot_id is None:
        return detail
    snapshot = session.get(StoryDraftSnapshot, story_session.draft_snapshot_id)
    payload = json.loads(snapshot.payload)
    identity = payload["identity"]
    rules = payload["rules"]
    frozen_story = StorySummary(
        id=story_session.story_id,
        slug=identity["slug"],
        title=identity["title"],
        premise=identity["premise"],
        description=identity["short_description"],
        cover_image_url=None,
        story_mode="hybrid" if payload["mode"]["mode"] == "hybrid" else "free",
        recommended_provider_id=rules["recommended_provider_id"],
        recommended_model_id=rules["recommended_model_id"],
    )
    return detail.model_copy(update={"story": frozen_story})


def create_author_test_session(
    session: Session,
    story_id: str,
    request: AuthorTestSessionRequest,
    configured_model_id: str,
    registry: ProviderRegistry,
) -> SessionDetail:
    draft = load_story_draft(session, story_id)
    if request.provider_id != draft.rules.recommended_provider_id:
        raise UnsupportedModelError
    models = available_models(registry, request.provider_id)
    validation = validate_story_draft(session, story_id, available_models=models)
    if not validation.valid:
        raise DraftInvalidError(validation.diagnostics)
    preferred_model = (
        draft.rules.recommended_model_id if draft.rules.recommended_model_id in models else configured_model_id
    )
    model_id = choose_model(models, request.model_id, preferred_model)
    payload, sha256 = canonical_snapshot(draft)
    snapshot = StoryDraftSnapshot(
        version_id=draft.version_id,
        source_draft_revision=draft.draft_revision,
        payload=payload,
        sha256=sha256,
    )
    try:
        session.add(snapshot)
        session.flush()
        game = StorySession(
            story_id=story_id,
            draft_snapshot_id=snapshot.id,
            kind="author",
            current_scene=draft.identity.opening_situation,
            provider_id=request.provider_id,
            model_id=model_id,
        )
        session.add(game)
        session.flush()
        excluded_character_id = _pin_protagonist(session, draft, request.hero, game.id)
        for member in draft.cast.characters:
            if member.character_id != excluded_character_id:
                session.add(
                    SessionCharacter(
                        session_id=game.id,
                        character_id=member.character_id,
                        revision_id=member.revision_id,
                        role=member.role,
                        color=member.color,
                    )
                )
        session.commit()
    except Exception:
        session.rollback()
        raise
    return snapshot_aware_session_detail(session, game.id)
