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
    assert "Аканэ" in akane["description"]
    assert akane["cover_image_url"] == "/covers/akane-neon-echo.webp"

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


def test_session_library_lists_only_requested_kind_with_lightweight_data(client):
    akane = akane_story(client)
    first = client.post(f'/api/stories/{akane["id"]}/sessions', json={}).json()
    author = client.post(f'/api/stories/{akane["id"]}/sessions', json={"kind": "author"}).json()
    second = client.post(f'/api/stories/{akane["id"]}/sessions', json={}).json()

    player_saves = client.get("/api/sessions?kind=player")
    author_saves = client.get("/api/sessions?kind=author")

    assert player_saves.status_code == 200
    assert [save["id"] for save in player_saves.json()] == [second["id"], first["id"]]
    assert [save["id"] for save in author_saves.json()] == [author["id"]]
    save = player_saves.json()[0]
    assert save["story"]["id"] == akane["id"]
    assert save["current_scene"] == "Ночной перекрёсток"
    assert save["state_version"] == 1
    assert save["created_at"]
    assert save["updated_at"]
    assert "latest_turn" not in save
    assert "raw_response" not in str(save)

    with Session(client.app.state.engine) as session:
        earlier = session.get(StorySession, first["id"])
        earlier.updated_at = "2099-01-01T00:00:00+00:00"
        session.commit()

    refreshed = client.get("/api/sessions?kind=player")
    assert [save["id"] for save in refreshed.json()] == [first["id"], second["id"]]


def test_autosave_points_to_one_player_session_per_story(client):
    akane = akane_story(client)
    assert client.get("/api/autosaves").json() == []

    first = client.post(f'/api/stories/{akane["id"]}/sessions', json={}).json()
    second = client.post(f'/api/stories/{akane["id"]}/sessions', json={}).json()
    client.post(f'/api/stories/{akane["id"]}/sessions', json={"kind": "author"})

    with Session(client.app.state.engine) as session:
        old_game = session.get(StorySession, first["id"])
        old_game.updated_at = "2099-01-01T00:00:00+00:00"
        session.commit()

    response = client.get("/api/autosaves")
    assert response.status_code == 200
    assert [save["id"] for save in response.json()] == [second["id"]]
    assert response.json()[0]["story"]["id"] == akane["id"]


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


def test_new_session_falls_back_to_an_installed_ollama_model(client, fake_provider):
    fake_provider.models = ["gemma4-local:32k", "qwen38-local:32k"]
    akane = akane_story(client)

    response = client.post(f'/api/stories/{akane["id"]}/sessions', json={})

    assert response.status_code == 201
    assert response.json()["model_id"] == "gemma4-local:32k"


def test_new_session_accepts_explicit_installed_model(client, fake_provider):
    fake_provider.models = ["gemma4-local:32k", "qwen38-local:32k"]
    akane = akane_story(client)

    response = client.post(
        f'/api/stories/{akane["id"]}/sessions', json={"model_id": "qwen38-local:32k"}
    )

    assert response.status_code == 201
    assert response.json()["model_id"] == "qwen38-local:32k"


def test_switch_model_in_same_session_preserves_progress_and_rejects_stale_revision(client, fake_provider):
    fake_provider.models = ["qwen3:14b-q4_K_M", "gemma4-local:32k"]
    akane = akane_story(client)
    game = client.post(f'/api/stories/{akane["id"]}/sessions', json={}).json()

    changed = client.post(
        f'/api/sessions/{game["id"]}/model',
        json={"model_id": "gemma4-local:32k", "expected_state_version": 1},
    )
    stale = client.post(
        f'/api/sessions/{game["id"]}/model',
        json={"model_id": "qwen3:14b-q4_K_M", "expected_state_version": 1},
    )
    restored = client.get(f'/api/sessions/{game["id"]}')

    assert changed.status_code == 200
    assert changed.json()["id"] == game["id"]
    assert changed.json()["model_id"] == "gemma4-local:32k"
    assert changed.json()["state_version"] == 2
    assert stale.status_code == 409
    assert restored.json()["model_id"] == "gemma4-local:32k"


def test_switch_rejects_uninstalled_model_without_mutation(client, fake_provider):
    fake_provider.models = ["qwen3:14b-q4_K_M"]
    akane = akane_story(client)
    game = client.post(f'/api/stories/{akane["id"]}/sessions', json={}).json()

    response = client.post(
        f'/api/sessions/{game["id"]}/model',
        json={"model_id": "missing:model", "expected_state_version": 1},
    )

    assert response.status_code == 422
    assert client.get(f'/api/sessions/{game["id"]}').json()["state_version"] == 1


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
        story_session.active_turn_id = "fan-turn"
        session.add(
            Turn(
                id="fan-turn",
                session_id=game["id"],
                scene_after=story_session.current_scene,
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
    assert restored.json()["latest_turn"]["action"] == "Открыть веер"
    assert restored.json()["latest_turn"]["prompt_version"] == "v1"
