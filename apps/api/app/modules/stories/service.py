import json

from sqlmodel import Session

from app.db.models import Autosave, Character, CharacterRevision, Story, StorySession, Turn
from app.modules.providers.model_selection import (
    UnsupportedModelError,
    available_models,
    choose_model,
)
from app.modules.providers.service import ProviderRegistry
from app.modules.stories.content import AKANE_BACKGROUNDS, AKANE_INITIAL_BACKGROUND
from app.modules.stories.schemas import (
    CharacterDetail,
    SessionDetail,
    SessionSummary,
    StartSessionRequest,
    StoryDetail,
    StorySummary,
    TurnDetail,
    VisualState,
)

from . import repository


class StoryNotFoundError(Exception):
    pass


class SessionNotFoundError(Exception):
    pass


def list_stories(session: Session) -> list[StorySummary]:
    return [_story_summary(story) for story in repository.list_stories(session)]


def get_story(session: Session, story_id: str) -> StoryDetail:
    story = _require_story(session, story_id)
    return _story_detail(session, story)


def start_story_session(
    session: Session,
    story_id: str,
    request: StartSessionRequest,
    configured_model_id: str,
    registry: ProviderRegistry,
) -> SessionDetail:
    story = _require_story(session, story_id)
    if request.provider_id != story.recommended_provider_id:
        raise UnsupportedModelError
    models = available_models(registry, request.provider_id)
    model_id = choose_model(models, request.model_id, configured_model_id)

    story_session = StorySession(
        story_id=story.id,
        current_scene=story.current_scene,
        provider_id=request.provider_id,
        model_id=model_id,
        kind=request.kind,
    )
    session.add(story_session)
    session.flush()
    repository.pin_story_characters(session, story.id, story_session.id)
    if request.kind == "player":
        autosave = session.get(Autosave, story.id)
        if autosave is None:
            session.add(Autosave(story_id=story.id, session_id=story_session.id))
        else:
            autosave.session_id = story_session.id
    session.commit()
    session.refresh(story_session)
    return _session_detail(session, story_session, story)


def get_session_detail(session: Session, session_id: str) -> SessionDetail:
    story_session = repository.get_story_session(session, session_id)
    if story_session is None:
        raise SessionNotFoundError
    return _session_detail(session, story_session, _require_story(session, story_session.story_id))


def list_session_summaries(session: Session, kind: str) -> list[SessionSummary]:
    return [_session_summary(game, story) for game, story in repository.list_story_sessions(session, kind)]


def list_autosaves(session: Session) -> list[SessionSummary]:
    return [_session_summary(game, story) for game, story in repository.list_autosaves(session)]


def _session_summary(story_session: StorySession, story: Story) -> SessionSummary:
    return SessionSummary(
        id=story_session.id,
        story=_story_summary(story),
        state_version=story_session.state_version,
        current_scene=story_session.current_scene,
        created_at=story_session.created_at,
        updated_at=story_session.updated_at,
    )


def _require_story(session: Session, story_id: str) -> Story:
    story = repository.get_story_by_id(session, story_id)
    if story is None:
        raise StoryNotFoundError
    return story


def _story_summary(story: Story) -> StorySummary:
    return StorySummary(
        id=story.id,
        slug=story.slug,
        title=story.title,
        premise=story.premise,
        description=story.description,
        cover_image_url=story.cover_image_url,
        story_mode=story.story_mode,
        recommended_provider_id=story.recommended_provider_id,
        recommended_model_id=story.recommended_model_id,
    )


def _character_detail(character: Character, revision: CharacterRevision) -> CharacterDetail:
    return CharacterDetail(
        id=character.id,
        name=revision.name,
        gender=revision.gender,
        age=revision.age,
        personality=revision.personality,
        appearance=revision.appearance,
        visual_profile_version=revision.revision_number,
    )


def _story_detail(session: Session, story: Story) -> StoryDetail:
    return StoryDetail(
        **_story_summary(story).model_dump(),
        current_scene=story.current_scene,
        characters=[
            _character_detail(character, revision)
            for character, revision in repository.list_story_characters(session, story.id)
        ],
    )


def _visual_directive(turn: Turn) -> dict[str, str]:
    return json.loads(turn.visual_directive)


def _turn_detail(turn: Turn | None, visual_directive: dict[str, str] | None) -> TurnDetail | None:
    if turn is None:
        return None
    return TurnDetail(
        id=turn.id,
        state_version=turn.state_version,
        action=turn.action,
        prompt_version=turn.prompt_version,
        speaker=turn.speaker,
        narration=turn.narration,
        dialogue=turn.dialogue,
        choices=json.loads(turn.choices),
        visual_directive=visual_directive or {},
    )


def _session_detail(session: Session, story_session: StorySession, story: Story) -> SessionDetail:
    latest_turn = repository.get_active_turn(session, story_session)
    visual_directive = _visual_directive(latest_turn) if latest_turn else None
    return SessionDetail(
        id=story_session.id,
        story=_story_summary(story),
        characters=[
            _character_detail(character, revision)
            for character, revision in repository.list_session_characters(session, story_session.id)
        ],
        state_version=story_session.state_version,
        can_rewind=story_session.active_turn_id is not None and story_session.rewind_count < 10,
        current_scene=story_session.current_scene,
        provider_id=story_session.provider_id,
        model_id=story_session.model_id,
        latest_turn=_turn_detail(latest_turn, visual_directive),
        visual_state=VisualState(
            emotion=visual_directive.get("emotion", "neutral") if visual_directive else "neutral",
            pose=visual_directive.get("pose", "default") if visual_directive else "default",
            outfit=visual_directive.get("outfit", "red_dress") if visual_directive else "red_dress",
            background=(
                visual_directive.get("background", AKANE_INITIAL_BACKGROUND)
                if visual_directive and visual_directive.get("background") in AKANE_BACKGROUNDS
                else AKANE_INITIAL_BACKGROUND
            ),
        ),
    )
