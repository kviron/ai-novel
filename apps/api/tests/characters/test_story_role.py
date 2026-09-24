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


def test_story_color_is_pinned_and_catalog_excludes_attached(client):
    story_id = client.get("/api/stories").json()[0]["id"]
    character = client.post(
        "/api/characters",
        json={
            "name": "Леон",
            "gender": "male",
            "age": 29,
            "personality": "Наблюдательный",
            "appearance": "Тёмные волосы",
        },
    ).json()
    character_id = character["id"]
    assert character_id in [item["id"] for item in client.get(f"/api/characters?exclude_story_id={story_id}").json()]
    added = client.post(f"/api/stories/{story_id}/characters/batch", json={"character_ids": [character_id]})
    assert added.status_code == 201
    assert character_id not in [
        item["id"] for item in client.get(f"/api/characters?exclude_story_id={story_id}").json()
    ]
    updated = client.put(
        f"/api/stories/{story_id}/characters/{character_id}",
        json={
            "revision_id": character["current_revision_id"],
            "role": "Союзник",
            "color": "#aabbcc",
        },
    )
    assert updated.status_code == 200
    assert updated.json()["color"] == "#AABBCC"
    invalid = client.put(
        f"/api/stories/{story_id}/characters/{character_id}",
        json={"revision_id": character["current_revision_id"], "color": "not-a-color"},
    )
    assert invalid.status_code == 422
    assert (
        next(
            item for item in client.get(f"/api/stories/{story_id}").json()["characters"] if item["id"] == character_id
        )["color"]
        == "#AABBCC"
    )
    game = client.post(f"/api/stories/{story_id}/sessions", json={"provider_id": "ollama"}).json()
    assert next(item for item in game["characters"] if item["id"] == character_id)["color"] == "#AABBCC"
    assert client.delete(f"/api/stories/{story_id}/characters/{character_id}").status_code == 204
    restored = client.get(f"/api/sessions/{game['id']}").json()
    assert next(item for item in restored["characters"] if item["id"] == character_id)["color"] == "#AABBCC"


def test_batch_attach_is_atomic_and_last_cast_member_cannot_be_removed(client):
    story_id = client.get("/api/stories").json()[0]["id"]
    before = len(client.get(f"/api/stories/{story_id}").json()["characters"])
    character = client.post(
        "/api/characters",
        json={
            "name": "Леон",
            "gender": "male",
            "age": 29,
            "personality": "Наблюдательный",
            "appearance": "Тёмные волосы",
        },
    ).json()
    response = client.post(
        f"/api/stories/{story_id}/characters/batch",
        json={
            "character_ids": [character["id"], "missing"],
        },
    )
    assert response.status_code == 404
    assert len(client.get(f"/api/stories/{story_id}").json()["characters"]) == before
    for member in client.get(f"/api/stories/{story_id}").json()["characters"][:-1]:
        assert client.delete(f"/api/stories/{story_id}/characters/{member['id']}").status_code == 204
    last = client.get(f"/api/stories/{story_id}").json()["characters"][0]
    assert client.delete(f"/api/stories/{story_id}/characters/{last['id']}").status_code == 409


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
