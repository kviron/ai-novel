import json

from sqlmodel import Session, select

from app.db.models import Character, Story, StorySession


def story_id(client):
    return client.get("/api/stories").json()[0]["id"]


def test_story_setup_lists_allowed_hero_sources(client):
    response = client.get(f"/api/stories/{story_id(client)}/setup")

    assert response.status_code == 200
    assert response.json()["policy"] == "choice"
    assert response.json()["allowed_sources"] == ["catalog", "draft"]


def test_draft_hero_is_saved_only_in_playthrough(client):
    story = story_id(client)
    before = len(client.get("/api/characters").json())

    response = client.post(
        f"/api/stories/{story}/sessions",
        json={
            "provider_id": "ollama",
            "hero": {
                "source_kind": "draft",
                "name": "Мира",
                "address": "Мира",
                "gender": "female",
                "appearance": "Синий плащ",
                "biography": "Ищет сестру",
            },
        },
    )

    assert response.status_code == 201, response.text
    game = response.json()
    assert game["protagonist"]["name"] == "Мира"
    assert game["protagonist"]["source_kind"] == "draft"
    assert client.get(f"/api/sessions/{game['id']}").json()["protagonist"]["biography"] == "Ищет сестру"
    assert len(client.get("/api/characters").json()) == before


def test_catalog_hero_pins_revision_and_stays_out_of_ai_cast(client):
    story = story_id(client)
    character = client.post(
        "/api/characters",
        json={
            "name": "Артём",
            "gender": "male",
            "age": 24,
            "personality": "Спокоен",
            "appearance": "Серый шарф",
        },
    ).json()
    response = client.post(
        f"/api/stories/{story}/sessions",
        json={
            "provider_id": "ollama",
            "hero": {
                "source_kind": "catalog",
                "character_id": character["id"],
                "revision_id": character["current_revision_id"],
            },
        },
    )

    assert response.status_code == 201, response.text
    game = response.json()
    assert game["protagonist"]["name"] == "Артём"
    assert game["protagonist"]["source_revision_id"] == character["current_revision_id"]
    assert character["id"] not in {item["id"] for item in game["characters"]}

    client.post(
        f"/api/characters/{character['id']}/revisions",
        json={
            "name": "Артём Другой",
            "gender": "male",
            "age": 24,
            "personality": "Спокоен",
            "appearance": "Чёрный шарф",
        },
    )
    assert client.get(f"/api/sessions/{game['id']}").json()["protagonist"]["appearance"] == "Серый шарф"


def test_unplayable_cast_member_is_rejected_without_creating_session(client):
    story = story_id(client)
    detail = client.get(f"/api/stories/{story}").json()
    akane = next(item for item in detail["characters"] if item["id"] == "akane")
    with Session(client.app.state.engine) as session:
        before = len(session.exec(select(StorySession)).all())
        character = session.get(Character, akane["id"])
        revision_id = character.current_revision_id

    response = client.post(
        f"/api/stories/{story}/sessions",
        json={
            "provider_id": "ollama",
            "hero": {"source_kind": "catalog", "character_id": "akane", "revision_id": revision_id},
        },
    )

    assert response.status_code == 422
    with Session(client.app.state.engine) as session:
        assert len(session.exec(select(StorySession)).all()) == before


def test_author_fixed_hero_excludes_playable_cast_member(client):
    story = story_id(client)
    with Session(client.app.state.engine) as session:
        row = session.get(Story, story)
        akane = session.get(Character, "akane")
        row.hero_policy = "fixed"
        row.fixed_hero_revision_id = akane.current_revision_id
        row.playable_character_ids = json.dumps(["akane"])
        session.commit()

    response = client.post(
        f"/api/stories/{story}/sessions",
        json={"provider_id": "ollama", "hero": {"source_kind": "fixed"}},
    )

    assert response.status_code == 201, response.text
    assert response.json()["protagonist"]["name"] == "Аканэ Куроха"
    assert "akane" not in {item["id"] for item in response.json()["characters"]}


def test_policy_rejects_disallowed_hero_source(client):
    story = story_id(client)
    with Session(client.app.state.engine) as session:
        row = session.get(Story, story)
        row.hero_allowed_sources = '["catalog"]'
        session.commit()

    response = client.post(
        f"/api/stories/{story}/sessions",
        json={"provider_id": "ollama", "hero": {"source_kind": "draft", "name": "Мира"}},
    )

    assert response.status_code == 422


def test_draft_hero_can_be_saved_to_catalog_once_without_changing_playthrough(client):
    game = client.post(
        f"/api/stories/{story_id(client)}/sessions",
        json={"provider_id": "ollama", "hero": {"source_kind": "draft", "name": "Мира", "biography": "Ищет сестру"}},
    ).json()
    before = len(client.get("/api/characters").json())
    url = f"/api/sessions/{game['id']}/protagonist/save-to-catalog"

    missing = client.post(url, json={})
    assert missing.status_code == 422
    assert len(client.get("/api/characters").json()) == before

    completion = {"age": 26, "personality": "Настойчивая", "appearance": "Синий плащ"}
    saved = client.post(url, json=completion)
    again = client.post(url, json=completion)

    assert saved.status_code == 201, saved.text
    assert again.status_code == 201, again.text
    assert saved.json()["id"] == again.json()["id"]
    assert saved.json()["biography"] == "Ищет сестру"
    assert len(client.get("/api/characters").json()) == before + 1
    assert client.get(f"/api/sessions/{game['id']}").json()["protagonist"]["source_kind"] == "draft"
