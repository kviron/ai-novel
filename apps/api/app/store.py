import json
import sqlite3
from datetime import UTC, datetime
from uuid import NAMESPACE_URL, uuid4, uuid5

from .database import Database
from .schemas import StoryCreate, TurnCreate


def now() -> str:
    return datetime.now(UTC).isoformat()


class ConflictError(Exception):
    pass


class Store:
    def __init__(self, database: Database):
        self.database = database

    def create_story(self, payload: StoryCreate) -> dict:
        story_id = str(uuid4())
        timestamp = now()
        with self.database.connect() as db:
            db.execute(
                """
                INSERT INTO stories (
                    id, slug, title, premise, theme_labels, state_version, story_mode, content_version, current_scene,
                    recommended_provider_id, recommended_model_id, created_at
                ) VALUES (?, ?, ?, ?, ?, 1, 'hybrid', 1, ?, 'ollama', 'qwen3:14b-q4_K_M', ?)
                """,
                (story_id, story_id, payload.title, payload.premise, json.dumps(payload.theme_labels), "Прибытие", timestamp),
            )
            for character in payload.characters:
                character_id = str(uuid4())
                db.execute(
                    "INSERT INTO characters VALUES (?, ?, ?, ?, ?, ?, 1)",
                    (character_id, story_id, character.name, character.age, character.personality, character.appearance),
                )
                sheet_id = str(uuid4())
                db.execute(
                    "INSERT INTO generation_jobs VALUES (?, ?, ?, 'character_sheet', NULL, NULL, 'queued', 'Ожидает генератор изображений', NULL, ?)",
                    (sheet_id, story_id, character_id, timestamp),
                )
                for expression in ("neutral", "happy", "sad", "angry", "surprised"):
                    db.execute(
                        "INSERT INTO generation_jobs VALUES (?, ?, ?, 'sprite', ?, ?, 'queued', 'Ожидает лист персонажа', NULL, ?)",
                        (str(uuid4()), story_id, character_id, expression, sheet_id, timestamp),
                    )
        return self.get_story(story_id)

    def get_story(self, story_id: str) -> dict | None:
        with self.database.connect() as db:
            story = db.execute("SELECT * FROM stories WHERE id = ?", (story_id,)).fetchone()
            if not story:
                return None
            characters = [dict(row) for row in db.execute("SELECT * FROM characters WHERE story_id = ? ORDER BY rowid", (story_id,))]
            latest = db.execute(
                """
                SELECT turns.* FROM turns
                JOIN story_sessions ON story_sessions.id = turns.session_id
                WHERE story_sessions.story_id = ?
                ORDER BY turns.state_version DESC, turns.created_at DESC, turns.id DESC
                LIMIT 1
                """,
                (story_id,),
            ).fetchone()
        result = dict(story)
        result["theme_labels"] = json.loads(result["theme_labels"])
        result["characters"] = characters
        result["latest_turn"] = self._turn(latest) if latest else None
        return result

    def list_jobs(self, story_id: str) -> list[dict]:
        with self.database.connect() as db:
            return [dict(row) for row in db.execute("SELECT * FROM generation_jobs WHERE story_id = ? ORDER BY rowid", (story_id,))]

    def create_turn(self, story_id: str, payload: TurnCreate) -> tuple[dict, bool]:
        timestamp = now()
        with self.database.connect() as db:
            story = db.execute("SELECT * FROM stories WHERE id = ?", (story_id,)).fetchone()
            if not story:
                raise KeyError(story_id)
            migrated_session_id = str(uuid5(NAMESPACE_URL, f"legacy-story-session:{story_id}"))
            story_session = db.execute("SELECT * FROM story_sessions WHERE id = ?", (migrated_session_id,)).fetchone()
            session_id = migrated_session_id
            if not story_session:
                session_id = str(uuid5(NAMESPACE_URL, f"legacy-compat-session:{story_id}"))
                story_session = db.execute("SELECT * FROM story_sessions WHERE id = ?", (session_id,)).fetchone()
            existing = db.execute(
                "SELECT * FROM turns WHERE session_id = ? AND request_id = ?", (session_id, payload.request_id)
            ).fetchone()
            if existing:
                return self._turn(existing), False
            session_version = story_session["state_version"] if story_session else 1
            if session_version != payload.expected_state_version:
                raise ConflictError("Состояние истории изменилось. Обновите страницу перед продолжением")
            character = db.execute("SELECT name FROM characters WHERE story_id = ? ORDER BY rowid LIMIT 1", (story_id,)).fetchone()
            version = session_version + 1
            turn_id = str(uuid4())
            speaker = character["name"] if character else "Рассказчик"
            dialogue = f'«{payload.action}», — решаете вы. {speaker} обдумывает ваши слова и кивает.'
            narration = "Дождь рисует серебряные дорожки на стекле, и история меняется вслед за вашим решением."
            choices = ["Спросить, что будет дальше", "Поискать другой путь", "Промолчать и наблюдать"]
            if not story_session:
                db.execute(
                    """
                    INSERT INTO story_sessions (
                        id, story_id, state_version, current_scene, provider_id, model_id, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        session_id,
                        story_id,
                        version,
                        story["current_scene"],
                        story["recommended_provider_id"],
                        story["recommended_model_id"],
                        timestamp,
                        timestamp,
                    ),
                )
            else:
                db.execute("UPDATE story_sessions SET state_version = ?, updated_at = ? WHERE id = ?", (version, timestamp, session_id))
            db.execute(
                """
                INSERT INTO turns (
                    id, session_id, request_id, state_version, legacy_state_version, action, speaker, narration, dialogue,
                    choices, visual_directive, raw_response, provider_id, model_id, prompt_version, created_at
                ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, '', ?, ?, 'legacy-v01', ?)
                """,
                (
                    turn_id,
                    session_id,
                    payload.request_id,
                    version,
                    payload.action,
                    speaker,
                    narration,
                    dialogue,
                    json.dumps(choices),
                    '{"mode":"sprite_scene","emotion":"neutral","pose":"default","outfit":"red_dress"}',
                    story["recommended_provider_id"],
                    story["recommended_model_id"],
                    timestamp,
                ),
            )
            row = db.execute("SELECT * FROM turns WHERE id = ?", (turn_id,)).fetchone()
            return self._turn(row), True

    @staticmethod
    def _turn(row: sqlite3.Row) -> dict:
        turn = dict(row)
        turn["choices"] = json.loads(turn["choices"])
        return turn
