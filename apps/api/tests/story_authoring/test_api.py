"""Authoring HTTP contract and frozen draft preview sessions."""

import hashlib
import json
import re
import struct
import zlib
from io import BytesIO

import pytest
from PIL import Image
from sqlmodel import Session, select

from app.db.models import (
    Autosave,
    Character,
    SessionCharacter,
    SessionProtagonist,
    Story,
    StoryDraftSnapshot,
    StoryMaterial,
    StorySession,
    StoryVersion,
)
from app.modules.story_authoring.sessions import snapshot_aware_session_detail


def _identity(title="One", premise="First premise", cover_material_id=None):
    return {
        "title": title,
        "slug": "one",
        "premise": premise,
        "setting": "City",
        "opening_situation": "Arrival",
        "cover_material_id": cover_material_id,
    }


def _save(client, draft, section, payload, **params):
    response = client.put(
        f"/api/author/stories/{draft['story_id']}/draft/{section}",
        params=params,
        json={"expected_revision": draft["draft_revision"], "data": payload},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _publishable(client):
    created = client.post("/api/author/stories", json={})
    assert created.status_code == 201, created.text
    return _save(client, created.json(), "identity", _identity())


def _image_bytes(mime_type):
    output = BytesIO()
    Image.new("RGB", (2, 2), "red").save(
        output, format={"image/png": "PNG", "image/jpeg": "JPEG", "image/webp": "WEBP"}[mime_type]
    )
    return output.getvalue()


def _forged_png(width: int, height: int) -> bytes:
    """Keep a tiny valid PNG stream while advertising huge decoded dimensions."""
    original = bytearray(_image_bytes("image/png"))
    original[16:24] = struct.pack(">II", width, height)
    original[29:33] = struct.pack(">I", zlib.crc32(original[12:29]))
    return bytes(original)


def test_create_get_save_validate_publish_clone_and_published_read_model(client):
    created = client.post("/api/author/stories", json={"title": "One"})
    assert created.status_code == 201
    draft = created.json()
    assert draft["identity"]["title"] == "One"
    assert client.get(f"/api/author/stories/{draft['story_id']}/draft").json()["version_id"] == draft["version_id"]

    draft = _save(client, draft, "identity", _identity())
    validation = client.post(f"/api/author/stories/{draft['story_id']}/validate")
    assert validation.status_code == 200
    assert validation.json()["valid"] is True

    published = client.post(f"/api/author/stories/{draft['story_id']}/publish")
    assert published.status_code == 200, published.text
    assert published.json()["status"] == "published"
    version = client.get(f"/api/stories/{draft['story_id']}/versions/{draft['version_id']}")
    assert version.status_code == 200
    assert version.json()["identity"]["premise"] == "First premise"
    cloned = client.post(f"/api/author/stories/{draft['story_id']}/draft-from/{draft['version_id']}")
    assert cloned.status_code == 201
    assert cloned.json()["version_number"] == 2
    assert cloned.json()["based_on_version_id"] == draft["version_id"]


def test_create_and_test_session_accept_omitted_optional_bodies(client):
    created = client.post("/api/author/stories")
    assert created.status_code == 201
    draft = _save(client, created.json(), "identity", _identity())
    session_response = client.post(f"/api/author/stories/{draft['story_id']}/test-sessions")
    assert session_response.status_code == 201


def test_stale_save_and_invalid_publish_have_structured_errors_and_preserve_pointer(client):
    draft = _publishable(client)
    stale = client.put(
        f"/api/author/stories/{draft['story_id']}/draft/identity",
        json={"expected_revision": 1, "data": _identity("Other")},
    )
    assert stale.status_code == 409
    assert stale.json()["code"] == "draft_conflict"
    assert stale.json()["latest_revision"] == draft["draft_revision"]

    bad = _save(client, draft, "identity", _identity(premise=""))
    invalid = client.post(f"/api/author/stories/{bad['story_id']}/publish")
    assert invalid.status_code == 422
    assert invalid.json()["code"] == "draft_invalid"
    assert invalid.json()["diagnostics"][0]["field"] == "identity.premise"
    with Session(client.app.state.engine) as session:
        assert session.get(Story, bad["story_id"]).current_published_version_id is None
        assert session.get(StoryVersion, bad["version_id"]).status == "draft"


def test_diagnostics_have_identical_public_paths_and_russian_messages_across_endpoints(client):
    created = client.post("/api/author/stories", json={}).json()
    story_id = created["story_id"]
    fetched = client.get(f"/api/author/stories/{story_id}/draft").json()
    saved = _save(client, created, "identity", created["identity"])
    validated = client.post(f"/api/author/stories/{story_id}/validate").json()
    rejected = client.post(f"/api/author/stories/{story_id}/publish").json()
    assert rejected["code"] == "draft_invalid"
    for code in ("identity_title_required", "cover_missing"):
        samples = [
            next(item for item in body["diagnostics"] if item["code"] == code)
            for body in (created, fetched, saved, validated, rejected)
        ]
        assert all(item == samples[0] for item in samples)
        assert samples[0]["field"] == (
            "identity.title" if code == "identity_title_required" else "identity.cover_material_id"
        )
        assert re.search("[А-Яа-я]", samples[0]["message"])


def test_database_diagnostic_is_russian_with_same_public_path(client):
    first = _publishable(client)
    assert client.post(f"/api/author/stories/{first['story_id']}/publish").status_code == 200
    second = _publishable(client)
    validated = client.post(f"/api/author/stories/{second['story_id']}/validate").json()
    rejected = client.post(f"/api/author/stories/{second['story_id']}/publish").json()
    for response in (validated, rejected):
        diagnostic = next(item for item in response["diagnostics"] if item["code"] == "identity_slug_duplicate")
        assert diagnostic["field"] == "identity.slug"
        assert re.search("[А-Яа-я]", diagnostic["message"])
    assert validated["diagnostics"] == rejected["diagnostics"]


def test_failed_republish_keeps_previous_published_pointer(client):
    first = _publishable(client)
    published = client.post(f"/api/author/stories/{first['story_id']}/publish")
    assert published.status_code == 200
    cloned = client.post(f"/api/author/stories/{first['story_id']}/draft-from/{first['version_id']}").json()
    _save(client, cloned, "identity", _identity(premise=""))
    denied = client.post(f"/api/author/stories/{first['story_id']}/publish")
    assert denied.status_code == 422
    assert denied.json()["code"] == "draft_invalid"
    with Session(client.app.state.engine) as session:
        assert session.get(Story, first["story_id"]).current_published_version_id == first["version_id"]


def test_mode_change_conflict_has_stable_code(client):
    draft = _publishable(client)
    draft = _save(client, draft, "canon", {"creative_goals": "Explore the city"})
    denied = client.put(
        f"/api/author/stories/{draft['story_id']}/draft/mode",
        json={"expected_revision": draft["draft_revision"], "data": {"mode": "hybrid"}},
    )
    assert denied.status_code == 422
    assert denied.json()["code"] == "mode_change_conflict"


def test_author_requests_reject_extra_fields_and_missing_resources_have_stable_codes(client):
    assert client.post("/api/author/stories", json={"asset_path": "/private/file.png"}).status_code == 422
    draft = client.post("/api/author/stories", json={}).json()
    extra = client.put(
        f"/api/author/stories/{draft['story_id']}/draft/identity",
        json={"expected_revision": 1, "data": {"title": "One", "asset_path": "/private/file.png"}},
    )
    assert extra.status_code == 422
    assert extra.json()["code"] == "validation_error"
    assert client.get("/api/author/stories/missing/draft").json()["code"] == "story_not_found"
    assert client.get(f"/api/stories/{draft['story_id']}/versions/missing").json()["code"] == "version_not_found"


@pytest.mark.parametrize("mime_type", ["image/png", "image/jpeg", "image/webp"])
def test_cover_upload_persists_content_hash_and_provenance(client, mime_type):
    draft = client.post("/api/author/stories", json={}).json()
    content = _image_bytes(mime_type)
    response = client.post(
        f"/api/author/stories/{draft['story_id']}/draft/cover",
        params={"filename": "cover", "creator": "Artist", "license": "CC-BY-4.0", "source": "manual"},
        content=content,
        headers={"content-type": mime_type},
    )
    assert response.status_code == 201, response.text
    material = response.json()
    assert material["sha256"] == hashlib.sha256(content).hexdigest()
    assert material["mime_type"] == mime_type
    assert material["creator"] == "Artist"
    assert material["license"] == "CC-BY-4.0"
    assert material["source"] == "manual"
    with Session(client.app.state.engine) as session:
        record = session.get(StoryMaterial, material["id"])
        assert record.story_id == draft["story_id"]
        assert (client.app.state.settings.asset_dir / record.asset_path).read_bytes() == content


def test_cover_upload_rejects_mime_spoofing_size_and_missing_provenance(client):
    draft = client.post("/api/author/stories", json={}).json()
    url = f"/api/author/stories/{draft['story_id']}/draft/cover"
    params = {"filename": "cover.png", "creator": "Artist", "license": "own", "source": "manual"}
    assert client.post(url, params=params, content=b"hello", headers={"content-type": "text/plain"}).status_code == 422
    assert client.post(url, params=params, content=b"hello", headers={"content-type": "image/png"}).status_code == 422
    assert (
        client.post(
            url, params=params, content=b"x" * (10 * 1024 * 1024 + 1), headers={"content-type": "image/png"}
        ).status_code
        == 413
    )
    assert (
        client.post(
            url,
            params={**params, "creator": ""},
            content=_image_bytes("image/png"),
            headers={"content-type": "image/png"},
        ).status_code
        == 422
    )
    assert (
        client.post(
            url,
            params={**params, "filename": "C:cover.png"},
            content=_image_bytes("image/png"),
            headers={"content-type": "image/png"},
        ).status_code
        == 422
    )


@pytest.mark.parametrize("width,height", [(10_000, 10_000), (20_000, 20_000)])
def test_cover_upload_rejects_tiny_png_with_decompression_bomb_dimensions(client, width, height):
    draft = client.post("/api/author/stories", json={}).json()
    content = _forged_png(width, height)
    assert len(content) < 1_000
    response = client.post(
        f"/api/author/stories/{draft['story_id']}/draft/cover",
        params={"filename": "forged.png", "creator": "Artist", "license": "own", "source": "manual"},
        content=content,
        headers={"content-type": "image/png"},
    )
    assert response.status_code == 422
    assert response.json()["code"] == "invalid_material"
    assert re.search("[А-Яа-я]", response.json()["detail"])


def test_cover_material_from_another_story_cannot_be_attached(client):
    first = client.post("/api/author/stories", json={}).json()
    second = client.post("/api/author/stories", json={}).json()
    response = client.post(
        f"/api/author/stories/{first['story_id']}/draft/cover",
        params={"filename": "cover.png", "creator": "Artist", "license": "own", "source": "manual"},
        content=_image_bytes("image/png"),
        headers={"content-type": "image/png"},
    )
    material_id = response.json()["id"]
    denied = client.put(
        f"/api/author/stories/{second['story_id']}/draft/identity",
        json={"expected_revision": 1, "data": _identity(cover_material_id=material_id)},
    )
    assert denied.status_code == 422
    assert denied.json()["code"] == "draft_invalid"
    assert denied.json()["diagnostics"][0]["field"] == "identity.cover_material_id"


def test_author_session_pins_exact_canonical_snapshot_and_does_not_create_autosave(client):
    draft = _publishable(client)
    created = client.post(f"/api/author/stories/{draft['story_id']}/test-sessions", json={})
    assert created.status_code == 201, created.text
    game = created.json()
    assert game["current_scene"] == "Arrival"
    draft = _save(client, draft, "identity", _identity(title="Updated", premise="Changed premise"))
    restored = client.get(f"/api/sessions/{game['id']}")
    assert restored.status_code == 200
    assert restored.json()["current_scene"] == "Arrival"
    assert restored.json()["story"]["title"] == "One"
    assert restored.json()["story"]["premise"] == "First premise"
    with Session(client.app.state.engine) as session:
        assert snapshot_aware_session_detail(session, game["id"]).story.premise == "First premise"
        row = session.get(StorySession, game["id"])
        snapshot = session.get(StoryDraftSnapshot, row.draft_snapshot_id)
        assert row.kind == "author"
        assert row.story_version_id is None
        assert snapshot.source_draft_revision < draft["draft_revision"]
        assert json.loads(snapshot.payload)["identity"]["premise"] == "First premise"
        assert hashlib.sha256(snapshot.payload.encode("utf-8")).hexdigest() == snapshot.sha256
        assert session.get(SessionProtagonist, game["id"]) is not None
        assert session.exec(select(SessionCharacter).where(SessionCharacter.session_id == game["id"])).all() == []
        assert session.get(Autosave, draft["story_id"]) is None


def test_author_session_pins_fixed_hero_and_cast_from_draft(client):
    with Session(client.app.state.engine) as session:
        akane_revision = session.get(Character, "akane").current_revision_id
        mark_revision = session.get(Character, "mark").current_revision_id
    draft = _publishable(client)
    draft = _save(
        client,
        draft,
        "hero",
        {
            "hero_policy": "fixed",
            "hero_allowed_sources": ["catalog"],
            "fixed_hero_revision_id": akane_revision,
        },
    )
    draft = _save(
        client,
        draft,
        "cast",
        {
            "characters": [
                {
                    "id": "mark-pin",
                    "character_id": "mark",
                    "revision_id": mark_revision,
                    "order_index": 0,
                    "role": "companion",
                    "color": "#123456",
                }
            ]
        },
    )
    created = client.post(f"/api/author/stories/{draft['story_id']}/test-sessions", json={})
    assert created.status_code == 201, created.text
    game = created.json()
    assert game["protagonist"]["source_revision_id"] == akane_revision
    assert [(item["id"], item["role"], item["color"]) for item in game["characters"]] == [
        ("mark", "companion", "#123456")
    ]
    draft = _save(client, draft, "cast", {"characters": []})
    restored = client.get(f"/api/sessions/{game['id']}").json()
    assert restored["protagonist"]["source_revision_id"] == akane_revision
    assert [(item["id"], item["role"], item["color"]) for item in restored["characters"]] == [
        ("mark", "companion", "#123456")
    ]


def test_author_test_session_uses_draft_recommended_model_and_reports_unavailability(client, fake_provider):
    fake_provider.models = ["installed:first", "installed:preferred"]
    draft = _publishable(client)
    rules = draft["rules"]
    rules["recommended_model_id"] = "installed:preferred"
    draft = _save(client, draft, "rules", rules)
    created = client.post(f"/api/author/stories/{draft['story_id']}/test-sessions", json={})
    assert created.status_code == 201
    assert created.json()["model_id"] == "installed:preferred"
    fake_provider.models = []
    unavailable = client.post(f"/api/author/stories/{draft['story_id']}/test-sessions", json={})
    assert unavailable.status_code == 503
    assert unavailable.json()["code"] == "model_unavailable"


def test_invalid_draft_cannot_create_test_session_or_snapshot(client):
    draft = client.post("/api/author/stories", json={}).json()
    response = client.post(f"/api/author/stories/{draft['story_id']}/test-sessions", json={})
    assert response.status_code == 422
    assert response.json()["code"] == "draft_invalid"
    with Session(client.app.state.engine) as session:
        assert session.exec(select(StoryDraftSnapshot)).all() == []
        assert session.exec(select(StorySession).where(StorySession.story_id == draft["story_id"])).all() == []
