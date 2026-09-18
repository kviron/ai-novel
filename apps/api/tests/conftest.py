import os
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


def create_v01_database(database_path: Path, *, story_id: str, turn_id: str) -> None:
    """Create the pre-migration SQLite schema with one persisted story turn."""
    with sqlite3.connect(database_path) as db:
        db.executescript(
            """
            CREATE TABLE stories (
              id TEXT PRIMARY KEY, title TEXT NOT NULL, premise TEXT NOT NULL,
              theme_labels TEXT NOT NULL, state_version INTEGER NOT NULL,
              current_scene TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE TABLE characters (
              id TEXT PRIMARY KEY, story_id TEXT NOT NULL REFERENCES stories(id),
              name TEXT NOT NULL, age INTEGER NOT NULL CHECK(age >= 18),
              personality TEXT NOT NULL, appearance TEXT NOT NULL, visual_profile_version INTEGER NOT NULL
            );
            CREATE TABLE turns (
              id TEXT PRIMARY KEY, story_id TEXT NOT NULL REFERENCES stories(id),
              request_id TEXT NOT NULL, state_version INTEGER NOT NULL,
              action TEXT NOT NULL, speaker TEXT NOT NULL, dialogue TEXT NOT NULL,
              narration TEXT NOT NULL, choices TEXT NOT NULL, created_at TEXT NOT NULL,
              UNIQUE(story_id, request_id)
            );
            """
        )
        db.execute(
            "INSERT INTO stories VALUES (?, ?, ?, ?, ?, ?, ?)",
            (story_id, "Legacy story", "Legacy premise", "[]", 2, "Arrival", "2026-09-18T00:00:00+00:00"),
        )
        db.execute(
            "INSERT INTO turns VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                turn_id,
                story_id,
                "legacy-request",
                2,
                "Continue",
                "Narrator",
                "Legacy dialogue",
                "Legacy narration",
                "[]",
                "2026-09-18T00:00:00+00:00",
            ),
        )


@pytest.fixture()
def client(tmp_path):
    os.environ["DATABASE_PATH"] = str(tmp_path / "test.db")
    from app.config import get_settings
    from app.main import create_app

    get_settings.cache_clear()
    with TestClient(create_app()) as test_client:
        yield test_client
    get_settings.cache_clear()
