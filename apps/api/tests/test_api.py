import re

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event

from app.core.config import Settings
from app.core.errors import ProviderUnavailableError
from app.main import create_app
from app.modules.providers.service import ProviderRegistry
from app.modules.story_engine.contracts import TurnProposal
from tests.fakes import FakeLLMProvider


def _akane_story(client: TestClient) -> dict:
    response = client.get("/api/stories")
    assert response.status_code == 200
    return next(story for story in response.json() if story["slug"] == "akane-neon-echo")


def test_real_composition_root_exposes_health_providers_and_seeded_story(client, fake_provider):
    health = client.get("/health")
    providers = client.get("/api/providers")
    akane = _akane_story(client)

    assert health.status_code == 200
    assert health.json() == {"status": "ok", "mode": "demo"}
    assert providers.status_code == 200
    assert providers.json() == [
        {
            "provider_id": "ollama",
            "available": True,
            "detail": "available",
            "models": ["qwen3:14b-q4_K_M"],
        }
    ]
    assert akane["recommended_model_id"] == "qwen3:14b-q4_K_M"
    assert client.app.state.providers.get("ollama") is fake_provider
    assert client.app.state.settings.database_path.is_absolute()


def test_session_restores_through_a_fresh_application(tmp_path):
    database_path = tmp_path / "restart.db"
    provider = FakeLLMProvider(models=["qwen3:14b-q4_K_M"])
    settings = Settings(database_path=database_path, provider_timeout_seconds=1)

    with TestClient(create_app(settings, ProviderRegistry([provider]))) as first_client:
        akane = _akane_story(first_client)
        created = first_client.post(f"/api/stories/{akane['id']}/sessions", json={})
        assert created.status_code == 201

    with TestClient(create_app(settings, ProviderRegistry([provider]))) as second_client:
        restored = second_client.get(f"/api/sessions/{created.json()['id']}")

    assert restored.status_code == 200
    assert restored.json()["id"] == created.json()["id"]


def test_runtime_model_and_context_config_drive_new_sessions_and_turns(tmp_path):
    requests = []
    provider = FakeLLMProvider(models=["review:model"])

    def generate(request):
        requests.append(request)
        return TurnProposal.model_validate(
            {
                "narration": "Аканэ замечает новый след.",
                "dialogue": {"character_id": "akane", "text": "Проверим его."},
                "visual_directive": {"emotion": "fan", "pose": "fan_open", "outfit": "red_dress"},
                "suggested_choices": ["Осмотреть след", "Продолжить разговор"],
                "proposed_effects": [],
            }
        )

    provider.generate_turn = generate
    settings = Settings(
        database_path=tmp_path / "runtime-config.db",
        ollama_model="review:model",
        ollama_context_tokens=2048,
    )

    with TestClient(create_app(settings, ProviderRegistry([provider]))) as client:
        story = _akane_story(client)
        default_session = client.post(f"/api/stories/{story['id']}/sessions", json={})
        explicit_session = client.post(
            f"/api/stories/{story['id']}/sessions",
            json={"provider_id": "ollama", "model_id": "review:model"},
        )
        assert default_session.status_code == 201
        assert explicit_session.status_code == 201

        game = explicit_session.json()
        turn = client.post(
            f"/api/sessions/{game['id']}/turns",
            json={"request_id": "configured-turn", "expected_state_version": 1, "action": "Искать след"},
        )
        restored = client.get(f"/api/sessions/{game['id']}")

    assert story["recommended_model_id"] == "qwen3:14b-q4_K_M"
    assert default_session.json()["model_id"] == "review:model"
    assert game["model_id"] == "review:model"
    assert turn.status_code == 201
    assert turn.json()["model_id"] == "review:model"
    assert restored.json()["model_id"] == "review:model"
    assert requests[0].model_id == "review:model"
    assert requests[0].context_tokens == 2048


def test_errors_share_one_safe_russian_shape(client, fake_provider, akane_session):
    missing = client.get("/api/sessions/missing-session")
    invalid = client.post(
        f"/api/sessions/{akane_session.id}/turns",
        json={"request_id": "", "expected_state_version": 0, "action": ""},
    )
    fake_provider.errors = [ProviderUnavailableError(raw_response="PRIVATE PROVIDER BODY")]
    unavailable = client.post(
        f"/api/sessions/{akane_session.id}/turns",
        json={"request_id": "turn-1", "expected_state_version": 1, "action": "Продолжить"},
    )

    assert missing.status_code == 404
    assert missing.json() == {
        "code": "not_found",
        "detail": "Игровая сессия не найдена. Начните новую игру.",
        "retryable": False,
    }
    assert invalid.status_code == 422
    assert invalid.json() == {
        "code": "validation_error",
        "detail": "Проверьте правильность заполнения обязательных полей.",
        "retryable": False,
    }
    assert unavailable.status_code == 503
    assert unavailable.json() == {
        "code": "provider_unavailable",
        "detail": "Ollama недоступна. Проверьте, что она запущена, и повторите.",
        "retryable": True,
    }
    assert all(re.search("[А-Яа-я]", response.json()["detail"]) for response in (missing, invalid, unavailable))
    assert "PRIVATE PROVIDER BODY" not in unavailable.text


def test_openapi_operation_ids_are_unique_stable_and_turn_responses_are_complete(client):
    schema = client.get("/openapi.json").json()
    operations = {
        (method, path): operation
        for path, methods in schema["paths"].items()
        for method, operation in methods.items()
        if method in {"get", "post", "put", "patch", "delete"}
    }
    operation_ids = [operation["operationId"] for operation in operations.values()]

    assert len(operation_ids) == len(set(operation_ids))
    assert operations[("get", "/health")]["operationId"] == "get_health"
    assert operations[("get", "/api/providers")]["operationId"] == "get_api_providers"
    assert operations[("post", "/api/sessions/{session_id}/turns")]["operationId"] == (
        "post_api_sessions_session_id_turns"
    )

    responses = operations[("post", "/api/sessions/{session_id}/turns")]["responses"]
    assert set(responses) == {"200", "201", "404", "409", "422", "502", "503"}
    assert responses["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/TurnResult")
    for status_code in ("404", "409", "422", "502", "503"):
        assert responses[status_code]["content"]["application/json"]["schema"]["$ref"].endswith("/ErrorResponse")


def test_shutdown_disposes_engine_but_does_not_close_injected_registry(tmp_path):
    class TrackingRegistry(ProviderRegistry):
        def __init__(self):
            super().__init__([FakeLLMProvider()])
            self.close_calls = 0

        def close(self) -> None:
            self.close_calls += 1

    registry = TrackingRegistry()
    disposed = []
    app = create_app(Settings(database_path=tmp_path / "owned-engine.db"), registry)

    with TestClient(app) as test_client:
        event.listen(test_client.app.state.engine, "engine_disposed", lambda _: disposed.append(True))
        assert test_client.get("/health").status_code == 200

    assert disposed == [True]
    assert registry.close_calls == 0


def test_startup_failure_is_visible_and_closes_factory_owned_registry(tmp_path, monkeypatch):
    class TrackingRegistry(ProviderRegistry):
        def __init__(self):
            super().__init__([FakeLLMProvider()])
            self.close_calls = 0

        def close(self) -> None:
            self.close_calls += 1

    registry = TrackingRegistry()
    monkeypatch.setattr("app.main.create_provider_registry", lambda _: registry, raising=False)
    monkeypatch.setattr(
        "app.core.lifespan.run_migrations",
        lambda _: (_ for _ in ()).throw(RuntimeError("migration failed")),
        raising=False,
    )
    app = create_app(Settings(database_path=tmp_path / "broken.db"))

    with pytest.raises(RuntimeError, match="migration failed"):
        with TestClient(app):
            pass

    assert registry.close_calls == 1
