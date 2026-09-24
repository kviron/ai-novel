from sqlmodel import Session

from app.modules.story_engine.repository import load_context


def test_role_belongs_to_story_link_and_is_pinned_in_session(client):
    story_id = client.get("/api/stories").json()[0]["id"]
    profile = {
        "name": "Леон",
        "gender": "male",
        "age": 29,
        "personality": "Наблюдательный",
        "appearance": "Тёмные волосы",
    }
    character = client.post("/api/characters", json=profile).json()
    assert "role" not in character
    character_id = character["character_id"]
    revision_id = character["current_revision_id"]

    attached = client.post(
        f"/api/stories/{story_id}/characters",
        json={"character_id": character_id, "revision_id": revision_id, "role": "Союзник героини"},
    )
    assert attached.status_code == 201
    assert attached.json()["role"] == "Союзник героини"
    history = client.get(f"/api/characters/{character_id}").json()
    assert history["linked_stories"][0]["role"] == "Союзник героини"

    old_game = client.post(f"/api/stories/{story_id}/sessions", json={"provider_id": "ollama"}).json()
    with Session(client.app.state.engine) as session:
        old_context = load_context(session, old_game["id"], 1)
    assert next(item for item in old_context.characters if item["id"] == character_id)["role"] == "Союзник героини"

    updated = client.put(
        f"/api/stories/{story_id}/characters/{character_id}",
        json={"revision_id": revision_id, "role": "Соперник героини"},
    )
    assert updated.status_code == 200
    assert updated.json()["role"] == "Соперник героини"
    new_game = client.post(f"/api/stories/{story_id}/sessions", json={"provider_id": "ollama"}).json()
    with Session(client.app.state.engine) as session:
        old_context = load_context(session, old_game["id"], 1)
        new_context = load_context(session, new_game["id"], 1)
    assert next(item for item in old_context.characters if item["id"] == character_id)["role"] == "Союзник героини"
    assert next(item for item in new_context.characters if item["id"] == character_id)["role"] == "Соперник героини"


def test_global_profile_rejects_story_role(client):
    response = client.post(
        "/api/characters",
        json={
            "name": "Леон",
            "gender": "male",
            "age": 29,
            "personality": "Наблюдательный",
            "appearance": "Тёмные волосы",
            "role": "Союзник",
        },
    )
    assert response.status_code == 422


def test_generate_role_uses_story_and_revision_without_saving(client, fake_provider):
    story = client.get("/api/stories").json()[0]
    character = client.get("/api/characters/akane").json()
    fake_provider.text_responses = ["Связана с тайной дождливого города."]

    response = client.post(
        f"/api/stories/{story['id']}/characters/generate-role",
        json={
            "character_id": "akane",
            "revision_id": character["current_revision_id"],
            "existing_text": "Союзница героя",
        },
    )

    assert response.status_code == 200
    assert "Союзница героя" in response.json()["text"]
    assert story["title"] in fake_provider.last_text_request.user_prompt
    assert "Аканэ" in fake_provider.last_text_request.user_prompt
    assert "Союзница героя" in fake_provider.last_text_request.user_prompt
    assert client.get("/api/characters/akane").json()["linked_stories"][0]["role"] == "cast"
