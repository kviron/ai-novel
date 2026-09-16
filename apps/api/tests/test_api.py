def story_payload(age=24):
    return {
        "title": "Эхо неона",
        "premise": "Курьер находит чужое воспоминание в дождливом мегаполисе.",
        "theme_labels": ["детектив", "для взрослых"],
        "characters": [
            {
                "name": "Мира",
                "age": age,
                "personality": "наблюдательная и осторожная",
                "appearance": "короткие серебристые волосы, янтарные глаза, тёмное пальто",
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
    assert story["characters"][0]["name"] == "Мира"

    jobs = client.get(f'/api/stories/{story["id"]}/jobs').json()
    sheet = next(job for job in jobs if job["kind"] == "character_sheet")
    sprites = [job for job in jobs if job["kind"] == "sprite"]
    assert len(sprites) == 5
    assert all(job["dependency_id"] == sheet["id"] for job in sprites)

    restored = client.get(f'/api/stories/{story["id"]}').json()
    assert restored["title"] == "Эхо неона"


def test_story_rejects_minor_characters(client):
    response = client.post("/api/stories", json=story_payload(age=17))
    assert response.status_code == 422
    assert response.json()["detail"] == "Возраст каждого персонажа должен быть не меньше 18 лет"


def test_turn_is_versioned_and_idempotent(client):
    story = client.post("/api/stories", json=story_payload()).json()
    request = {
        "request_id": "turn-1",
        "expected_state_version": 1,
        "action": "Пойти за синим сигналом",
    }
    first = client.post(f'/api/stories/{story["id"]}/turns', json=request)
    assert first.status_code == 201
    assert first.json()["state_version"] == 2
    assert first.json()["choices"]
    assert first.json()["choices"][0] == "Спросить, что будет дальше"
    assert "решение" in first.json()["narration"].lower()

    duplicate = client.post(f'/api/stories/{story["id"]}/turns', json=request)
    assert duplicate.status_code == 200
    assert duplicate.json()["id"] == first.json()["id"]

    conflict = client.post(
        f'/api/stories/{story["id"]}/turns',
        json={**request, "request_id": "turn-2"},
    )
    assert conflict.status_code == 409
