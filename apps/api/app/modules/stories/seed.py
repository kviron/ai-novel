import json
from pathlib import Path

from sqlmodel import Session

from app.db.models import Character, Story

from .repository import get_story_by_slug

AKANE_SLUG = "akane-neon-echo"
AKANE_EMOTIONS = ["neutral", "happy", "sad", "angry", "surprised", "fan"]
AKANE_DESCRIPTION = (
    "Ночной город хранит воспоминания, которые лучше было бы забыть. "
    "Вместе с Аканэ Куроха вы отправитесь по следу странного сигнала, "
    "расспросите свидетелей и решите, каким воспоминаниям можно доверять. "
    "Каждый ответ меняет ваш разговор и путь через неоновый дождь."
)


def seed_akane_story(session: Session) -> None:
    """Add the immutable first-playable story only when it is absent."""
    if get_story_by_slug(session, AKANE_SLUG) is not None:
        return

    profile_path = Path(__file__).resolve().parents[5] / "assets" / "characters" / "akane" / "character-profile.json"
    profile = json.loads(profile_path.read_text(encoding="utf-8"))
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
    session.add(
        Character(
            id=profile["id"],
            story_id=story.id,
            name=profile["name"],
            age=profile["age"],
            personality=profile["personality"],
            appearance=json.dumps(profile["appearance"], ensure_ascii=False),
        )
    )
