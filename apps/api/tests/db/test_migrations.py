import sqlite3

import pytest
from conftest import create_v01_database
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.core.config import Settings
from app.db.engine import create_engine_from_settings
from app.db.migrate import run_migrations


def test_upgrade_creates_playable_story_tables(tmp_path, monkeypatch):
    database_path = tmp_path / "migration.db"
    monkeypatch.setenv("DATABASE_PATH", str(database_path))
    run_migrations(database_path)
    run_migrations(database_path)

    with sqlite3.connect(database_path) as db:
        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        columns = {row[1] for row in db.execute("PRAGMA table_info(turns)")}

    assert {"stories", "characters", "story_sessions", "turns"} <= tables
    assert {"session_id", "raw_response", "visual_directive", "provider_id", "model_id"} <= columns


def test_upgrade_preserves_legacy_story_and_turn(tmp_path):
    database_path = tmp_path / "legacy.db"
    create_v01_database(database_path, story_id="legacy-story", turn_id="legacy-turn")
    run_migrations(database_path)

    with sqlite3.connect(database_path) as db:
        story = db.execute("SELECT id FROM stories WHERE id='legacy-story'").fetchone()
        turn = db.execute("SELECT id, session_id FROM turns WHERE id='legacy-turn'").fetchone()
        session = db.execute("SELECT story_id, state_version FROM story_sessions WHERE id=?", (turn[1],)).fetchone()

    assert story == ("legacy-story",)
    assert session == ("legacy-story", 2)


def test_engine_enforces_foreign_keys(tmp_path):
    database_path = tmp_path / "foreign-keys.db"
    run_migrations(database_path)
    engine = create_engine_from_settings(Settings(database_path=database_path))

    with engine.connect() as connection, pytest.raises(IntegrityError):
        connection.execute(
            text(
                """
                INSERT INTO story_sessions (
                    id, story_id, state_version, current_scene, provider_id, model_id, created_at, updated_at
                ) VALUES ('orphan', 'missing-story', 1, 'Arrival', 'ollama', 'qwen3:14b-q4_K_M', 'now', 'now')
                """
            )
        )
