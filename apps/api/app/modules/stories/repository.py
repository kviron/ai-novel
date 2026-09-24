from sqlmodel import Session, select

from app.db.models import Autosave, Character, Story, StorySession, Turn


def list_stories(session: Session) -> list[Story]:
    return list(session.exec(select(Story).order_by(Story.created_at, Story.id)))


def get_story_by_id(session: Session, story_id: str) -> Story | None:
    return session.get(Story, story_id)


def get_story_by_slug(session: Session, slug: str) -> Story | None:
    return session.exec(select(Story).where(Story.slug == slug)).first()


def list_characters(session: Session, story_id: str) -> list[Character]:
    return list(session.exec(select(Character).where(Character.story_id == story_id).order_by(Character.id)))


def get_story_session(session: Session, session_id: str) -> StorySession | None:
    return session.get(StorySession, session_id)


def list_story_sessions(session: Session, kind: str) -> list[tuple[StorySession, Story]]:
    return list(session.exec(
        select(StorySession, Story)
        .join(Story, Story.id == StorySession.story_id)
        .where(StorySession.kind == kind)
        .order_by(StorySession.updated_at.desc(), StorySession.id.desc())
    ))


def list_autosaves(session: Session) -> list[tuple[StorySession, Story]]:
    return list(session.exec(
        select(StorySession, Story)
        .join(Autosave, Autosave.session_id == StorySession.id)
        .join(Story, Story.id == Autosave.story_id)
        .order_by(StorySession.updated_at.desc(), StorySession.id.desc())
    ))


def get_active_turn(session: Session, story_session: StorySession) -> Turn | None:
    return session.get(Turn, story_session.active_turn_id) if story_session.active_turn_id else None
