import json
import traceback

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.errors import ProviderResponseError, ProviderUnavailableError
from app.modules.providers.contracts import TurnGenerationRequest
from app.modules.providers.ollama import OllamaProvider
from app.modules.providers.router import get_provider_registry, router
from app.modules.providers.service import ProviderRegistry
from app.modules.story_engine.contracts import TurnProposal
from tests.fakes import FakeLLMProvider

VALID_TURN_JSON = json.dumps(
    {
        "narration": "Дождь стихает.",
        "dialogue": {"character_id": "akane", "text": "Я ждала этого вопроса."},
        "visual_directive": {
            "mode": "sprite_scene",
            "emotion": "fan",
            "pose": "fan_open",
            "outfit": "red_dress",
        },
        "suggested_choices": ["Продолжить разговор", "Осмотреть веер"],
        "proposed_effects": [],
    },
    ensure_ascii=False,
)


def turn_request() -> TurnGenerationRequest:
    return TurnGenerationRequest(
        model_id="qwen3:14b-q4_K_M",
        system_prompt="Веди историю.",
        user_prompt="Игрок спрашивает о веере.",
        response_schema=TurnProposal.model_json_schema(),
        context_tokens=16384,
    )


def test_ollama_sends_schema_and_parses_turn():
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert body["model"] == "qwen3:14b-q4_K_M"
        assert body["stream"] is False
        assert body["messages"] == [
            {"role": "system", "content": "Веди историю."},
            {"role": "user", "content": "Игрок спрашивает о веере."},
        ]
        assert body["format"]["required"] == [
            "narration",
            "dialogue",
            "visual_directive",
            "suggested_choices",
            "proposed_effects",
        ]
        assert body["options"] == {"num_ctx": 16384}
        return httpx.Response(200, json={"message": {"content": VALID_TURN_JSON}})

    provider = OllamaProvider(
        base_url="http://ollama.test",
        timeout_seconds=5,
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    proposal = provider.generate_turn(turn_request())

    assert proposal.dialogue.character_id == "akane"


def test_generation_uses_the_configured_120_second_timeout(monkeypatch):
    monkeypatch.delenv("PROVIDER_TIMEOUT_SECONDS", raising=False)
    settings = Settings(_env_file=None)

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.extensions["timeout"] == {
            "connect": 120.0,
            "read": 120.0,
            "write": 120.0,
            "pool": 120.0,
        }
        return httpx.Response(200, json={"message": {"content": VALID_TURN_JSON}})

    provider = OllamaProvider(
        settings.ollama_base_url,
        settings.provider_timeout_seconds,
        httpx.Client(transport=httpx.MockTransport(handler)),
    )

    provider.generate_turn(turn_request())


def test_ollama_unavailable_raises_typed_error():
    def offline(_: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("offline")

    provider = OllamaProvider(
        "http://ollama.test",
        1,
        httpx.Client(transport=httpx.MockTransport(offline)),
    )

    with pytest.raises(ProviderUnavailableError):
        provider.health()


@pytest.mark.parametrize("error_type", [httpx.ConnectError, httpx.ReadTimeout])
def test_ollama_transport_failure_has_stable_unavailable_code(error_type):
    def fail(request: httpx.Request) -> httpx.Response:
        raise error_type("transport failed", request=request)

    provider = OllamaProvider(
        "http://ollama.test",
        1,
        httpx.Client(transport=httpx.MockTransport(fail)),
    )

    with pytest.raises(ProviderUnavailableError) as raised:
        provider.list_models()

    assert raised.value.code == "provider_unavailable"


def test_ollama_http_error_is_provider_unavailable_without_raw_body_in_message():
    provider = OllamaProvider(
        "http://ollama.test",
        1,
        httpx.Client(
            transport=httpx.MockTransport(
                lambda _: httpx.Response(503, text="diagnostic upstream body")
            )
        ),
    )

    with pytest.raises(ProviderUnavailableError) as raised:
        provider.health()

    assert raised.value.code == "provider_unavailable"
    assert raised.value.raw_response == "diagnostic upstream body"
    assert "diagnostic upstream body" not in str(raised.value)


def test_ollama_unknown_model_has_distinct_stable_code():
    provider = OllamaProvider(
        "http://ollama.test",
        1,
        httpx.Client(
            transport=httpx.MockTransport(
                lambda _: httpx.Response(404, text='{"error":"model not found"}')
            )
        ),
    )

    with pytest.raises(ProviderResponseError) as raised:
        provider.generate_turn(turn_request())

    assert raised.value.code == "model_unavailable"
    assert raised.value.raw_response == '{"error":"model not found"}'
    assert raised.value.raw_response not in str(raised.value)


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(200, text="not-json"),
        httpx.Response(200, json={"message": {"content": "not-json"}}),
        httpx.Response(200, json={"message": {"content": '{"narration":"too little"}'}}),
    ],
)
def test_ollama_malformed_payload_has_diagnostic_body_but_safe_message(response):
    provider = OllamaProvider(
        "http://ollama.test",
        1,
        httpx.Client(transport=httpx.MockTransport(lambda _: response)),
    )

    with pytest.raises(ProviderResponseError) as raised:
        provider.generate_turn(turn_request())

    assert raised.value.code == "provider_invalid_response"
    assert raised.value.raw_response
    assert raised.value.raw_response not in str(raised.value)


def test_validation_failure_traceback_does_not_expose_generated_content():
    sensitive_marker = "SENSITIVE_GENERATED_CONTENT_47A1"
    invalid_turn = json.loads(VALID_TURN_JSON)
    invalid_turn["suggested_choices"] = [sensitive_marker]
    provider = OllamaProvider(
        "http://ollama.test",
        1,
        httpx.Client(
            transport=httpx.MockTransport(
                lambda _: httpx.Response(
                    200,
                    json={"message": {"content": json.dumps(invalid_turn)}},
                )
            )
        ),
    )

    with pytest.raises(ProviderResponseError) as raised:
        provider.generate_turn(turn_request())

    formatted_traceback = "".join(
        traceback.format_exception(raised.type, raised.value, raised.tb)
    )
    assert sensitive_marker not in formatted_traceback
    assert sensitive_marker in raised.value.raw_response
    assert raised.value.__cause__ is None
    assert raised.value.__context__ is None


def test_request_schema_is_deeply_immutable_and_wire_payload_is_a_defensive_copy():
    source_schema = TurnProposal.model_json_schema()
    request = TurnGenerationRequest(
        model_id="qwen3:14b-q4_K_M",
        system_prompt="Веди историю.",
        user_prompt="Игрок спрашивает о веере.",
        response_schema=source_schema,
    )

    with pytest.raises(TypeError):
        request.response_schema["required"][0] = "tampered"
    source_schema["required"][0] = "caller_tampered"

    def handler(http_request: httpx.Request) -> httpx.Response:
        wire_schema = json.loads(http_request.content)["format"]
        assert isinstance(wire_schema, dict)
        assert isinstance(wire_schema["required"], list)
        assert wire_schema["required"][0] == "narration"
        return httpx.Response(200, json={"message": {"content": VALID_TURN_JSON}})

    provider = OllamaProvider(
        "http://ollama.test",
        1,
        httpx.Client(transport=httpx.MockTransport(handler)),
    )

    provider.generate_turn(request)


def test_immutable_request_schema_remains_json_serializable():
    request = turn_request()

    serialized = json.loads(request.model_dump_json())

    assert isinstance(serialized["response_schema"], dict)
    assert isinstance(serialized["response_schema"]["required"], list)
    assert serialized["response_schema"]["required"][0] == "narration"


def test_ollama_lists_models_and_reports_health():
    response = {"models": [{"name": "qwen3:14b-q4_K_M"}, {"name": "gemma3:4b"}]}
    provider = OllamaProvider(
        "http://ollama.test/",
        1,
        httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, json=response))),
    )

    assert provider.list_models() == ["qwen3:14b-q4_K_M", "gemma3:4b"]
    assert provider.health().model_dump() == {
        "provider_id": "ollama",
        "available": True,
        "detail": "available",
        "models": ["qwen3:14b-q4_K_M", "gemma3:4b"],
    }


def _valid_proposal() -> TurnProposal:
    return TurnProposal.model_validate_json(VALID_TURN_JSON)


def _contract_ollama_handler(request: httpx.Request) -> httpx.Response:
    if request.url.path == "/api/tags":
        return httpx.Response(200, json={"models": [{"name": "qwen3:14b-q4_K_M"}]})
    return httpx.Response(200, json={"message": {"content": VALID_TURN_JSON}})


@pytest.mark.parametrize(
    "provider_factory",
    [
        pytest.param(
            lambda: FakeLLMProvider(
                responses=[_valid_proposal()],
                models=["qwen3:14b-q4_K_M"],
            ),
            id="fake",
        ),
        pytest.param(
            lambda: OllamaProvider(
                "http://ollama.test",
                1,
                httpx.Client(transport=httpx.MockTransport(_contract_ollama_handler)),
            ),
            id="ollama",
        ),
    ],
)
def test_provider_contract_covers_health_models_and_turn_generation(provider_factory):
    provider = provider_factory()

    status = provider.health()
    models = provider.list_models()
    result = provider.generate_turn(turn_request())

    assert status.provider_id == "ollama"
    assert status.available is True
    assert status.models == ["qwen3:14b-q4_K_M"]
    assert models == ["qwen3:14b-q4_K_M"]
    assert isinstance(result, TurnProposal)
    assert result.narration == "Дождь стихает."


def test_registry_selects_provider_by_stable_id():
    provider = FakeLLMProvider()
    registry = ProviderRegistry([provider])

    assert registry.get("ollama") is provider

    with pytest.raises(KeyError):
        registry.get("unknown")


def test_ollama_closes_only_the_http_client_it_created(monkeypatch):
    client_type = httpx.Client
    owned_client = client_type()
    monkeypatch.setattr(httpx, "Client", lambda: owned_client)
    owned_provider = OllamaProvider("http://ollama.test", 1)

    owned_provider.close()

    assert owned_client.is_closed

    injected_client = client_type()
    injected_provider = OllamaProvider("http://ollama.test", 1, injected_client)

    injected_provider.close()

    assert not injected_client.is_closed
    injected_client.close()


def test_provider_status_route_isolates_an_unavailable_provider():
    available = FakeLLMProvider(models=["qwen3:14b-q4_K_M"])
    unavailable = FakeLLMProvider(
        provider_id="offline",
        errors=[ProviderUnavailableError()],
    )
    registry = ProviderRegistry([available, unavailable])
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_provider_registry] = lambda: registry

    response = TestClient(app).get("/api/providers")

    assert response.status_code == 200
    assert response.json() == [
        {
            "provider_id": "ollama",
            "available": True,
            "detail": "available",
            "models": ["qwen3:14b-q4_K_M"],
        },
        {
            "provider_id": "offline",
            "available": False,
            "detail": "provider_unavailable",
            "models": [],
        },
    ]
