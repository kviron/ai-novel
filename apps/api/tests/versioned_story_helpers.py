"""Test helpers that edit cast through the public immutable-version lifecycle."""


def publish_cast(
    client,
    story_id: str,
    *,
    add: list[dict] | None = None,
    update: dict[str, dict] | None = None,
    remove: set[str] | None = None,
):
    story = client.get(f"/api/stories/{story_id}").json()
    draft_response = client.post(f"/api/author/stories/{story_id}/draft-from/{story['current_published_version_id']}")
    assert draft_response.status_code == 201, draft_response.text
    draft = draft_response.json()
    if not draft["identity"]["setting"]:
        identity = {**draft["identity"], "setting": "Тестовый город"}
        saved_identity = client.put(
            f"/api/author/stories/{story_id}/draft/identity",
            json={"expected_revision": draft["draft_revision"], "data": identity},
        )
        assert saved_identity.status_code == 200, saved_identity.text
        draft = saved_identity.json()
    if draft["mode"]["mode"] == "hybrid" and not draft["canon"]["facts"] and not draft["canon"]["beats"]:
        saved_mode = client.put(
            f"/api/author/stories/{story_id}/draft/mode",
            json={"expected_revision": draft["draft_revision"], "data": {"mode": "freeform"}},
        )
        assert saved_mode.status_code == 200, saved_mode.text
        draft = saved_mode.json()
    updates = update or {}
    removed = remove or set()
    members = []
    for member in draft["cast"]["characters"]:
        if member["character_id"] in removed:
            continue
        members.append({**member, **updates.get(member["character_id"], {})})
    for item in add or []:
        members.append(
            {
                "id": f"test-cast-{draft['version_id']}-{item['character_id']}",
                "character_id": item["character_id"],
                "revision_id": item["revision_id"],
                "order_index": len(members),
                "role": item.get("role", "cast"),
                "color": item.get("color", "#D9A75F"),
                "playable": item.get("playable", False),
            }
        )
    for index, member in enumerate(members):
        member["order_index"] = index
    saved = client.put(
        f"/api/author/stories/{story_id}/draft/cast",
        json={"expected_revision": draft["draft_revision"], "data": {"characters": members}},
    )
    assert saved.status_code == 200, saved.text
    published = client.post(f"/api/author/stories/{story_id}/publish")
    assert published.status_code == 200, published.text
    return published.json()
