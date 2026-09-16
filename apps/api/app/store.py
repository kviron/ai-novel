import json
import sqlite3
from datetime import UTC, datetime
from uuid import uuid4

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
                "INSERT INTO stories VALUES (?, ?, ?, ?, 1, ?, ?)",
                (story_id, payload.title, payload.premise, json.dumps(payload.theme_labels), "Arrival", timestamp),
            )
            for character in payload.characters:
                character_id = str(uuid4())
                db.execute(
                    "INSERT INTO characters VALUES (?, ?, ?, ?, ?, ?, 1)",
                    (character_id, story_id, character.name, character.age, character.personality, character.appearance),
                )
                sheet_id = str(uuid4())
                db.execute(
                    "INSERT INTO generation_jobs VALUES (?, ?, ?, 'character_sheet', NULL, NULL, 'queued', 'Waiting for image worker', NULL, ?)",
                    (sheet_id, story_id, character_id, timestamp),
                )
                for expression in ("neutral", "happy", "sad", "angry", "surprised"):
                    db.execute(
                        "INSERT INTO generation_jobs VALUES (?, ?, ?, 'sprite', ?, ?, 'queued', 'Waiting for character sheet', NULL, ?)",
                        (str(uuid4()), story_id, character_id, expression, sheet_id, timestamp),
                    )
        return self.get_story(story_id)

    def get_story(self, story_id: str) -> dict | None:
        with self.database.connect() as db:
            story = db.execute("SELECT * FROM stories WHERE id = ?", (story_id,)).fetchone()
            if not story:
                return None
            characters = [dict(row) for row in db.execute("SELECT * FROM characters WHERE story_id = ? ORDER BY rowid", (story_id,))]
            latest = db.execute("SELECT * FROM turns WHERE story_id = ? ORDER BY rowid DESC LIMIT 1", (story_id,)).fetchone()
        result = dict(story)
        result["theme_labels"] = json.loads(result["theme_labels"])
        result["characters"] = characters
        result["latest_turn"] = self._turn(latest) if latest else None
        return result

    def list_jobs(self, story_id: str) -> list[dict]:
        with self.database.connect() as db:
            return [dict(row) for row in db.execute("SELECT * FROM generation_jobs WHERE story_id = ? ORDER BY rowid", (story_id,))]

    def create_turn(self, story_id: str, payload: TurnCreate) -> tuple[dict, bool]:
        with self.database.connect() as db:
            existing = db.execute(
                "SELECT * FROM turns WHERE story_id = ? AND request_id = ?", (story_id, payload.request_id)
            ).fetchone()
            if existing:
                return self._turn(existing), False
            story = db.execute("SELECT * FROM stories WHERE id = ?", (story_id,)).fetchone()
            if not story:
                raise KeyError(story_id)
            if story["state_version"] != payload.expected_state_version:
                raise ConflictError("Story state changed; reload before continuing")
            character = db.execute("SELECT name FROM characters WHERE story_id = ? ORDER BY rowid LIMIT 1", (story_id,)).fetchone()
            version = story["state_version"] + 1
            turn_id = str(uuid4())
            speaker = character["name"] if character else "Narrator"
            dialogue = f'“{payload.action},” you decide. {speaker} studies the choice, then nods.'
            narration = "Rain traces silver paths across the window as the story shifts around your decision."
            choices = ["Ask what happens next", "Look for another path", "Stay silent and observe"]
            db.execute("UPDATE stories SET state_version = ? WHERE id = ?", (version, story_id))
            db.execute(
                "INSERT INTO turns VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (turn_id, story_id, payload.request_id, version, payload.action, speaker, dialogue, narration, json.dumps(choices), now()),
            )
            row = db.execute("SELECT * FROM turns WHERE id = ?", (turn_id,)).fetchone()
            return self._turn(row), True

    @staticmethod
    def _turn(row: sqlite3.Row) -> dict:
        turn = dict(row)
        turn["choices"] = json.loads(turn["choices"])
        return turn
