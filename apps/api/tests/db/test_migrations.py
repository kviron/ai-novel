import sqlite3

import pytest
from conftest import create_v01_database, create_v01_database_with_duplicate_turn_versions
from sqlalchemy import text
from sqlalchemy.engine import Connection
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from app.core.config import Settings
from app.db.engine import create_engine_from_settings
from app.db.migrate import run_migrations
from app.db.models import Story, StorySession, Turn


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
        gender_column = {row[1] for row in db.execute("PRAGMA table_info(characters)")}
        turn = db.execute("SELECT id, session_id FROM turns WHERE id='legacy-turn'").fetchone()
        session = db.execute("SELECT story_id, state_version FROM story_sessions WHERE id=?", (turn[1],)).fetchone()
        speaker = db.execute("SELECT speaker FROM turns WHERE id='legacy-turn'").fetchone()

    assert story == ("legacy-story",)
    assert "gender" in gender_column
    assert session == ("legacy-story", 2)
    assert speaker == ("Narrator",)


def test_upgrade_pins_each_legacy_character_revision_to_story_and_session(tmp_path):
    database_path = tmp_path / "legacy-characters.db"
    create_v01_database(database_path, story_id="legacy-story", turn_id="legacy-turn")
    with sqlite3.connect(database_path) as database:
        database.execute(
            "INSERT INTO characters (id, story_id, name, age, personality, appearance, visual_profile_version) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            ("legacy-hero", "legacy-story", "Старый герой", 32, "Осторожный", "Серый плащ", 1),
        )

    run_migrations(database_path)
    run_migrations(database_path)

    with sqlite3.connect(database_path) as database:
        revision = database.execute(
            "SELECT id, character_id, revision_number, name, age FROM character_revisions"
        ).fetchall()
        story_link = database.execute(
            "SELECT story_id, character_id, revision_id FROM story_characters"
        ).fetchall()
        session_link = database.execute(
            "SELECT session_id, character_id, revision_id FROM session_characters"
        ).fetchall()
        active_revision = database.execute(
            "SELECT current_revision_id, source_type FROM characters WHERE id = 'legacy-hero'"
        ).fetchone()

    assert len(revision) == 1
    revision_id, character_id, number, name, age = revision[0]
    assert (character_id, number, name, age) == ("legacy-hero", 1, "Старый герой", 32)
    assert story_link == [("legacy-story", "legacy-hero", revision_id)]
    assert len(session_link) == 1
    assert session_link[0][1:] == ("legacy-hero", revision_id)
    assert active_revision == (revision_id, "legacy")


def test_upgrade_keeps_existing_save_and_backfills_library_metadata(tmp_path):
    database_path = tmp_path / "existing-save.db"
    create_v01_database(database_path, story_id="akane-neon-echo", turn_id="saved-turn")
    run_migrations(database_path)

    with sqlite3.connect(database_path) as db:
        story = db.execute(
            "SELECT description, cover_image_url FROM stories WHERE id='akane-neon-echo'"
        ).fetchone()
        saved = db.execute(
            "SELECT id, kind FROM story_sessions WHERE story_id='akane-neon-echo'"
        ).fetchone()
        turn = db.execute("SELECT id, session_id FROM turns WHERE id='saved-turn'").fetchone()

    assert story[0]
    assert story[1] == "/covers/akane-neon-echo.webp"
    assert saved[1] == "player"
    assert turn == ("saved-turn", saved[0])


def test_autosave_rewind_migration_preserves_and_links_existing_turns(tmp_path):
    database_path = tmp_path / "existing-history.db"
    create_v01_database_with_duplicate_turn_versions(database_path)
    run_migrations(database_path)

    with sqlite3.connect(database_path) as db:
        game = db.execute(
            "SELECT id, active_turn_id, rewind_count FROM story_sessions WHERE story_id='legacy-story'"
        ).fetchone()
        turns = db.execute(
            "SELECT id, parent_turn_id, scene_after FROM turns WHERE session_id=? ORDER BY state_version",
            (game[0],),
        ).fetchall()
        autosaves = db.execute("SELECT story_id, session_id FROM autosaves").fetchall()

    assert game == (game[0], "legacy-turn-2", 0)
    assert turns == [("legacy-turn", None, "Arrival"), ("legacy-turn-2", "legacy-turn", "Arrival")]
    assert autosaves == [("legacy-story", game[0])]


def test_upgrade_resequences_duplicate_legacy_turn_versions_without_data_loss(tmp_path):
    database_path = tmp_path / "duplicate-versions.db"
    create_v01_database_with_duplicate_turn_versions(database_path)
    run_migrations(database_path)

    with sqlite3.connect(database_path) as db:
        turns = db.execute(
            """
            SELECT id, request_id, state_version, legacy_state_version, action, speaker, dialogue, narration, choices,
                   created_at
            FROM turns
            ORDER BY state_version
            """
        ).fetchall()
        session = db.execute("SELECT state_version FROM story_sessions WHERE story_id='legacy-story'").fetchone()

    assert turns == [
        (
            "legacy-turn",
            "legacy-request",
            2,
            2,
            "Continue",
            "Narrator",
            "Legacy dialogue",
            "Legacy narration",
            "[]",
            "2026-09-18T00:00:00+00:00",
        ),
        (
            "legacy-turn-2",
            "legacy-request-2",
            3,
            2,
            "Investigate",
            "Akane",
            "Second legacy dialogue",
            "Second legacy narration",
            '["Wait"]',
            "2026-09-18T00:01:00+00:00",
        ),
    ]
    assert session == (3,)


def test_upgraded_legacy_database_accepts_a_story_model_insert(tmp_path):
    database_path = tmp_path / "legacy.db"
    create_v01_database(database_path, story_id="legacy-story", turn_id="legacy-turn")
    run_migrations(database_path)
    engine = create_engine_from_settings(Settings(database_path=database_path))

    with Session(engine) as session:
        session.add(
            Story(
                id="new-story",
                slug="new-story",
                title="New story",
                premise="New premise",
                current_scene="Arrival",
                created_at="2026-09-18T00:00:00+00:00",
            )
        )
        session.commit()

    with Session(engine) as session:
        assert session.get(Story, "new-story") is not None


def test_failed_legacy_upgrade_rolls_back_schema_and_can_retry(tmp_path, monkeypatch):
    database_path = tmp_path / "legacy.db"
    create_v01_database(database_path, story_id="legacy-story", turn_id="legacy-turn")
    original_execute = Connection.execute

    def fail_slug_update(connection, statement, *args, **kwargs):
        if "UPDATE stories SET slug = id" in str(statement):
            raise RuntimeError("injected migration failure")
        return original_execute(connection, statement, *args, **kwargs)

    monkeypatch.setattr(Connection, "execute", fail_slug_update)
    with pytest.raises(RuntimeError, match="injected migration failure"):
        run_migrations(database_path)
    monkeypatch.undo()

    with sqlite3.connect(database_path) as db:
        columns_after_failure = {row[1] for row in db.execute("PRAGMA table_info(stories)")}
    assert "slug" not in columns_after_failure

    run_migrations(database_path)
    with sqlite3.connect(database_path) as db:
        assert {"slug", "recommended_model_id"} <= {row[1] for row in db.execute("PRAGMA table_info(stories)")}


def test_turn_state_version_is_unique_within_a_session(tmp_path):
    database_path = tmp_path / "turn-order.db"
    run_migrations(database_path)
    engine = create_engine_from_settings(Settings(database_path=database_path))

    with Session(engine) as session:
        session.add(
            Story(
                id="story",
                slug="story",
                title="Story",
                premise="Premise",
                current_scene="Arrival",
                created_at="2026-09-18T00:00:00+00:00",
            )
        )
        session.add(
            StorySession(
                id="session",
                story_id="story",
                current_scene="Arrival",
                provider_id="ollama",
                model_id="qwen3:14b-q4_K_M",
                created_at="2026-09-18T00:00:00+00:00",
                updated_at="2026-09-18T00:00:00+00:00",
            )
        )
        session.commit()

        session.add_all(
            [
                Turn(
                    id="turn-1",
                    session_id="session",
                    request_id="request-1",
                    state_version=2,
                    action="Continue",
                    speaker="Narrator",
                    narration="Narration",
                    dialogue="Dialogue",
                    choices="[]",
                    visual_directive="{}",
                    raw_response="{}",
                    provider_id="ollama",
                    model_id="qwen3:14b-q4_K_M",
                    prompt_version="v1",
                    created_at="2026-09-18T00:00:00+00:00",
                ),
                Turn(
                    id="turn-2",
                    session_id="session",
                    request_id="request-2",
                    state_version=2,
                    action="Continue",
                    speaker="Narrator",
                    narration="Narration",
                    dialogue="Dialogue",
                    choices="[]",
                    visual_directive="{}",
                    raw_response="{}",
                    provider_id="ollama",
                    model_id="qwen3:14b-q4_K_M",
                    prompt_version="v1",
                    created_at="2026-09-18T00:00:00+00:00",
                ),
            ]
        )
        with pytest.raises(IntegrityError, match="UNIQUE constraint failed: turns.session_id, turns.state_version"):
            session.commit()


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
