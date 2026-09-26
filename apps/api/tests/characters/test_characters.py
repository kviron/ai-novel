from sqlmodel import Session
from versioned_story_helpers import publish_cast

from app.db.models import CharacterRevision, Story, StoryCharacter


def test_global_catalog_exposes_seeded_profiles(client):
    response = client.get("/api/characters")
    assert response.status_code == 200
    assert {item["id"] for item in response.json()} == {"akane", "mark"}
    assert all(item["revision_number"] == 1 for item in response.json())


def test_create_and_revise_do_not_move_story_pin(client):
    story_id = client.get("/api/stories").json()[0]["id"]
    payload = {
        "name": "Илья",
        "gender": "male",
        "age": 25,
        "personality": "Спокойный исследователь",
        "appearance": "Тёмные волосы",
        "biography": "Живёт в городе",
        "speech": "Короткие фразы",
    }
    created = client.post("/api/characters", json=payload)
    assert created.status_code == 201
    character = created.json()
    assert character["revision_number"] == 1

    attached = client.post(
        f"/api/stories/{story_id}/characters",
        json={
            "character_id": character["id"],
            "revision_id": character["current_revision_id"],
            "role": "cast",
        },
    )
    assert (attached.status_code, attached.json()["code"]) == (409, "story_versioned")
    revised = client.post(
        f"/api/characters/{character['id']}/revisions", json={**payload, "name": "Илья после событий"}
    )
    assert revised.status_code == 201
    assert revised.json()["revision_number"] == 2
    detail = client.get(f"/api/characters/{character['id']}").json()
    assert [item["revision_number"] for item in detail["revisions"]] == [1, 2]
    assert detail["linked_stories"] == []
    with Session(client.app.state.engine) as session:
        assert session.get(StoryCharacter, (story_id, character["id"])) is None


def test_catalog_rejects_underage_profile_and_unrelated_revision(client):
    payload = {"name": "Тест", "gender": "other", "age": 17, "personality": "А", "appearance": "Б"}
    assert client.post("/api/characters", json=payload).status_code == 422
    story_id = client.get("/api/stories").json()[0]["id"]
    with Session(client.app.state.engine) as session:
        mark_revision = session.get(CharacterRevision, session.get(StoryCharacter, (story_id, "mark")).revision_id)
    response = client.post(
        f"/api/stories/{story_id}/characters",
        json={
            "character_id": "akane",
            "revision_id": mark_revision.id,
            "role": "cast",
        },
    )
    assert response.status_code in {409, 422}


def test_story_and_session_read_their_pinned_revisions(client):
    story_id = client.get("/api/stories").json()[0]["id"]
    payload = {"name": "Мира", "gender": "female", "age": 27, "personality": "Тихая", "appearance": "Плащ"}
    created = client.post("/api/characters", json=payload).json()
    character_id = created["id"]
    first_revision = created["current_revision_id"]
    publish_cast(
        client,
        story_id,
        add=[{"character_id": character_id, "revision_id": first_revision}],
    )
    old_game = client.post(f"/api/stories/{story_id}/sessions", json={"provider_id": "ollama"}).json()
    assert next(item for item in old_game["characters"] if item["id"] == character_id)["name"] == "Мира"

    revised = client.post(f"/api/characters/{character_id}/revisions", json={**payload, "name": "Мира новая"}).json()
    publish_cast(
        client,
        story_id,
        update={character_id: {"revision_id": revised["current_revision_id"]}},
    )
    story = client.get(f"/api/stories/{story_id}").json()
    assert next(item for item in story["characters"] if item["id"] == character_id)["name"] == "Мира новая"
    restored = client.get(f"/api/sessions/{old_game['id']}").json()
    assert next(item for item in restored["characters"] if item["id"] == character_id)["name"] == "Мира"
    new_game = client.post(f"/api/stories/{story_id}/sessions", json={"provider_id": "ollama"}).json()
    assert next(item for item in new_game["characters"] if item["id"] == character_id)["name"] == "Мира новая"


def test_one_character_revision_can_be_used_in_two_stories(client):
    first_story_id = client.get("/api/stories").json()[0]["id"]
    with Session(client.app.state.engine) as session:
        second_story = Story(slug="second-story", title="Другая новелла", premise="Второй мир", current_scene="Начало")
        session.add(second_story)
        session.commit()
        second_story_id = second_story.id
    created = client.post(
        "/api/characters",
        json={
            "name": "Мира",
            "gender": "female",
            "age": 27,
            "personality": "Внимательная",
            "appearance": "Синий плащ",
        },
    ).json()
    publish_cast(
        client,
        first_story_id,
        add=[{"character_id": created["id"], "revision_id": created["current_revision_id"]}],
    )
    attached = client.post(
        f"/api/stories/{second_story_id}/characters",
        json={"character_id": created["id"], "revision_id": created["current_revision_id"]},
    )
    assert attached.status_code == 201
    first_story = client.get(f"/api/stories/{first_story_id}").json()
    assert next(item for item in first_story["characters"] if item["id"] == created["id"])["name"] == "Мира"
    history = client.get(f"/api/characters/{created['id']}").json()
    assert {item["story_id"] for item in history["linked_stories"]} == {second_story_id}
