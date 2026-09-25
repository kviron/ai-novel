from io import BytesIO
from zipfile import ZipFile

from sqlmodel import Session

from app.db.models import Story, StoryCharacter

PNG = b"\x89PNG\r\n\x1a\n" + b"test-avatar-bytes"
PROFILE = {"name": "Мира", "gender": "female", "age": 26, "personality": "Смелая", "appearance": "Синий плащ"}


def test_avatar_creates_revision_without_moving_story_or_session_pin(client):
    story_id = client.get("/api/stories").json()[0]["id"]
    original = client.post("/api/characters", json=PROFILE).json()
    character_id = original["id"]
    assert (
        client.post(
            f"/api/stories/{story_id}/characters",
            json={"character_id": character_id, "revision_id": original["current_revision_id"]},
        ).status_code
        == 201
    )
    old_game = client.post(f"/api/stories/{story_id}/sessions", json={"provider_id": "ollama"}).json()

    uploaded = client.post(
        f"/api/characters/{character_id}/avatar?filename=mira.png&creator=Author&license=CC-BY-4.0&source=manual",
        content=PNG,
        headers={"Content-Type": "image/png"},
    )
    assert uploaded.status_code == 201, uploaded.text
    assert uploaded.json()["revision_number"] == 2
    assert uploaded.json()["avatar"]["creator"] == "Author"
    assert uploaded.json()["avatar"]["license"] == "CC-BY-4.0"
    assert client.get(uploaded.json()["avatar"]["url"]).content == PNG
    detail = client.get(f"/api/characters/{character_id}").json()
    assert detail["revisions"][0]["avatar"] is None
    assert detail["revisions"][1]["avatar"]["sha256"]
    with Session(client.app.state.engine) as session:
        assert session.get(StoryCharacter, (story_id, character_id)).revision_id == original["current_revision_id"]
    assert (
        next(
            item
            for item in client.get(f"/api/sessions/{old_game['id']}").json()["characters"]
            if item["id"] == character_id
        )["name"]
        == "Мира"
    )


def test_export_repeat_import_preserves_revisions_materials_and_origin(client):
    original = client.post("/api/characters", json=PROFILE).json()
    character_id = original["id"]
    upload = client.post(
        f"/api/characters/{character_id}/avatar?filename=mira.png&creator=Author&license=CC-BY-4.0&source=manual",
        content=PNG,
        headers={"Content-Type": "image/png"},
    )
    assert upload.status_code == 201
    archive = client.get(f"/api/characters/{character_id}/export")
    assert archive.status_code == 200
    with ZipFile(BytesIO(archive.content)) as package:
        assert "manifest.json" in package.namelist()
        assert len(package.namelist()) == 2
    imported_ids = []
    for _ in range(2):
        imported = client.post(
            "/api/characters/import", content=archive.content, headers={"Content-Type": "application/zip"}
        )
        assert imported.status_code == 201, imported.text
        imported_ids.append(imported.json()["id"])
        assert imported.json()["avatar"]["license"] == "CC-BY-4.0"
        assert client.get(imported.json()["avatar"]["url"]).content == PNG
        detail = client.get(f"/api/characters/{imported.json()['id']}").json()
        assert len(detail["revisions"]) == 2
        assert detail["origin_character_id"] == character_id
        assert detail["source_type"] == "imported"
    assert len(set(imported_ids + [character_id])) == 3


def test_import_rejects_bad_archive_without_creating_character(client):
    before = len(client.get("/api/characters").json())
    bad = client.post("/api/characters/import", content=b"not a zip", headers={"Content-Type": "application/zip"})
    assert bad.status_code == 422
    assert len(client.get("/api/characters").json()) == before


def test_character_with_avatar_can_join_two_stories(client):
    first_story = client.get("/api/stories").json()[0]["id"]
    with Session(client.app.state.engine) as session:
        second = Story(slug="second-novel", title="Вторая новелла", premise="Другой мир", current_scene="Начало")
        session.add(second)
        session.commit()
        second_story = second.id
    created = client.post("/api/characters", json=PROFILE).json()
    uploaded = client.post(
        f"/api/characters/{created['id']}/avatar?filename=mira.png&creator=Author&license=CC-BY-4.0&source=manual",
        content=PNG,
        headers={"Content-Type": "image/png"},
    ).json()
    for story_id in (first_story, second_story):
        linked = client.post(
            f"/api/stories/{story_id}/characters",
            json={"character_id": created["id"], "revision_id": uploaded["current_revision_id"]},
        )
        assert linked.status_code == 201
    detail = client.get(f"/api/characters/{created['id']}").json()
    assert {item["story_id"] for item in detail["linked_stories"]} == {first_story, second_story}


def test_cover_and_avatar_survive_text_revision_and_archive(client):
    created = client.post("/api/characters", json=PROFILE).json()
    character_id = created["id"]
    query = "filename=image.png&creator=Author&license=CC-BY-4.0&source=manual"
    avatar = client.post(
        f"/api/characters/{character_id}/avatar?{query}", content=PNG, headers={"Content-Type": "image/png"}
    )
    assert avatar.status_code == 201
    cover = client.post(
        f"/api/characters/{character_id}/cover?{query}", content=PNG, headers={"Content-Type": "image/png"}
    )
    assert cover.status_code == 201
    updated = client.post(f"/api/characters/{character_id}/revisions", json={**PROFILE, "biography": "Новая глава"})
    assert updated.status_code == 201
    assert updated.json()["avatar"]["sha256"] == avatar.json()["avatar"]["sha256"]
    assert updated.json()["cover"]["sha256"] == cover.json()["cover"]["sha256"]
    archive = client.get(f"/api/characters/{character_id}/export")
    imported = client.post(
        "/api/characters/import", content=archive.content, headers={"Content-Type": "application/zip"}
    )
    assert imported.status_code == 201
    assert imported.json()["cover"]["license"] == "CC-BY-4.0"


def test_extract_from_playthrough_copies_pinned_revision_as_independent_profile(client):
    story_id = client.get("/api/stories").json()[0]["id"]
    original = client.post("/api/characters", json=PROFILE).json()
    character_id = original["id"]
    uploaded = client.post(
        f"/api/characters/{character_id}/avatar?filename=image.png&creator=Author&license=CC-BY-4.0&source=manual",
        content=PNG,
        headers={"Content-Type": "image/png"},
    ).json()
    client.post(
        f"/api/stories/{story_id}/characters",
        json={"character_id": character_id, "revision_id": uploaded["current_revision_id"]},
    )
    old_game = client.post(f"/api/stories/{story_id}/sessions", json={"provider_id": "ollama"}).json()
    client.post(f"/api/characters/{character_id}/revisions", json={**PROFILE, "name": "Новая Мира"})
    extracted = client.post(f"/api/sessions/{old_game['id']}/characters/{character_id}/extract")
    assert extracted.status_code == 201
    profile = extracted.json()
    assert profile["id"] != character_id
    assert profile["source_type"] == "extracted"
    assert profile["origin_character_id"] == character_id
    assert profile["name"] == "Мира"
    assert profile["avatar"]["sha256"] == uploaded["avatar"]["sha256"]


def test_builtin_portrait_is_exported_with_provenance(client):
    akane = next(item for item in client.get("/api/characters").json() if item["id"] == "akane")
    assert akane["avatar"]["sha256"]
    assert akane["avatar"]["license"]
    archive = client.get("/api/characters/akane/export")
    assert archive.status_code == 200
    imported = client.post(
        "/api/characters/import", content=archive.content, headers={"Content-Type": "application/zip"}
    )
    assert imported.status_code == 201
    assert imported.json()["avatar"]["sha256"] == akane["avatar"]["sha256"]


def test_corrupt_existing_blob_is_not_silently_accepted(client):
    created = client.post("/api/characters", json=PROFILE).json()
    url = f"/api/characters/{created['id']}/avatar?filename=image.png&creator=Author&license=own&source=manual"
    first = client.post(url, content=PNG, headers={"Content-Type": "image/png"})
    assert first.status_code == 201
    material = first.json()["avatar"]
    path = client.app.state.settings.asset_dir / f"{material['sha256']}.png"
    path.write_bytes(b"corrupted")
    retry = client.post(url, content=PNG, headers={"Content-Type": "image/png"})
    assert retry.status_code == 422


def test_import_rejects_unexpected_zip_entry(client):
    created = client.post("/api/characters", json=PROFILE).json()
    original = client.get(f"/api/characters/{created['id']}/export").content
    output = BytesIO()
    with ZipFile(BytesIO(original)) as source, ZipFile(output, "w") as target:
        target.writestr("manifest.json", source.read("manifest.json"))
        target.writestr("../outside.txt", "do not write")
    before = len(client.get("/api/characters").json())
    response = client.post("/api/characters/import", content=output.getvalue())
    assert response.status_code == 422
    assert len(client.get("/api/characters").json()) == before
