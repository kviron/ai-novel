import json

from sqlmodel import Session

from app.db.models import Autosave, Character, CharacterRevision, SessionProtagonist, Story, StorySession, Turn
from app.modules.characters import repository as character_repository
from app.modules.characters.service import _material_profile
from app.modules.providers.model_selection import (
    UnsupportedModelError,
    available_models,
    choose_model,
)
from app.modules.providers.service import ProviderRegistry
from app.modules.stories.content import AKANE_BACKGROUNDS, AKANE_INITIAL_BACKGROUND
from app.modules.stories.schemas import (
    CharacterDetail,
    ProtagonistDetail,
    SessionDetail,
    SessionSummary,
    StartSessionRequest,
    StoryDetail,
    StorySetup,
    StorySummary,
    TurnDetail,
    VisualState,
)
from app.modules.story_authoring.runtime import (
    RuntimeStoryDefinition,
    current_published_runtime,
    load_runtime_story_definition,
)

from . import repository
from .protagonist import resolve_protagonist, story_setup


class StoryNotFoundError(Exception):
    pass


class SessionNotFoundError(Exception):
    pass


class StoryNotPublishedError(Exception):
    pass


def list_stories(session: Session) -> list[StorySummary]:
    return [_story_summary(current_published_runtime(session, story)) for story in repository.list_stories(session)]


def get_story(session: Session, story_id: str) -> StoryDetail:
    story = _require_story(session, story_id)
    try:
        return _story_detail(session, current_published_runtime(session, story))
    except LookupError as error:
        raise StoryNotFoundError from error


def get_story_setup(session: Session, story_id: str) -> StorySetup:
    story = _require_story(session, story_id)
    try:
        return story_setup(session, current_published_runtime(session, story))
    except LookupError as error:
        raise StoryNotFoundError from error


def start_story_session(
    session: Session,
    story_id: str,
    request: StartSessionRequest,
    configured_model_id: str,
    registry: ProviderRegistry,
) -> SessionDetail:
    story = _require_story(session, story_id)
    if story.current_published_version_id is None:
        raise StoryNotPublishedError
    source = StorySession(
        story_id=story.id,
        story_version_id=story.current_published_version_id,
        current_scene="",
        provider_id=request.provider_id,
        model_id=request.model_id or configured_model_id,
        kind=request.kind,
    )
    runtime = load_runtime_story_definition(session, source)
    if request.provider_id != runtime.recommended_provider_id:
        raise UnsupportedModelError
    models = available_models(registry, request.provider_id)
    preferred_model = runtime.recommended_model_id if runtime.recommended_model_id in models else configured_model_id
    model_id = choose_model(models, request.model_id, preferred_model)

    story_session = StorySession(
        story_id=story.id,
        story_version_id=runtime.version_id,
        current_scene=runtime.opening_situation,
        provider_id=request.provider_id,
        model_id=model_id,
        kind=request.kind,
    )
    session.add(story_session)
    session.flush()
    protagonist = resolve_protagonist(session, runtime, request.hero, story_session.id)
    repository.pin_version_characters(
        session, runtime.version_id, story_session.id, protagonist.source_character_id
    )
    if request.kind == "player":
        autosave = session.get(Autosave, story.id)
        if autosave is None:
            session.add(Autosave(story_id=story.id, session_id=story_session.id))
        else:
            autosave.session_id = story_session.id
    session.commit()
    session.refresh(story_session)
    return _session_detail(session, story_session, runtime)


def get_session_detail(session: Session, session_id: str) -> SessionDetail:
    story_session = repository.get_story_session(session, session_id)
    if story_session is None:
        raise SessionNotFoundError
    return _session_detail(session, story_session, load_runtime_story_definition(session, story_session))


def list_session_summaries(session: Session, kind: str) -> list[SessionSummary]:
    return [
        _session_summary(game, load_runtime_story_definition(session, game))
        for game, _story in repository.list_story_sessions(session, kind)
    ]


def list_autosaves(session: Session) -> list[SessionSummary]:
    return [
        _session_summary(game, load_runtime_story_definition(session, game))
        for game, _story in repository.list_autosaves(session)
    ]


def _session_summary(story_session: StorySession, story: RuntimeStoryDefinition) -> SessionSummary:
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


def _story_summary(story: RuntimeStoryDefinition) -> StorySummary:
    return StorySummary(
        id=story.story_id,
        current_published_version_id=story.version_id,
        slug=story.slug,
        title=story.title,
        premise=story.premise,
        description=story.description,
        cover_image_url=story.cover_image_url,
        story_mode=story.mode,
        recommended_provider_id=story.recommended_provider_id,
        recommended_model_id=story.recommended_model_id,
    )


def _character_detail(
    session: Session, character: Character, revision: CharacterRevision, role: str, color: str
) -> CharacterDetail:
    materials = character_repository.materials_for_revision(session, revision.id)
    sprites = {}
    for material in materials:
        if material.kind.startswith("sprite:"):
            _, emotion, variant = material.kind.split(":", 2)
            sprites.setdefault(emotion, []).append(
                {"variant": variant, "material": _material_profile(material)}
            )
    return CharacterDetail(
        id=character.id,
        name=revision.name,
        gender=revision.gender,
        age=revision.age,
        personality=revision.personality,
        appearance=revision.appearance,
        role=role,
        color=color,
        visual_profile_version=revision.revision_number,
        sprites=sprites,
    )


def _story_detail(session: Session, story: RuntimeStoryDefinition) -> StoryDetail:
    return StoryDetail(
        **_story_summary(story).model_dump(),
        current_scene=story.opening_situation,
        characters=[
            _character_detail(
                session,
                session.get(Character, member.character_id),
                session.get(CharacterRevision, member.revision_id),
                member.role,
                member.color,
            )
            for member in story.cast
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
        segments=json.loads(turn.segments)
        if turn.segments
        else [
            {"kind": "narration", "text": turn.narration},
            {
                "kind": "dialogue",
                "character_id": (visual_directive or {}).get("character_id", "legacy"),
                "text": turn.dialogue,
            },
        ],
        choices=json.loads(turn.choices),
        visual_directive=visual_directive or {},
    )


def _session_detail(
    session: Session, story_session: StorySession, story: RuntimeStoryDefinition
) -> SessionDetail:
    latest_turn = repository.get_active_turn(session, story_session)
    visual_directive = _visual_directive(latest_turn) if latest_turn else None
    protagonist = session.get(SessionProtagonist, story_session.id)
    return SessionDetail(
        id=story_session.id,
        story=_story_summary(story),
        characters=[
            _character_detail(session, character, revision, link.role, link.color)
            for character, revision, link in repository.list_session_characters(session, story_session.id)
        ],
        protagonist=ProtagonistDetail.model_validate(protagonist, from_attributes=True),
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
