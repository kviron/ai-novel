import json
from pathlib import Path

from sqlmodel import Session

from app.db.models import Character, Story

from .repository import get_story_by_slug

AKANE_SLUG = "akane-neon-echo"
AKANE_EMOTIONS = ["neutral", "happy", "sad", "angry", "surprised", "fan"]


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
