import json
import sqlite3

from conftest import create_v01_database
from fakes import FakeLLMProvider
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import Settings
from app.db.models import StorySession, Turn
from app.main import create_app
from app.modules.providers.service import ProviderRegistry


def akane_story(client):
    stories = client.get("/api/stories").json()
    return next(item for item in stories if item["slug"] == "akane-neon-echo")


def session_count(client) -> int:
    with sqlite3.connect(client.app.state.settings.database_path) as database:
        return database.execute("SELECT COUNT(*) FROM story_sessions").fetchone()[0]


def test_replaying_migrated_legacy_request_returns_its_original_turn(tmp_path):
    database_path = tmp_path / "legacy-replay.db"
    create_v01_database(database_path, story_id="legacy-story", turn_id="legacy-turn")
    provider = FakeLLMProvider(provider_id="legacy")
    app = create_app(Settings(database_path=database_path), ProviderRegistry([provider]))

    with TestClient(app) as client:
        with Session(client.app.state.engine) as session:
            game = session.exec(select(StorySession).where(StorySession.story_id == "legacy-story")).one()
        response = client.post(
            f"/api/sessions/{game.id}/turns",
            json={"request_id": "legacy-request", "expected_state_version": 1, "action": "Continue"},
        )

    with sqlite3.connect(database_path) as database:
        turn_rows = database.execute("SELECT id, request_id, state_version FROM turns").fetchall()
        session_rows = database.execute(
            "SELECT state_version FROM story_sessions WHERE story_id = ?", ("legacy-story",)
        ).fetchall()

    assert response.status_code == 200
    assert response.json()["id"] == "legacy-turn"
    assert provider.call_count == 0
    assert turn_rows == [("legacy-turn", "legacy-request", 2)]
    assert session_rows == [(2,)]


def test_seeded_akane_story_can_start_and_restore(client):
    akane = akane_story(client)
    assert akane["recommended_model_id"] == "qwen3:14b-q4_K_M"

    created = client.post(
        f'/api/stories/{akane["id"]}/sessions',
        json={"provider_id": "ollama", "model_id": "qwen3:14b-q4_K_M"},
    )
    assert created.status_code == 201
    game = created.json()
    assert game["state_version"] == 1
    assert game["characters"][0]["name"] == "Аканэ Куроха"
    assert game["latest_turn"] is None

    restored = client.get(f'/api/sessions/{game["id"]}')
    assert restored.status_code == 200
    assert restored.json()["id"] == game["id"]


def test_seed_is_idempotent_across_lifespan_startups(client):
    akane = akane_story(client)

    with TestClient(create_app(client.app.state.settings, client.app.state.providers)) as restarted_client:
        restarted = akane_story(restarted_client)

    with sqlite3.connect(client.app.state.settings.database_path) as database:
        story_count = database.execute(
            "SELECT COUNT(*) FROM stories WHERE slug = ?", ("akane-neon-echo",)
        ).fetchone()[0]
        character_count = database.execute("SELECT COUNT(*) FROM characters WHERE id = ?", ("akane",)).fetchone()[0]

    assert restarted["id"] == akane["id"]
    assert story_count == 1
    assert character_count == 1


def test_each_story_start_creates_an_independent_initial_session(client):
    akane = akane_story(client)

    first = client.post(f'/api/stories/{akane["id"]}/sessions', json={})
    second = client.post(f'/api/stories/{akane["id"]}/sessions', json={})

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] != second.json()["id"]
    assert first.json()["state_version"] == 1
    assert second.json()["state_version"] == 1


def test_start_rejects_unknown_story_without_creating_a_session(client):
    before = session_count(client)

    response = client.post(
        "/api/stories/missing-story/sessions",
        json={"provider_id": "ollama", "model_id": "qwen3:14b-q4_K_M"},
    )

    assert response.status_code == 404
    assert response.json()["code"] == "not_found"
    assert session_count(client) == before


def test_start_rejects_unsupported_model_without_creating_a_session(client):
    akane = akane_story(client)
    before = session_count(client)

    response = client.post(
        f'/api/stories/{akane["id"]}/sessions',
        json={"provider_id": "ollama", "model_id": "unsupported:model"},
    )

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert session_count(client) == before


def test_start_rejects_unsupported_provider_without_creating_a_session(client):
    akane = akane_story(client)
    before = session_count(client)

    response = client.post(
        f'/api/stories/{akane["id"]}/sessions',
        json={"provider_id": "unsupported", "model_id": "qwen3:14b-q4_K_M"},
    )

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert session_count(client) == before


def test_start_rejects_a_hidden_player_character_without_creating_a_session(client):
    akane = akane_story(client)
    before = session_count(client)

    response = client.post(
        f'/api/stories/{akane["id"]}/sessions',
        json={"player_character": {"name": "Игрок"}},
    )

    assert response.status_code == 422
    assert session_count(client) == before


def test_restore_rejects_an_unknown_session(client):
    response = client.get("/api/sessions/missing-session")

    assert response.status_code == 404
    assert response.json()["code"] == "not_found"


def test_session_restores_through_a_fresh_application_client(client):
    akane = akane_story(client)
    created = client.post(f'/api/stories/{akane["id"]}/sessions', json={}).json()

    with TestClient(create_app(client.app.state.settings, client.app.state.providers)) as restarted_client:
        restored = restarted_client.get(f'/api/sessions/{created["id"]}')

    assert restored.status_code == 200
    assert restored.json()["id"] == created["id"]


def test_restore_uses_visual_state_from_the_latest_committed_turn(client):
    akane = akane_story(client)
    game = client.post(f'/api/stories/{akane["id"]}/sessions', json={}).json()
    directive = {"mode": "sprite_scene", "emotion": "fan", "pose": "fan_open", "outfit": "red_dress"}

    with Session(client.app.state.engine) as session:
        story_session = session.get(StorySession, game["id"])
        story_session.state_version = 2
        session.add(
            Turn(
                id="fan-turn",
                session_id=game["id"],
                request_id="fan-request",
                state_version=2,
                action="Открыть веер",
                speaker="Аканэ Куроха",
                narration="Аканэ раскрывает веер.",
                dialogue="Веер умеет хранить тайны.",
                choices="[]",
                visual_directive=json.dumps(directive),
                raw_response="{}",
                provider_id="ollama",
                model_id="qwen3:14b-q4_K_M",
                prompt_version="v1",
            )
        )
        session.commit()

    restored = client.get(f'/api/sessions/{game["id"]}')

    assert restored.status_code == 200
    assert restored.json()["visual_state"] == {"emotion": "fan", "pose": "fan_open", "outfit": "red_dress"}
    assert restored.json()["latest_turn"]["visual_directive"] == directive
