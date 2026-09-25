import sqlite3
from pathlib import Path
from types import SimpleNamespace

import pytest
from fakes import FakeLLMProvider
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.modules.providers.service import ProviderRegistry


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


def create_v01_database_with_duplicate_turn_versions(database_path: Path) -> None:
    """Create valid v0.1 data whose two turns share the same state version."""
    create_v01_database(database_path, story_id="legacy-story", turn_id="legacy-turn")
    with sqlite3.connect(database_path) as db:
        db.execute(
            "INSERT INTO turns VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                "legacy-turn-2",
                "legacy-story",
                "legacy-request-2",
                2,
                "Investigate",
                "Akane",
                "Second legacy dialogue",
                "Second legacy narration",
                '["Wait"]',
                "2026-09-18T00:01:00+00:00",
            ),
        )


@pytest.fixture()
def fake_provider():
    return FakeLLMProvider(models=["qwen3:14b-q4_K_M"])


@pytest.fixture()
def client(tmp_path, fake_provider):
    from app.main import create_app

    app = create_app(
        Settings(
            _env_file=None,
            database_path=tmp_path / "test.db",
            asset_dir=tmp_path / "assets",
            provider_timeout_seconds=1,
        ),
        ProviderRegistry([fake_provider]),
    )
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def akane_session(client):
    story = next(item for item in client.get("/api/stories").json() if item["slug"] == "akane-neon-echo")
    result = client.post(f"/api/stories/{story['id']}/sessions", json={"provider_id": "ollama"})
    assert result.status_code == 201
    return SimpleNamespace(**result.json())
