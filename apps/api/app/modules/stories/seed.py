import json
from pathlib import Path

from sqlmodel import Session

from app.db.models import Character, CharacterRevision, Story, StoryCharacter

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
            session.add(StoryCharacter(
                story_id=story.id,
                character_id=character.id,
                revision_id=character.current_revision_id,
            ))
