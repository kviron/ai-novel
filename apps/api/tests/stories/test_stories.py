import json
import sqlite3

from conftest import create_v01_database
from fakes import FakeLLMProvider
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import Settings
from app.db.models import (
    Character,
    CharacterRevision,
    Story,
    StoryCharacter,
    StorySession,
    StoryVersion,
    StoryVersionCharacter,
    Turn,
)
from app.main import create_app
from app.modules.providers.service import ProviderRegistry


def akane_story(client):
    stories = client.get("/api/stories").json()
    return next(item for item in stories if item["slug"] == "akane-neon-echo")


def session_count(client) -> int:
    with sqlite3.connect(client.app.state.settings.database_path) as database:
        return database.execute("SELECT COUNT(*) FROM story_sessions").fetchone()[0]


def save_draft_section(client, draft, section, data):
    response = client.put(
        f"/api/author/stories/{draft['story_id']}/draft/{section}",
        json={"expected_revision": draft["draft_revision"], "data": data},
    )
    assert response.status_code == 200, response.text
    return response.json()


def publish_story_version(client, draft):
    response = client.post(f"/api/author/stories/{draft['story_id']}/publish")
    assert response.status_code == 200, response.text
    return response.json()


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
    # The migrated v1 definition predates immutable StoryMaterial ownership.
    assert akane["cover_image_url"] is None

    created = client.post(
        f"/api/stories/{akane['id']}/sessions",
        json={"provider_id": "ollama", "model_id": "qwen3:14b-q4_K_M"},
    )
    assert created.status_code == 201
    game = created.json()
    assert game["state_version"] == 1
    assert game["characters"][0]["name"] == "Аканэ Куроха"
    assert game["latest_turn"] is None

    restored = client.get(f"/api/sessions/{game['id']}")
    assert restored.status_code == 200
    assert restored.json()["id"] == game["id"]
    with Session(client.app.state.engine) as session:
        saved = session.get(StorySession, game["id"])
        assert saved.story_version_id == f"{akane['id']}:v1"
        assert saved.draft_snapshot_id is None


def test_player_sessions_pin_published_identity_scene_and_cast(client):
    catalog = client.get("/api/characters").json()
    akane = next(item for item in catalog if item["id"] == "akane")
    mark = next(item for item in catalog if item["id"] == "mark")
    draft = client.post("/api/author/stories", json={}).json()
    draft = save_draft_section(
        client,
        draft,
        "identity",
        {
            "title": "Версия один",
            "slug": "runtime-pinning",
            "short_description": "Первая редакция",
            "premise": "Первая предпосылка",
            "setting": "Город",
            "opening_situation": "Первая сцена",
        },
    )
    draft = save_draft_section(
        client,
        draft,
        "cast",
        {
            "characters": [
                {
                    "id": "v1-akane",
                    "character_id": akane["id"],
                    "revision_id": akane["current_revision_id"],
                    "order_index": 0,
                    "role": "ally",
                    "color": "#AA0000",
                }
            ]
        },
    )
    version_one = publish_story_version(client, draft)
    old_game = client.post(f"/api/stories/{draft['story_id']}/sessions", json={})
    assert old_game.status_code == 201, old_game.text

    draft = client.post(f"/api/author/stories/{draft['story_id']}/draft-from/{version_one['version_id']}").json()
    draft = save_draft_section(
        client,
        draft,
        "identity",
        {
            "title": "Версия два",
            "slug": "runtime-pinning",
            "short_description": "Вторая редакция",
            "premise": "Вторая предпосылка",
            "setting": "Порт",
            "opening_situation": "Вторая сцена",
        },
    )
    draft = save_draft_section(
        client,
        draft,
        "cast",
        {
            "characters": [
                {
                    "id": "v2-mark",
                    "character_id": mark["id"],
                    "revision_id": mark["current_revision_id"],
                    "order_index": 0,
                    "role": "rival",
                    "color": "#00AA00",
                }
            ]
        },
    )
    version_two = publish_story_version(client, draft)
    new_game = client.post(f"/api/stories/{draft['story_id']}/sessions", json={})
    assert new_game.status_code == 201, new_game.text

    restored_old = client.get(f"/api/sessions/{old_game.json()['id']}").json()
    assert restored_old["story"]["current_published_version_id"] == version_one["version_id"]
    assert (restored_old["story"]["title"], restored_old["story"]["premise"]) == (
        "Версия один",
        "Первая предпосылка",
    )
    assert restored_old["current_scene"] == "Первая сцена"
    assert [(item["id"], item["role"], item["color"]) for item in restored_old["characters"]] == [
        ("akane", "ally", "#AA0000")
    ]
    assert new_game.json()["story"]["current_published_version_id"] == version_two["version_id"]
    assert (new_game.json()["story"]["title"], new_game.json()["story"]["premise"]) == (
        "Версия два",
        "Вторая предпосылка",
    )
    assert new_game.json()["current_scene"] == "Вторая сцена"
    assert [item["id"] for item in new_game.json()["characters"]] == ["mark"]


def test_unpublished_story_is_hidden_from_player_catalog_and_cannot_start(client):
    draft = client.post("/api/author/stories", json={"title": "Черновик"}).json()

    catalog = client.get("/api/stories").json()
    response = client.post(f"/api/stories/{draft['story_id']}/sessions", json={})

    assert draft["story_id"] not in {item["id"] for item in catalog}
    assert response.status_code == 422
    assert response.json()["code"] == "story_not_published"
    assert session_count(client) == 0


def test_player_catalog_uses_canonical_mode_and_exposes_published_version(client):
    story = akane_story(client)

    assert story["story_mode"] == "hybrid"
    assert story["current_published_version_id"] == f"{story['id']}:v1"


def test_seeded_story_contains_distinct_female_and_male_profiles(client):
    akane = akane_story(client)
    characters = client.get(f"/api/stories/{akane['id']}").json()["characters"]

    assert {item["id"]: item["gender"] for item in characters} == {
        "akane": "female",
        "mark": "male",
    }
    mark = next(item for item in characters if item["id"] == "mark")
    assert mark["name"] == "Марк Ветров"
    assert mark["age"] == 29
    assert "архив" in mark["personality"].lower()
    assert "серебрист" in mark["appearance"].lower()


def test_fresh_seed_creates_canonical_character_revisions_and_story_links(client):
    story = akane_story(client)
    with Session(client.app.state.engine) as session:
        record = session.get(Story, story["id"])
        version = session.get(StoryVersion, f"{story['id']}:v1")
        assert record.current_published_version_id == version.id
        assert (version.version_number, version.status, version.mode) == (1, "published", "hybrid")
        assert version.premise == record.premise
        assert version.opening_situation == record.current_scene
        version_cast = session.exec(
            select(StoryVersionCharacter).where(StoryVersionCharacter.version_id == version.id)
        ).all()
        assert [(item.character_id, item.order_index) for item in version_cast] == [("akane", 0), ("mark", 1)]
        for character_id in ("akane", "mark"):
            character = session.get(Character, character_id)
            link = session.get(StoryCharacter, (story["id"], character_id))
            revision = session.get(CharacterRevision, character.current_revision_id)
            assert revision is not None
            assert revision.character_id == character_id
            assert revision.revision_number == 1
            assert link.revision_id == revision.id
            assert next(item for item in version_cast if item.character_id == character_id).revision_id == revision.id


def test_existing_seed_story_restores_missing_mark_link_without_changing_published_pin(client):
    akane = akane_story(client)
    with Session(client.app.state.engine) as session:
        published_pin = session.exec(
            select(StoryVersionCharacter).where(
                StoryVersionCharacter.version_id == f"{akane['id']}:v1",
                StoryVersionCharacter.character_id == "mark",
            )
        ).one()
        published_pin_id = published_pin.id
        pinned_revision_id = published_pin.revision_id
        session.delete(session.get(StoryCharacter, (akane["id"], "mark")))
        session.commit()

    with TestClient(create_app(client.app.state.settings, client.app.state.providers)) as restarted:
        first = restarted.get(f"/api/stories/{akane['id']}").json()["characters"]
    with TestClient(create_app(client.app.state.settings, client.app.state.providers)) as restarted:
        second = restarted.get(f"/api/stories/{akane['id']}").json()["characters"]

    assert [item["id"] for item in first].count("mark") == 1
    assert [item["id"] for item in second].count("mark") == 1
    with Session(client.app.state.engine) as session:
        restored_link = session.get(StoryCharacter, (akane["id"], "mark"))
        assert restored_link.revision_id == pinned_revision_id
        assert session.get(StoryVersionCharacter, published_pin_id).revision_id == pinned_revision_id


def test_session_library_lists_only_requested_kind_with_lightweight_data(client):
    akane = akane_story(client)
    first = client.post(f"/api/stories/{akane['id']}/sessions", json={}).json()
    author = client.post(f"/api/stories/{akane['id']}/sessions", json={"kind": "author"}).json()
    second = client.post(f"/api/stories/{akane['id']}/sessions", json={}).json()

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

    first = client.post(f"/api/stories/{akane['id']}/sessions", json={}).json()
    second = client.post(f"/api/stories/{akane['id']}/sessions", json={}).json()
    client.post(f"/api/stories/{akane['id']}/sessions", json={"kind": "author"})

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
        story_count = database.execute("SELECT COUNT(*) FROM stories WHERE slug = ?", ("akane-neon-echo",)).fetchone()[
            0
        ]
        character_count = database.execute("SELECT COUNT(*) FROM characters WHERE id = ?", ("akane",)).fetchone()[0]
        version_count = database.execute(
            "SELECT COUNT(*) FROM story_versions WHERE story_id = ?", (akane["id"],)
        ).fetchone()[0]

    assert restarted["id"] == akane["id"]
    assert story_count == 1
    assert character_count == 1
    assert version_count == 1


def test_each_story_start_creates_an_independent_initial_session(client):
    akane = akane_story(client)

    first = client.post(f"/api/stories/{akane['id']}/sessions", json={})
    second = client.post(f"/api/stories/{akane['id']}/sessions", json={})

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] != second.json()["id"]
    assert first.json()["state_version"] == 1
    assert second.json()["state_version"] == 1


def test_new_session_falls_back_to_an_installed_ollama_model(client, fake_provider):
    fake_provider.models = ["gemma4-local:32k", "qwen38-local:32k"]
    akane = akane_story(client)

    response = client.post(f"/api/stories/{akane['id']}/sessions", json={})

    assert response.status_code == 201
    assert response.json()["model_id"] == "gemma4-local:32k"


def test_new_session_accepts_explicit_installed_model(client, fake_provider):
    fake_provider.models = ["gemma4-local:32k", "qwen38-local:32k"]
    akane = akane_story(client)

    response = client.post(f"/api/stories/{akane['id']}/sessions", json={"model_id": "qwen38-local:32k"})

    assert response.status_code == 201
    assert response.json()["model_id"] == "qwen38-local:32k"


def test_switch_model_in_same_session_preserves_progress_and_rejects_stale_revision(client, fake_provider):
    fake_provider.models = ["qwen3:14b-q4_K_M", "gemma4-local:32k"]
    akane = akane_story(client)
    game = client.post(f"/api/stories/{akane['id']}/sessions", json={}).json()

    changed = client.post(
        f"/api/sessions/{game['id']}/model",
        json={"model_id": "gemma4-local:32k", "expected_state_version": 1},
    )
    stale = client.post(
        f"/api/sessions/{game['id']}/model",
        json={"model_id": "qwen3:14b-q4_K_M", "expected_state_version": 1},
    )
    restored = client.get(f"/api/sessions/{game['id']}")

    assert changed.status_code == 200
    assert changed.json()["id"] == game["id"]
    assert changed.json()["model_id"] == "gemma4-local:32k"
    assert changed.json()["state_version"] == 2
    assert stale.status_code == 409
    assert restored.json()["model_id"] == "gemma4-local:32k"


def test_switch_rejects_uninstalled_model_without_mutation(client, fake_provider):
    fake_provider.models = ["qwen3:14b-q4_K_M"]
    akane = akane_story(client)
    game = client.post(f"/api/stories/{akane['id']}/sessions", json={}).json()

    response = client.post(
        f"/api/sessions/{game['id']}/model",
        json={"model_id": "missing:model", "expected_state_version": 1},
    )

    assert response.status_code == 422
    assert client.get(f"/api/sessions/{game['id']}").json()["state_version"] == 1


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
        f"/api/stories/{akane['id']}/sessions",
        json={"provider_id": "ollama", "model_id": "unsupported:model"},
    )

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert session_count(client) == before


def test_start_rejects_unsupported_provider_without_creating_a_session(client):
    akane = akane_story(client)
    before = session_count(client)

    response = client.post(
        f"/api/stories/{akane['id']}/sessions",
        json={"provider_id": "unsupported", "model_id": "qwen3:14b-q4_K_M"},
    )

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert session_count(client) == before


def test_start_rejects_a_hidden_player_character_without_creating_a_session(client):
    akane = akane_story(client)
    before = session_count(client)

    response = client.post(
        f"/api/stories/{akane['id']}/sessions",
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
    created = client.post(f"/api/stories/{akane['id']}/sessions", json={}).json()

    with TestClient(create_app(client.app.state.settings, client.app.state.providers)) as restarted_client:
        restored = restarted_client.get(f"/api/sessions/{created['id']}")

    assert restored.status_code == 200
    assert restored.json()["id"] == created["id"]


def test_restore_uses_visual_state_from_the_latest_committed_turn(client):
    akane = akane_story(client)
    game = client.post(f"/api/stories/{akane['id']}/sessions", json={}).json()
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

    restored = client.get(f"/api/sessions/{game['id']}")

    assert restored.status_code == 200
    assert restored.json()["visual_state"] == {
        "emotion": "fan",
        "pose": "fan_open",
        "outfit": "red_dress",
        "background": "neon_crossroads",
    }
    assert restored.json()["latest_turn"]["visual_directive"] == directive
    assert restored.json()["latest_turn"]["action"] == "Открыть веер"
    assert restored.json()["latest_turn"]["prompt_version"] == "v1"
