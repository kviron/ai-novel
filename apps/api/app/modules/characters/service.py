from sqlmodel import Session

from app.db.models import Character, CharacterRevision, Story, StoryCharacter

from . import repository
from .schemas import (
    AttachCharacterRequest,
    CharacterHistory,
    CharacterProfile,
    CharacterWrite,
    RevisionProfile,
    StoryCharacterProfile,
)


class CharacterNotFoundError(Exception):
    pass


class StoryNotFoundError(Exception):
    pass


class InvalidRevisionError(Exception):
    pass


class CharacterAlreadyAttachedError(Exception):
    pass


def _revision_profile(revision: CharacterRevision) -> RevisionProfile:
    return RevisionProfile.model_validate(revision, from_attributes=True)


def _character_profile(character: Character, revision: CharacterRevision) -> CharacterProfile:
    return CharacterProfile(
        **_revision_profile(revision).model_dump(exclude={"id"}),
        id=character.id,
        character_id=character.id,
        current_revision_id=revision.id,
        source_type=character.source_type,
    )


def list_characters(session: Session) -> list[CharacterProfile]:
    return [_character_profile(character, revision) for character, revision in repository.list_current(session)]


def get_character(session: Session, character_id: str) -> CharacterHistory:
    character = session.get(Character, character_id)
    if character is None:
        raise CharacterNotFoundError
    return CharacterHistory(
        id=character.id,
        current_revision_id=character.current_revision_id,
        source_type=character.source_type,
        revisions=[_revision_profile(revision) for revision in repository.list_revisions(session, character_id)],
    )


def create_character(session: Session, payload: CharacterWrite) -> CharacterProfile:
    # Legacy columns stay populated until all story readers use revision links.
    character = Character(
        source_type="local", **payload.model_dump(include={"name", "gender", "age", "personality", "appearance"})
    )
    session.add(character)
    session.flush()
    revision = CharacterRevision(character_id=character.id, revision_number=1, **payload.model_dump())
    session.add(revision)
    session.flush()
    character.current_revision_id = revision.id
    session.commit()
    return _character_profile(character, revision)


def revise_character(session: Session, character_id: str, payload: CharacterWrite) -> CharacterProfile:
    character = session.get(Character, character_id)
    if character is None:
        raise CharacterNotFoundError
    revisions = repository.list_revisions(session, character_id)
    revision = CharacterRevision(
        character_id=character_id,
        revision_number=revisions[-1].revision_number + 1,
        **payload.model_dump(),
    )
    session.add(revision)
    session.flush()
    character.current_revision_id = revision.id
    session.commit()
    return _character_profile(character, revision)


def attach_character(session: Session, story_id: str, payload: AttachCharacterRequest) -> StoryCharacterProfile:
    if session.get(Story, story_id) is None:
        raise StoryNotFoundError
    if session.get(Character, payload.character_id) is None:
        raise CharacterNotFoundError
    if repository.get_story_link(session, story_id, payload.character_id) is not None:
        raise CharacterAlreadyAttachedError
    revision = session.get(CharacterRevision, payload.revision_id)
    if revision is None or revision.character_id != payload.character_id:
        raise InvalidRevisionError
    link = StoryCharacter(story_id=story_id, **payload.model_dump())
    session.add(link)
    session.commit()
    return StoryCharacterProfile.model_validate(link, from_attributes=True)


def pin_revision(session: Session, story_id: str, character_id: str, revision_id: str) -> StoryCharacterProfile:
    link = repository.get_story_link(session, story_id, character_id)
    if link is None:
        raise CharacterNotFoundError
    revision = session.get(CharacterRevision, revision_id)
    if revision is None or revision.character_id != character_id:
        raise InvalidRevisionError
    link.revision_id = revision.id
    session.commit()
    return StoryCharacterProfile.model_validate(link, from_attributes=True)
