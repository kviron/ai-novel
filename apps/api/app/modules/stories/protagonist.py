"""Resolve one player-controlled identity without exposing it as an AI NPC."""

import json

from sqlmodel import Session

from app.db.models import Character, CharacterRevision, ProtagonistExport, SessionProtagonist, Story, StoryCharacter
from app.modules.characters.schemas import CharacterProfile, CharacterWrite
from app.modules.characters.service import current_character_profile, stage_character

from .schemas import (
    CatalogHeroChoice,
    DraftHeroChoice,
    FixedHeroChoice,
    FixedHeroDetail,
    HeroChoice,
    ProtagonistCatalogCompletion,
    StorySetup,
)


class HeroSelectionError(Exception):
    pass


def _allowed_sources(story: Story) -> list[str]:
    try:
        sources = json.loads(story.hero_allowed_sources)
    except (TypeError, ValueError) as error:
        raise HeroSelectionError("invalid_hero_policy") from error
    if not isinstance(sources, list) or any(item not in {"catalog", "draft"} for item in sources):
        raise HeroSelectionError("invalid_hero_policy")
    return sources


def _playable_ids(story: Story) -> set[str]:
    try:
        ids = json.loads(story.playable_character_ids)
    except (TypeError, ValueError) as error:
        raise HeroSelectionError("invalid_playable_characters") from error
    if not isinstance(ids, list) or any(not isinstance(item, str) for item in ids):
        raise HeroSelectionError("invalid_playable_characters")
    return set(ids)


def story_setup(session: Session, story: Story) -> StorySetup:
    fixed_hero = None
    if story.hero_policy == "fixed":
        revision = session.get(CharacterRevision, story.fixed_hero_revision_id)
        if revision is None:
            raise HeroSelectionError("fixed_hero_missing")
        fixed_hero = FixedHeroDetail(
            id=revision.character_id,
            name=revision.name,
            gender=revision.gender,
            age=revision.age,
            personality=revision.personality,
            appearance=revision.appearance,
            biography=revision.biography,
            role="hero",
            visual_profile_version=revision.revision_number,
        )
    if story.hero_policy not in {"choice", "fixed"}:
        raise HeroSelectionError("invalid_hero_policy")
    return StorySetup(
        story_id=story.id,
        policy=story.hero_policy,
        policy_version=story.hero_policy_version,
        allowed_sources=_allowed_sources(story) if story.hero_policy == "choice" else [],
        playable_character_ids=sorted(_playable_ids(story)),
        fixed_hero=fixed_hero,
    )


def resolve_protagonist(
    session: Session, story: Story, choice: HeroChoice | None, session_id: str
) -> SessionProtagonist:
    """Validate policy and stage a stable hero snapshot; caller owns commit."""
    setup = story_setup(session, story)
    if choice is None:
        # Preserve older clients and author previews without creating a catalog entry.
        if setup.policy == "fixed":
            choice = FixedHeroChoice(source_kind="fixed")
        elif "draft" in setup.allowed_sources:
            choice = DraftHeroChoice(source_kind="draft", name="Игрок")
        else:
            raise HeroSelectionError("hero_choice_required")

    if isinstance(choice, DraftHeroChoice):
        if setup.policy != "choice" or "draft" not in setup.allowed_sources:
            raise HeroSelectionError("draft_not_allowed")
        protagonist = SessionProtagonist(
            session_id=session_id,
            source_kind="draft",
            policy_version=story.hero_policy_version,
            name=choice.name,
            address=choice.address or choice.name,
            gender=choice.gender,
            appearance=choice.appearance,
            biography=choice.biography,
        )
    else:
        if isinstance(choice, FixedHeroChoice):
            if setup.policy != "fixed":
                raise HeroSelectionError("fixed_not_allowed")
            revision_id = story.fixed_hero_revision_id
            expected_character_id = None
            source_kind = "fixed"
        elif isinstance(choice, CatalogHeroChoice):
            if setup.policy != "choice" or "catalog" not in setup.allowed_sources:
                raise HeroSelectionError("catalog_not_allowed")
            revision_id = choice.revision_id
            expected_character_id = choice.character_id
            source_kind = "catalog"
        else:
            raise HeroSelectionError("invalid_hero_choice")
        revision = session.get(CharacterRevision, revision_id)
        if revision is None or (expected_character_id and revision.character_id != expected_character_id):
            raise HeroSelectionError("hero_revision_missing")
        character = session.get(Character, revision.character_id)
        if character is None:
            raise HeroSelectionError("hero_character_missing")
        cast_link = session.get(StoryCharacter, (story.id, character.id))
        if source_kind == "catalog" and cast_link is not None and character.id not in _playable_ids(story):
            raise HeroSelectionError("cast_member_not_playable")
        protagonist = SessionProtagonist(
            session_id=session_id,
            source_kind=source_kind,
            source_character_id=character.id,
            source_revision_id=revision.id,
            policy_version=story.hero_policy_version,
            name=revision.name,
            address=revision.name.split()[0],
            gender=revision.gender,
            appearance=revision.appearance,
            biography=revision.biography,
            personality=revision.personality,
            age=revision.age,
        )
    session.add(protagonist)
    return protagonist


def save_protagonist_to_catalog(
    session: Session, session_id: str, completion: ProtagonistCatalogCompletion
) -> CharacterProfile:
    """Promote a draft once; the playthrough keeps its original snapshot."""
    existing = session.get(ProtagonistExport, session_id)
    if existing is not None:
        return current_character_profile(session, existing.character_id)
    protagonist = session.get(SessionProtagonist, session_id)
    if protagonist is None:
        raise HeroSelectionError("session_missing")
    if protagonist.source_kind != "draft":
        raise HeroSelectionError("only_draft_can_be_promoted")
    age = protagonist.age or completion.age
    personality = protagonist.personality or completion.personality
    appearance = protagonist.appearance or completion.appearance
    if age is None or not personality or not appearance:
        raise HeroSelectionError("catalog_fields_missing")
    payload = CharacterWrite(
        name=protagonist.name,
        gender=protagonist.gender,
        age=age,
        personality=personality,
        appearance=appearance,
        biography=protagonist.biography,
    )
    character, _ = stage_character(session, payload)
    session.add(ProtagonistExport(session_id=session_id, character_id=character.id))
    session.commit()
    return current_character_profile(session, character.id)
