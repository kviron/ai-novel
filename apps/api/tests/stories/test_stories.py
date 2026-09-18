import os
import sqlite3

from fastapi.testclient import TestClient


def akane_story(client):
    stories = client.get("/api/stories").json()
    return next(item for item in stories if item["slug"] == "akane-neon-echo")


def session_count() -> int:
    with sqlite3.connect(os.environ["DATABASE_PATH"]) as database:
        return database.execute("SELECT COUNT(*) FROM story_sessions").fetchone()[0]


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

    from app.main import create_app

    with TestClient(create_app()) as restarted_client:
        restarted = akane_story(restarted_client)

    with sqlite3.connect(os.environ["DATABASE_PATH"]) as database:
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
    before = session_count()

    response = client.post(
        "/api/stories/missing-story/sessions",
        json={"provider_id": "ollama", "model_id": "qwen3:14b-q4_K_M"},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "not_found"
    assert session_count() == before


def test_start_rejects_unsupported_model_without_creating_a_session(client):
    akane = akane_story(client)
    before = session_count()

    response = client.post(
        f'/api/stories/{akane["id"]}/sessions',
        json={"provider_id": "ollama", "model_id": "unsupported:model"},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "validation_error"
    assert session_count() == before


def test_start_rejects_a_hidden_player_character_without_creating_a_session(client):
    akane = akane_story(client)
    before = session_count()

    response = client.post(
        f'/api/stories/{akane["id"]}/sessions',
        json={"player_character": {"name": "Игрок"}},
    )

    assert response.status_code == 422
    assert session_count() == before


def test_restore_rejects_an_unknown_session(client):
    response = client.get("/api/sessions/missing-session")

    assert response.status_code == 404
    assert response.json()["detail"] == "not_found"


def test_session_restores_through_a_fresh_application_client(client):
    akane = akane_story(client)
    created = client.post(f'/api/stories/{akane["id"]}/sessions', json={}).json()

    from app.main import create_app

    with TestClient(create_app()) as restarted_client:
        restored = restarted_client.get(f'/api/sessions/{created["id"]}')

    assert restored.status_code == 200
    assert restored.json()["id"] == created["id"]
