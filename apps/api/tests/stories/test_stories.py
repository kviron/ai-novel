import json
import os
import sqlite3

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.db.models import Story, StorySession, Turn


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


def test_created_story_is_listed_and_can_start_a_session(client):
    created = client.post(
        "/api/stories",
        json={
            "title": "Проверка единого хранилища",
            "premise": "История, созданная через прежний маршрут, остаётся доступной игровому API.",
            "theme_labels": ["проверка"],
            "characters": [
                {
                    "name": "Мира",
                    "age": 24,
                    "personality": "наблюдательная",
                    "appearance": "серебристые волосы",
                }
            ],
        },
    )
    assert created.status_code == 201
    story_id = created.json()["id"]

    listed = client.get("/api/stories")
    detail = client.get(f"/api/stories/{story_id}")
    started = client.post(f"/api/stories/{story_id}/sessions", json={})

    listed_story = next(story for story in listed.json() if story["id"] == story_id)
    assert detail.status_code == 200
    for field in (
        "id",
        "slug",
        "title",
        "premise",
        "story_mode",
        "recommended_provider_id",
        "recommended_model_id",
    ):
        assert detail.json()[field] == listed_story[field]
    assert started.status_code == 201
    assert started.json()["story"]["id"] == story_id


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


def test_start_rejects_unsupported_provider_without_creating_a_session(client):
    akane = akane_story(client)
    before = session_count()

    response = client.post(
        f'/api/stories/{akane["id"]}/sessions',
        json={"provider_id": "unsupported", "model_id": "qwen3:14b-q4_K_M"},
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


def test_compatibility_turns_do_not_mutate_playable_sessions_or_built_in_story(client):
    akane = akane_story(client)
    first_session = client.post(f'/api/stories/{akane["id"]}/sessions', json={}).json()

    first_turn = client.post(
        f'/api/stories/{akane["id"]}/turns',
        json={"request_id": "legacy-turn-1", "expected_state_version": 1, "action": "Осмотреть улицу"},
    )
    second_session = client.post(f'/api/stories/{akane["id"]}/sessions', json={}).json()
    second_turn = client.post(
        f'/api/stories/{akane["id"]}/turns',
        json={"request_id": "legacy-turn-2", "expected_state_version": 2, "action": "Зажечь неон"},
    )

    first_restored = client.get(f'/api/sessions/{first_session["id"]}').json()
    second_restored = client.get(f'/api/sessions/{second_session["id"]}').json()
    with Session(client.app.state.engine) as session:
        story = session.get(Story, akane["id"])

    assert first_turn.status_code == 201
    assert second_turn.status_code == 201
    assert first_restored["state_version"] == 1
    assert second_restored["state_version"] == 1
    assert story.state_version == 1
