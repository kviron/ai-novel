from app.core.errors import ProviderUnavailableError


def _draft(client):
    response = client.post("/api/author/stories", json={})
    assert response.status_code == 201
    return response.json()


def test_generates_from_unsaved_story_text_without_persisting(client, fake_provider):
    draft = _draft(client)
    draft["identity"]["title"] = "Мой город"
    draft["identity"]["premise"] = "Девушка ищет пропавшего брата"
    fake_provider.text_responses = ["Ночной город, где девушка ищет пропавшего брата."]

    response = client.post(
        f"/api/author/stories/{draft['story_id']}/generate-field",
        json={"field": "identity.premise", "current_text": draft["identity"]["premise"], "draft": draft},
    )

    assert response.status_code == 200, response.text
    assert "девушка ищет пропавшего брата" in response.json()["text"].casefold()
    assert "Мой город" in fake_provider.last_text_request.user_prompt
    saved = client.get(f"/api/author/stories/{draft['story_id']}/draft").json()
    assert saved["identity"]["premise"] == ""


def test_generation_uses_selected_model_window(client, fake_provider):
    draft = _draft(client)
    client.app.state.settings.model_context_windows["ollama:qwen3:14b-q4_K_M"] = 4096
    fake_provider.text_responses = ["Город под дождём."]

    response = client.post(
        f"/api/author/stories/{draft['story_id']}/generate-field",
        json={"field": "identity.setting", "current_text": "", "draft": draft},
    )

    assert response.status_code == 200, response.text
    assert fake_provider.last_text_request.context_tokens == 4096


def test_generation_rejects_unknown_field_and_foreign_story(client):
    draft = _draft(client)
    body = {"field": "identity.slug", "current_text": "", "draft": draft}
    assert client.post(f"/api/author/stories/{draft['story_id']}/generate-field", json=body).status_code == 422
    body["field"] = "identity.premise"
    assert client.post("/api/author/stories/another-story/generate-field", json=body).status_code == 404


def test_generation_reports_provider_failure(client, fake_provider):
    draft = _draft(client)
    fake_provider.errors = [ProviderUnavailableError()]
    response = client.post(
        f"/api/author/stories/{draft['story_id']}/generate-field",
        json={"field": "canon.creative_goals", "current_text": "", "draft": draft},
    )
    assert response.status_code == 503
    assert response.json()["code"] == "provider_unavailable"


def test_nested_field_requires_an_item_in_the_live_draft(client):
    draft = _draft(client)
    response = client.post(
        f"/api/author/stories/{draft['story_id']}/generate-field",
        json={"field": "canon.fact.statement", "target_id": "missing", "current_text": "", "draft": draft},
    )
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


def test_short_field_rejects_unusable_model_output(client, fake_provider):
    draft = _draft(client)
    fake_provider.text_responses = ["Очень длинное название " * 20]
    response = client.post(
        f"/api/author/stories/{draft['story_id']}/generate-field",
        json={"field": "identity.title", "current_text": "", "draft": draft},
    )
    assert response.status_code == 502
    assert response.json()["code"] == "invalid_model_response"
