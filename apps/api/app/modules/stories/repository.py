from sqlmodel import Session, select

from app.db.models import Character, Story, StorySession, Turn


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


def get_latest_turn(session: Session, session_id: str) -> Turn | None:
    return session.exec(
        select(Turn).where(Turn.session_id == session_id).order_by(Turn.state_version.desc()).limit(1)
    ).first()
