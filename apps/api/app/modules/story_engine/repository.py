import json

from sqlalchemy import text, update
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.db.models import SessionBeat, SessionProtagonist, StorySession, Turn, utc_timestamp
from app.modules.characters import repository as character_repository
from app.modules.stories import repository as stories
from app.modules.stories.service import SessionNotFoundError
from app.modules.story_authoring.runtime import load_runtime_story_definition

from .contracts import AcceptedTurn, TurnCreate, TurnResult
from .prompt import PROMPT_VERSION
from .rules import GenerationContext


class StateConflictError(Exception):
    pass


def find_turn(session: Session, session_id: str, request_id: str) -> TurnResult | None:
    turn = session.exec(select(Turn).where(Turn.session_id == session_id, Turn.request_id == request_id)).first()
    return _turn_result(session, turn) if turn else None


def list_active_dialogue(session: Session, session_id: str) -> list[TurnResult]:
    story_session = stories.get_story_session(session, session_id)
    if story_session is None:
        raise SessionNotFoundError
    turns: list[TurnResult] = []
    seen: set[str] = set()
    turn_id = story_session.active_turn_id
    while turn_id is not None:
        if turn_id in seen:
            raise StateConflictError
        seen.add(turn_id)
        turn = session.get(Turn, turn_id)
        if turn is None or turn.session_id != session_id:
            raise StateConflictError
        turns.append(_turn_result(session, turn))
        turn_id = turn.parent_turn_id
    turns.reverse()
    return turns


def load_context(session: Session, session_id: str, expected_version: int) -> GenerationContext:
    story_session = stories.get_story_session(session, session_id)
    if story_session is None:
        raise SessionNotFoundError
    if story_session.state_version != expected_version:
        raise StateConflictError
    story = load_runtime_story_definition(session, story_session)
    protagonist = session.get(SessionProtagonist, session_id)
    if protagonist is None:
        raise StateConflictError
    materials = (
        character_repository.materials_for_revision(session, protagonist.source_revision_id)
        if protagonist.source_revision_id
        else []
    )
    protagonist_emotions = sorted(
        {material.kind.split(":", 2)[1] for material in materials if material.kind.startswith("sprite:")}
    )
    characters = stories.list_session_characters(session, session_id)
    turns: list[Turn] = []
    active_turn_ids: set[str] = set()
    active_turn_count = 0
    turn_id = story_session.active_turn_id
    while turn_id is not None:
        turn = session.get(Turn, turn_id)
        if turn is None or turn.session_id != session_id:
            raise StateConflictError
        if turn.id in active_turn_ids:
            raise StateConflictError
        active_turn_ids.add(turn.id)
        active_turn_count += 1
        if len(turns) < 8:
            turns.append(turn)
        turn_id = turn.parent_turn_id
    completed_beat_ids = frozenset(
        row.beat_id
        for row in session.exec(
            select(SessionBeat).where(SessionBeat.session_id == session_id, SessionBeat.status == "completed")
        )
        if row.completed_turn_id in active_turn_ids
    )
    available_beat_ids = frozenset(
        beat.id
        for beat in story.beats
        if beat.id not in completed_beat_ids
        and (
            beat.activation_condition.kind == "always"
            or (
                beat.activation_condition.kind == "after_turn_count"
                and active_turn_count >= beat.activation_condition.turn_count
            )
            or (
                beat.activation_condition.kind == "after_beat"
                and beat.activation_condition.beat_id in completed_beat_ids
            )
        )
    )
    return GenerationContext(
        session_id=session_id,
        active_turn_id=story_session.active_turn_id,
        state_version=story_session.state_version,
        current_scene=story_session.current_scene,
        provider_id=story_session.provider_id,
        model_id=story_session.model_id,
        story=story,
        protagonist={
            "id": protagonist.source_character_id,
            "name": protagonist.name,
            "address": protagonist.address,
            "gender": protagonist.gender,
            "appearance": protagonist.appearance,
            "biography": protagonist.biography,
            "personality": protagonist.personality,
            "age": protagonist.age,
            "available_emotions": protagonist_emotions,
        },
        characters=[
            {
                "id": character.id,
                "source_type": character.source_type,
                "name": revision.name,
                "gender": revision.gender,
                "age": revision.age,
                "personality": revision.personality,
                "appearance": revision.appearance,
                "role": link.role,
                "color": link.color,
            }
            for character, revision, link in characters
        ],
        # The model sees one canonical scene form; legacy compatibility fields stay API-only.
        recent_turns=[
            _turn_result(session, turn).model_dump(
                mode="json",
                include={"request_id", "state_version", "action", "segments", "choices", "visual_directive"},
            )
            for turn in reversed(turns)
        ],
        completed_beat_ids=completed_beat_ids,
        available_beat_ids=available_beat_ids,
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
                parent_turn_id=context.active_turn_id,
                scene_after=context.current_scene,
                request_id=request.request_id,
                state_version=context.state_version + 1,
                action=request.action,
                speaker=accepted.speaker,
                narration=accepted.narration,
                dialogue=accepted.dialogue,
                segments=json.dumps([part.model_dump(mode="json") for part in accepted.segments], ensure_ascii=False),
                choices=json.dumps(accepted.choices, ensure_ascii=False),
                visual_directive=accepted.visual_directive.model_dump_json(),
                raw_response=raw_response,
                provider_id=context.provider_id,
                model_id=context.model_id,
                prompt_version=PROMPT_VERSION,
            )
            session.add(turn)
            session.flush()
            for beat_id in accepted.completed_beat_ids:
                beat_state = session.get(SessionBeat, (context.session_id, beat_id))
                if beat_state is None:
                    beat_state = SessionBeat(
                        session_id=context.session_id,
                        beat_id=beat_id,
                    )
                    session.add(beat_state)
                beat_state.status = "completed"
                beat_state.completed_turn_id = turn.id
            session.flush()
            updated = session.execute(
                update(StorySession)
                .where(StorySession.id == context.session_id, StorySession.state_version == context.state_version)
                .values(
                    state_version=context.state_version + 1,
                    active_turn_id=turn.id,
                    rewind_count=0,
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


class RewindUnavailableError(Exception):
    pass


def rewind_turn(session: Session, session_id: str, expected_state_version: int) -> None:
    """Move the active pointer one parent back without mutating either branch."""
    with session.begin():
        session.execute(text("BEGIN IMMEDIATE"))
        game = session.get(StorySession, session_id, populate_existing=True)
        if game is None:
            raise SessionNotFoundError
        if game.state_version != expected_state_version:
            raise StateConflictError
        if game.active_turn_id is None or game.rewind_count >= 10:
            raise RewindUnavailableError
        active = session.get(Turn, game.active_turn_id)
        if active is None or active.session_id != game.id:
            raise StateConflictError
        parent = session.get(Turn, active.parent_turn_id) if active.parent_turn_id else None
        story = stories.get_story_by_id(session, game.story_id)
        game.active_turn_id = active.parent_turn_id
        game.current_scene = parent.scene_after if parent else story.current_scene
        game.state_version += 1
        game.rewind_count += 1
        game.updated_at = utc_timestamp()


def change_model(session: Session, session_id: str, expected_state_version: int, model_id: str) -> None:
    """Change the next-turn model atomically; older turns retain their recorded model."""
    with session.begin():
        session.execute(text("BEGIN IMMEDIATE"))
        game = session.get(StorySession, session_id, populate_existing=True)
        if game is None:
            raise SessionNotFoundError
        if game.state_version != expected_state_version:
            raise StateConflictError
        if game.model_id != model_id:
            game.model_id = model_id
            game.state_version += 1
            game.updated_at = utc_timestamp()


def _turn_result(session: Session, turn: Turn) -> TurnResult:
    directive = json.loads(turn.visual_directive)
    if turn.prompt_version == "legacy-v01" and "character_id" not in directive:
        story_session = session.get(StorySession, turn.session_id)
        characters = stories.list_session_characters(session, story_session.id)
        if characters:
            # Historical visuals had no character identity. Choose the story's
            # first stable ID, never guess from mutable/nonunique speaker names.
            # This is a read-only compatibility view; leave saved history intact.
            directive["character_id"] = characters[0][0].id
        else:
            # Very early databases permitted stories without character rows.
            # Keep those saved turns replayable with an explicit legacy sentinel.
            directive["character_id"] = "legacy"
    # Historical turns stored only the active sprite. Keep replay read-only.
    if "present_character_ids" not in directive:
        saved_segments = json.loads(turn.segments) if turn.segments else []
        directive["present_character_ids"] = list(
            dict.fromkeys(
                part["character_id"]
                for part in saved_segments
                if part.get("kind") == "dialogue" and part.get("character_id")
            )
        ) or [directive["character_id"]]
    return TurnResult(
        id=turn.id,
        session_id=turn.session_id,
        request_id=turn.request_id,
        state_version=turn.state_version,
        action=turn.action,
        speaker=turn.speaker,
        narration=turn.narration,
        dialogue=turn.dialogue,
        segments=json.loads(turn.segments)
        if turn.segments
        else [
            {"kind": "narration", "text": turn.narration},
            {"kind": "dialogue", "character_id": directive["character_id"], "text": turn.dialogue},
        ],
        choices=json.loads(turn.choices),
        visual_directive=directive,
        provider_id=turn.provider_id,
        model_id=turn.model_id,
        prompt_version=turn.prompt_version,
        created_at=turn.created_at,
    )
