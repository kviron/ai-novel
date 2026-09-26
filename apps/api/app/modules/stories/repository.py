from sqlmodel import Session, select

from app.db.models import (
    Autosave,
    Character,
    CharacterRevision,
    SessionCharacter,
    Story,
    StorySession,
    StoryVersionCharacter,
    Turn,
)


def list_stories(session: Session) -> list[Story]:
    return list(
        session.exec(
            select(Story).where(Story.current_published_version_id.is_not(None)).order_by(Story.created_at, Story.id)
        )
    )


def get_story_by_id(session: Session, story_id: str) -> Story | None:
    return session.get(Story, story_id)


def get_story_by_slug(session: Session, slug: str) -> Story | None:
    return session.exec(select(Story).where(Story.slug == slug)).first()


def list_session_characters(
    session: Session, session_id: str
) -> list[tuple[Character, CharacterRevision, SessionCharacter]]:
    return list(
        session.exec(
            select(Character, CharacterRevision, SessionCharacter)
            .join(SessionCharacter, SessionCharacter.character_id == Character.id)
            .join(CharacterRevision, CharacterRevision.id == SessionCharacter.revision_id)
            .where(SessionCharacter.session_id == session_id)
            .order_by(Character.id)
        )
    )


def pin_version_characters(
    session: Session, version_id: str, session_id: str, exclude_character_id: str | None = None
) -> None:
    """Copy the immutable version cast into the session audit snapshot."""
    links = session.exec(
        select(StoryVersionCharacter)
        .where(StoryVersionCharacter.version_id == version_id)
        .order_by(StoryVersionCharacter.order_index, StoryVersionCharacter.id)
    )
    for link in links:
        if link.character_id == exclude_character_id:
            continue
        session.add(
            SessionCharacter(
                session_id=session_id,
                character_id=link.character_id,
                revision_id=link.revision_id,
                role=link.role,
                color=link.color,
            )
        )


def get_story_session(session: Session, session_id: str) -> StorySession | None:
    return session.get(StorySession, session_id)


def list_story_sessions(session: Session, kind: str) -> list[tuple[StorySession, Story]]:
    return list(
        session.exec(
            select(StorySession, Story)
            .join(Story, Story.id == StorySession.story_id)
            .where(StorySession.kind == kind)
            .order_by(StorySession.updated_at.desc(), StorySession.id.desc())
        )
    )


def list_autosaves(session: Session) -> list[tuple[StorySession, Story]]:
    return list(
        session.exec(
            select(StorySession, Story)
            .join(Autosave, Autosave.session_id == StorySession.id)
            .join(Story, Story.id == Autosave.story_id)
            .order_by(StorySession.updated_at.desc(), StorySession.id.desc())
        )
    )


def get_active_turn(session: Session, story_session: StorySession) -> Turn | None:
    return session.get(Turn, story_session.active_turn_id) if story_session.active_turn_id else None
