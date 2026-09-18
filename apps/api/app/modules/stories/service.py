import json

from sqlmodel import Session

from app.db.models import Character, Story, StorySession, Turn

from . import repository
from .schemas import (
    CharacterDetail,
    SessionDetail,
    StartSessionRequest,
    StoryDetail,
    StorySummary,
    TurnDetail,
    VisualState,
)


class StoryNotFoundError(Exception):
    pass


class SessionNotFoundError(Exception):
    pass


class UnsupportedModelError(Exception):
    pass


def list_stories(session: Session) -> list[StorySummary]:
    return [_story_summary(story) for story in repository.list_stories(session)]


def get_story(session: Session, story_id: str) -> StoryDetail:
    story = _require_story(session, story_id)
    return _story_detail(session, story)


def start_story_session(session: Session, story_id: str, request: StartSessionRequest) -> SessionDetail:
    story = _require_story(session, story_id)
    model_id = request.model_id or story.recommended_model_id
    if request.provider_id != story.recommended_provider_id or model_id != story.recommended_model_id:
        raise UnsupportedModelError

    story_session = StorySession(
        story_id=story.id,
        current_scene=story.current_scene,
        provider_id=request.provider_id,
        model_id=model_id,
    )
    session.add(story_session)
    session.commit()
    session.refresh(story_session)
    return _session_detail(session, story_session, story)


def get_session_detail(session: Session, session_id: str) -> SessionDetail:
    story_session = repository.get_story_session(session, session_id)
    if story_session is None:
        raise SessionNotFoundError
    return _session_detail(session, story_session, _require_story(session, story_session.story_id))


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
        story_mode=story.story_mode,
        recommended_provider_id=story.recommended_provider_id,
        recommended_model_id=story.recommended_model_id,
    )


def _character_detail(character: Character) -> CharacterDetail:
    return CharacterDetail(
        id=character.id,
        name=character.name,
        age=character.age,
        personality=character.personality,
        appearance=character.appearance,
        visual_profile_version=character.visual_profile_version,
    )


def _story_detail(session: Session, story: Story) -> StoryDetail:
    return StoryDetail(
        **_story_summary(story).model_dump(),
        current_scene=story.current_scene,
        characters=[_character_detail(character) for character in repository.list_characters(session, story.id)],
    )


def _turn_detail(turn: Turn | None) -> TurnDetail | None:
    if turn is None:
        return None
    return TurnDetail(
        id=turn.id,
        state_version=turn.state_version,
        speaker=turn.speaker,
        narration=turn.narration,
        dialogue=turn.dialogue,
        choices=json.loads(turn.choices),
    )


def _session_detail(session: Session, story_session: StorySession, story: Story) -> SessionDetail:
    return SessionDetail(
        id=story_session.id,
        story=_story_summary(story),
        characters=[_character_detail(character) for character in repository.list_characters(session, story.id)],
        state_version=story_session.state_version,
        current_scene=story_session.current_scene,
        provider_id=story_session.provider_id,
        model_id=story_session.model_id,
        latest_turn=_turn_detail(repository.get_latest_turn(session, story_session.id)),
        visual_state=VisualState(),
    )
