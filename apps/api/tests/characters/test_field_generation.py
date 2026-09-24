from app.core.errors import ProviderUnavailableError


def test_generate_field_uses_existing_draft_as_context_without_saving(client, fake_provider):
    fake_provider.text_responses = ["Сдержанный исследователь; бережно относится к друзьям."]
    payload = {
        "field": "personality",
        "draft": {
            "name": "Леон",
            "gender": "male",
            "age": 29,
            "personality": "Любит исследовать город",
            "appearance": "Тёмные волосы",
            "biography": "",
            "speech": "",
            "role": "Союзник",
        },
    }

    response = client.post("/api/characters/generate-field", json=payload)

    assert response.status_code == 200
    assert "Любит исследовать город" in response.json()["text"]
    assert fake_provider.last_text_request.model_id == "qwen3:14b-q4_K_M"
    assert "Леон" in fake_provider.last_text_request.user_prompt
    assert "Тёмные волосы" in fake_provider.last_text_request.user_prompt
    assert len(client.get("/api/characters").json()) == 2


def test_generate_field_rejects_unknown_fields(client):
    response = client.post("/api/characters/generate-field", json={"field": "name", "draft": {}})
    assert response.status_code == 422


def test_generate_field_reports_provider_failure(client, fake_provider):
    fake_provider.errors = [ProviderUnavailableError()]
    response = client.post("/api/characters/generate-field", json={"field": "appearance", "draft": {}})
    assert response.status_code == 503
    assert response.json()["code"] == "provider_unavailable"


def test_generate_field_rejects_blank_model_output(client, fake_provider):
    fake_provider.text_responses = ["   "]
    response = client.post("/api/characters/generate-field", json={"field": "role", "draft": {}})
    assert response.status_code == 503
