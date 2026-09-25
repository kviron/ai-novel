from sqlmodel import Session

from app.db.models import (
    Character,
    CharacterMaterial,
    CharacterRevision,
    SessionCharacter,
    Story,
    StoryCharacter,
    StorySession,
)

from . import repository
from .schemas import (
    AttachCharacterRequest,
    CharacterHistory,
    CharacterProfile,
    CharacterWrite,
    LinkedStory,
    MaterialProfile,
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


class LastCastMemberError(Exception):
    pass


class SessionNotFoundError(Exception):
    pass


def _material_profile(material: CharacterMaterial | None) -> MaterialProfile | None:
    if material is None:
        return None
    return MaterialProfile(
        **{
            key: getattr(material, key)
            for key in ("id", "kind", "sha256", "mime_type", "filename", "creator", "license", "source")
        },
        url=f"/api/character-materials/{material.id}",
    )


def _revision_profile(session: Session, revision: CharacterRevision) -> RevisionProfile:
    return RevisionProfile.model_validate(
        {
            **RevisionProfile.model_validate(revision, from_attributes=True).model_dump(exclude={"avatar", "cover"}),
            "avatar": _material_profile(repository.material_for_revision(session, revision.id)),
            "cover": _material_profile(repository.material_for_revision(session, revision.id, "cover")),
        }
    )


def _character_profile(session: Session, character: Character, revision: CharacterRevision) -> CharacterProfile:
    return CharacterProfile(
        **_revision_profile(session, revision).model_dump(exclude={"id"}),
        id=character.id,
        character_id=character.id,
        current_revision_id=revision.id,
        source_type=character.source_type,
        origin_character_id=character.origin_character_id,
    )


def list_characters(session: Session, exclude_story_id: str | None = None) -> list[CharacterProfile]:
    attached = (
        {link.character_id for link in repository.list_story_links_for_story(session, exclude_story_id)}
        if exclude_story_id
        else set()
    )
    return [
        _character_profile(session, character, revision)
        for character, revision in repository.list_current(session)
        if character.id not in attached
    ]


def get_character(session: Session, character_id: str) -> CharacterHistory:
    character = session.get(Character, character_id)
    if character is None:
        raise CharacterNotFoundError
    return CharacterHistory(
        id=character.id,
        current_revision_id=character.current_revision_id,
        source_type=character.source_type,
        origin_character_id=character.origin_character_id,
        revisions=[
            _revision_profile(session, revision) for revision in repository.list_revisions(session, character_id)
        ],
        linked_stories=[
            LinkedStory(
                story_id=story.id,
                story_title=story.title,
                story_slug=story.slug,
                revision_id=link.revision_id,
                revision_number=revision.revision_number,
                role=link.role,
                color=link.color,
            )
            for story, link, revision in repository.list_story_links(session, character_id)
        ],
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
    return _character_profile(session, character, revision)


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
    previous_materials = (
        repository.materials_for_revision(session, character.current_revision_id)
        if character.current_revision_id
        else []
    )
    for previous_material in previous_materials:
        session.add(
            CharacterMaterial(
                revision_id=revision.id,
                kind=previous_material.kind,
                sha256=previous_material.sha256,
                mime_type=previous_material.mime_type,
                filename=previous_material.filename,
                creator=previous_material.creator,
                license=previous_material.license,
                source=previous_material.source,
            )
        )
    character.current_revision_id = revision.id
    session.commit()
    return _character_profile(session, character, revision)


def extract_session_character(session: Session, session_id: str, character_id: str) -> CharacterProfile:
    """Fork the session's pinned profile, never the catalog's possibly newer revision."""
    if session.get(StorySession, session_id) is None:
        raise SessionNotFoundError
    pinned = session.get(SessionCharacter, (session_id, character_id))
    if pinned is None:
        raise CharacterNotFoundError
    source_revision = session.get(CharacterRevision, pinned.revision_id)
    profile = CharacterWrite(**{field: getattr(source_revision, field) for field in CharacterWrite.model_fields})
    character = Character(
        source_type="extracted",
        origin_character_id=character_id,
        **profile.model_dump(include={"name", "gender", "age", "personality", "appearance"}),
    )
    session.add(character)
    session.flush()
    revision = CharacterRevision(character_id=character.id, revision_number=1, **profile.model_dump())
    session.add(revision)
    session.flush()
    for material in repository.materials_for_revision(session, source_revision.id):
        session.add(
            CharacterMaterial(
                revision_id=revision.id,
                kind=material.kind,
                sha256=material.sha256,
                mime_type=material.mime_type,
                filename=material.filename,
                creator=material.creator,
                license=material.license,
                source=material.source,
            )
        )
    character.current_revision_id = revision.id
    session.commit()
    return _character_profile(session, character, revision)


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


def attach_characters_batch(session: Session, story_id: str, character_ids: list[str]) -> list[StoryCharacterProfile]:
    if session.get(Story, story_id) is None:
        raise StoryNotFoundError
    if len(set(character_ids)) != len(character_ids):
        raise CharacterAlreadyAttachedError
    # Validate the complete selection before staging any link so one invalid ID cannot partially add a cast.
    links = []
    for character_id in character_ids:
        character = session.get(Character, character_id)
        if character is None:
            raise CharacterNotFoundError
        if repository.get_story_link(session, story_id, character_id) is not None:
            raise CharacterAlreadyAttachedError
        if character.current_revision_id is None:
            raise InvalidRevisionError
        links.append(
            StoryCharacter(story_id=story_id, character_id=character_id, revision_id=character.current_revision_id)
        )
    session.add_all(links)
    session.commit()
    return [StoryCharacterProfile.model_validate(link, from_attributes=True) for link in links]


def pin_revision(
    session: Session,
    story_id: str,
    character_id: str,
    revision_id: str,
    role: str | None = None,
    color: str | None = None,
) -> StoryCharacterProfile:
    link = repository.get_story_link(session, story_id, character_id)
    if link is None:
        raise CharacterNotFoundError
    revision = session.get(CharacterRevision, revision_id)
    if revision is None or revision.character_id != character_id:
        raise InvalidRevisionError
    link.revision_id = revision.id
    if role is not None:
        link.role = role
    if color is not None:
        link.color = color
    session.commit()
    return StoryCharacterProfile.model_validate(link, from_attributes=True)


def detach_character(session: Session, story_id: str, character_id: str) -> None:
    link = repository.get_story_link(session, story_id, character_id)
    if link is None:
        raise CharacterNotFoundError
    if len(repository.list_story_links_for_story(session, story_id)) <= 1:
        raise LastCastMemberError
    session.delete(link)
    session.commit()
