"""Freeze a valid draft and pin its protagonist and cast for an author test."""

from pydantic import BaseModel, ConfigDict, Field
from sqlmodel import Session

from app.db.models import (
    SessionCharacter,
    StoryDraftSnapshot,
    StorySession,
)
from app.modules.providers.model_selection import UnsupportedModelError, available_models, choose_model
from app.modules.providers.service import ProviderRegistry
from app.modules.stories.protagonist import resolve_protagonist
from app.modules.stories.schemas import (
    HeroChoice,
    SessionDetail,
)
from app.modules.stories.service import get_session_detail
from app.modules.story_authoring.definition import canonical_snapshot, load_story_draft
from app.modules.story_authoring.runtime import load_runtime_story_definition
from app.modules.story_authoring.service import DraftInvalidError, validate_story_draft


class AuthorTestSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider_id: str = Field(default="ollama", min_length=1, max_length=40)
    model_id: str | None = Field(default=None, max_length=160)
    hero: HeroChoice | None = None


def snapshot_aware_session_detail(session: Session, session_id: str) -> SessionDetail:
    """Compatibility entry point; normal session reads now understand both source kinds."""
    return get_session_detail(session, session_id)


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
        runtime = load_runtime_story_definition(session, game)
        protagonist = resolve_protagonist(session, runtime, request.hero, game.id)
        for member in runtime.cast:
            if member.character_id != protagonist.source_character_id:
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
