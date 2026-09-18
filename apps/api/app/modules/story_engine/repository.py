import json

from sqlalchemy import text, update
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.db.models import StorySession, Turn, utc_timestamp
from app.modules.stories import repository as stories
from app.modules.stories.service import SessionNotFoundError

from .contracts import AcceptedTurn, TurnCreate, TurnResult
from .prompt import PROMPT_VERSION
from .rules import GenerationContext


class StateConflictError(Exception):
    pass


def find_turn(session: Session, session_id: str, request_id: str) -> TurnResult | None:
    turn = session.exec(select(Turn).where(Turn.session_id == session_id, Turn.request_id == request_id)).first()
    return _turn_result(session, turn) if turn else None


def load_context(session: Session, session_id: str, expected_version: int) -> GenerationContext:
    story_session = stories.get_story_session(session, session_id)
    if story_session is None:
        raise SessionNotFoundError
    if story_session.state_version != expected_version:
        raise StateConflictError
    story = stories.get_story_by_id(session, story_session.story_id)
    characters = stories.list_characters(session, story_session.story_id)
    turns = list(
        session.exec(select(Turn).where(Turn.session_id == session_id).order_by(Turn.state_version.desc()).limit(8))
    )
    return GenerationContext(
        session_id=session_id,
        state_version=story_session.state_version,
        current_scene=story_session.current_scene,
        provider_id=story_session.provider_id,
        model_id=story_session.model_id,
        story={"title": story.title, "premise": story.premise, "story_mode": story.story_mode},
        characters=[character.model_dump() for character in characters],
        recent_turns=[_turn_result(session, turn).model_dump(mode="json") for turn in reversed(turns)],
    )


def commit_turn(
    session: Session,
    context: GenerationContext,
    request: TurnCreate,
    accepted: AcceptedTurn,
    raw_response: str,
) -> tuple[TurnResult, bool]:
    """Atomically persist or replay a turn; every failed check rolls back the entire write.

    SQLite's reserved write lock is acquired only after generation. The conditional
    UPDATE remains the final version defense even after the locked Python check.
    """
    try:
        with session.begin():
            session.execute(text("BEGIN IMMEDIATE"))
            existing = find_turn(session, context.session_id, request.request_id)
            if existing is not None:
                return existing, False
            current = session.get(StorySession, context.session_id, populate_existing=True)
            if current is None:
                raise SessionNotFoundError
            if current.state_version != context.state_version:
                raise StateConflictError
            turn = Turn(
                session_id=context.session_id,
                request_id=request.request_id,
                state_version=context.state_version + 1,
                action=request.action,
                speaker=accepted.speaker,
                narration=accepted.narration,
                dialogue=accepted.dialogue,
                choices=json.dumps(accepted.choices, ensure_ascii=False),
                visual_directive=accepted.visual_directive.model_dump_json(),
                raw_response=raw_response,
                provider_id=context.provider_id,
                model_id=context.model_id,
                prompt_version=PROMPT_VERSION,
            )
            session.add(turn)
            session.flush()
            updated = session.execute(
                update(StorySession)
                .where(StorySession.id == context.session_id, StorySession.state_version == context.state_version)
                .values(
                    state_version=context.state_version + 1,
                    current_scene=context.current_scene,
                    updated_at=utc_timestamp(),
                )
                .execution_options(synchronize_session=False)
            )
            if updated.rowcount != 1:
                raise StateConflictError
            result = _turn_result(session, turn)
        return result, True
    except IntegrityError as error:
        # Recover only when persisted state proves that a competing writer won.
        # Other constraints/triggers indicate an unexpected persistence failure.
        existing = find_turn(session, context.session_id, request.request_id)
        if existing is not None:
            return existing, False
        current = session.get(StorySession, context.session_id, populate_existing=True)
        if current is not None and current.state_version != context.state_version:
            raise StateConflictError from None
        # SQL parameters include diagnostic model output; keep them out of tracebacks.
        error.hide_parameters = True
        raise error from None


def _turn_result(session: Session, turn: Turn) -> TurnResult:
    directive = json.loads(turn.visual_directive)
    if turn.prompt_version == "legacy-v01" and "character_id" not in directive:
        story_session = session.get(StorySession, turn.session_id)
        characters = stories.list_characters(session, story_session.story_id)
        if characters:
            # Historical visuals had no character identity. Choose the story's
            # first stable ID, never guess from mutable/nonunique speaker names.
            # This is a read-only compatibility view; leave saved history intact.
            directive["character_id"] = characters[0].id
    return TurnResult(
        id=turn.id,
        session_id=turn.session_id,
        request_id=turn.request_id,
        state_version=turn.state_version,
        action=turn.action,
        speaker=turn.speaker,
        narration=turn.narration,
        dialogue=turn.dialogue,
        choices=json.loads(turn.choices),
        visual_directive=directive,
        provider_id=turn.provider_id,
        model_id=turn.model_id,
        prompt_version=turn.prompt_version,
        created_at=turn.created_at,
    )
