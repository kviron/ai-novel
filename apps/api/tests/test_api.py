def story_payload(age=24):
    return {
        "title": "Echoes of Neon",
        "premise": "A courier discovers a memory hidden in a rainy megacity.",
        "theme_labels": ["mystery", "mature"],
        "characters": [
            {
                "name": "Mira",
                "age": age,
                "personality": "observant and guarded",
                "appearance": "short silver hair, amber eyes, dark coat",
            }
        ],
    }


def test_health_and_provider_status_are_independent(client):
    assert client.get("/health").json()["status"] == "ok"
    providers = client.get("/health/providers").json()
    assert set(providers) == {"ollama", "comfyui"}
    assert all("available" in value for value in providers.values())


def test_story_creation_persists_characters_and_sprite_dependencies(client):
    response = client.post("/api/stories", json=story_payload())
    assert response.status_code == 201
    story = response.json()
    assert story["state_version"] == 1
    assert story["characters"][0]["name"] == "Mira"

    jobs = client.get(f'/api/stories/{story["id"]}/jobs').json()
    sheet = next(job for job in jobs if job["kind"] == "character_sheet")
    sprites = [job for job in jobs if job["kind"] == "sprite"]
    assert len(sprites) == 5
    assert all(job["dependency_id"] == sheet["id"] for job in sprites)

    restored = client.get(f'/api/stories/{story["id"]}').json()
    assert restored["title"] == "Echoes of Neon"


def test_story_rejects_minor_characters(client):
    response = client.post("/api/stories", json=story_payload(age=17))
    assert response.status_code == 422


def test_turn_is_versioned_and_idempotent(client):
    story = client.post("/api/stories", json=story_payload()).json()
    request = {
        "request_id": "turn-1",
        "expected_state_version": 1,
        "action": "Follow the blue signal",
    }
    first = client.post(f'/api/stories/{story["id"]}/turns', json=request)
    assert first.status_code == 201
    assert first.json()["state_version"] == 2
    assert first.json()["choices"]

    duplicate = client.post(f'/api/stories/{story["id"]}/turns', json=request)
    assert duplicate.status_code == 200
    assert duplicate.json()["id"] == first.json()["id"]

    conflict = client.post(
        f'/api/stories/{story["id"]}/turns',
        json={**request, "request_id": "turn-2"},
    )
    assert conflict.status_code == 409
