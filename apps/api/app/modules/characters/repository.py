from sqlmodel import Session, select

from app.db.models import Character, CharacterRevision, Story, StoryCharacter


def list_current(session: Session) -> list[tuple[Character, CharacterRevision]]:
    return list(
        session.exec(
            select(Character, CharacterRevision)
            .join(CharacterRevision, Character.current_revision_id == CharacterRevision.id)
            .order_by(CharacterRevision.name, Character.id)
        )
    )


def list_revisions(session: Session, character_id: str) -> list[CharacterRevision]:
    return list(
        session.exec(
            select(CharacterRevision)
            .where(CharacterRevision.character_id == character_id)
            .order_by(CharacterRevision.revision_number)
        )
    )


def get_story_link(session: Session, story_id: str, character_id: str) -> StoryCharacter | None:
    return session.get(StoryCharacter, (story_id, character_id))


def list_story_links_for_story(session: Session, story_id: str) -> list[StoryCharacter]:
    return list(session.exec(select(StoryCharacter).where(StoryCharacter.story_id == story_id)))


def list_story_links(session: Session, character_id: str) -> list[tuple[Story, StoryCharacter, CharacterRevision]]:
    return list(
        session.exec(
            select(Story, StoryCharacter, CharacterRevision)
            .join(StoryCharacter, StoryCharacter.story_id == Story.id)
            .join(CharacterRevision, CharacterRevision.id == StoryCharacter.revision_id)
            .where(StoryCharacter.character_id == character_id)
            .order_by(Story.title, Story.id)
        )
    )
