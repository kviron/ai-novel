import json
from pathlib import Path

from sqlmodel import Session, select

from app.db.models import Character, CharacterRevision, Story, StoryCharacter, StoryVersion, StoryVersionCharacter

from .content import AKANE_EMOTIONS, AKANE_SLUG
from .repository import get_story_by_slug

AKANE_DESCRIPTION = (
    "Ночной город хранит воспоминания, которые лучше было бы забыть. "
    "Вместе с Аканэ Куроха вы отправитесь по следу странного сигнала, "
    "расспросите свидетелей и решите, каким воспоминаниям можно доверять. "
    "Каждый ответ меняет ваш разговор и путь через неоновый дождь."
)


def seed_akane_story(session: Session) -> None:
    """Seed the demo cast idempotently, including on existing installations."""
    story = get_story_by_slug(session, AKANE_SLUG)
    if story is None:
        story = Story(
            slug=AKANE_SLUG,
            title="Эхо неона",
            premise="В дождливом неоновом городе Аканэ помогает распутать чужое воспоминание.",
            description=AKANE_DESCRIPTION,
            cover_image_url="/covers/akane-neon-echo.webp",
            theme_labels=json.dumps(AKANE_EMOTIONS, ensure_ascii=False),
            story_mode="hybrid",
            current_scene="Ночной перекрёсток",
            recommended_provider_id="ollama",
            recommended_model_id="qwen3:14b-q4_K_M",
        )
        session.add(story)
        session.flush()

    assets = Path(__file__).resolve().parents[5] / "assets" / "characters"
    for character_id in ("akane", "mark"):
        character = session.get(Character, character_id)
        if character is None:
            profile = json.loads((assets / character_id / "character-profile.json").read_text(encoding="utf-8"))
            character = Character(
                id=profile["id"],
                story_id=story.id,
                name=profile["name"],
                gender=profile["gender"],
                age=profile["age"],
                personality=profile["personality"],
                appearance=json.dumps(profile["appearance"], ensure_ascii=False),
                source_type="builtin",
            )
            session.add(character)
            session.flush()

        # Seed only missing canonical records; a restart must never move an author's pin.
        if character.current_revision_id is None:
            revision = CharacterRevision(
                character_id=character.id,
                revision_number=1,
                name=character.name,
                gender=character.gender,
                age=character.age,
                personality=character.personality,
                appearance=character.appearance,
            )
            session.add(revision)
            session.flush()
            character.current_revision_id = revision.id
        if session.get(StoryCharacter, (story.id, character.id)) is None:
            session.add(
                StoryCharacter(
                    story_id=story.id,
                    character_id=character.id,
                    revision_id=character.current_revision_id,
                )
            )

    if story.current_published_version_id is None:
        version_id = f"{story.id}:v1"
        version = session.get(StoryVersion, version_id)
        if version is None:
            version = StoryVersion(
                id=version_id,
                story_id=story.id,
                version_number=1,
                status="published",
                mode="freeform" if story.story_mode == "free" else story.story_mode,
                title=story.title,
                slug=story.slug,
                short_description=story.description,
                premise=story.premise,
                tone=json.dumps(json.loads(story.theme_labels), ensure_ascii=False, separators=(",", ":")),
                opening_situation=story.current_scene,
                hero_policy=story.hero_policy,
                hero_allowed_sources=story.hero_allowed_sources,
                fixed_hero_revision_id=story.fixed_hero_revision_id,
                recommended_provider_id=story.recommended_provider_id,
                recommended_model_id=story.recommended_model_id,
                created_at=story.created_at,
                published_at=story.created_at,
            )
            session.add(version)
            session.flush()
            playable_ids = set(json.loads(story.playable_character_ids))
            links = session.exec(
                select(StoryCharacter)
                .where(StoryCharacter.story_id == story.id)
                .order_by(StoryCharacter.character_id)
            ).all()
            for order_index, link in enumerate(links):
                session.add(
                    StoryVersionCharacter(
                        id=f"{version_id}:character:{link.character_id}",
                        version_id=version_id,
                        character_id=link.character_id,
                        revision_id=link.revision_id,
                        order_index=order_index,
                        role=link.role,
                        color=link.color,
                        playable=link.character_id in playable_ids,
                    )
                )
        story.current_published_version_id = version_id
