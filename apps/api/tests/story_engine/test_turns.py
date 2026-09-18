import json
import re
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import httpx
import pytest
from sqlalchemy import event, text
from sqlmodel import Session, select

from app.core.errors import ProviderResponseError, ProviderUnavailableError
from app.db.engine import get_session
from app.db.models import StorySession, Turn
from app.modules.providers.ollama import OllamaProvider
from app.modules.providers.router import get_provider_registry
from app.modules.providers.service import ProviderRegistry
from app.modules.story_engine import repository
from app.modules.story_engine.contracts import TurnProposal


def proposal(**changes):
    data = {
        "narration": "Аканэ раскрывает веер и указывает на след на мостовой.",
        "dialogue": {"character_id": "akane", "text": "Этот след оставили для нас."},
        "visual_directive": {"emotion": "fan", "pose": "fan_open", "outfit": "red_dress"},
        "suggested_choices": ["Осмотреть след", "Спросить о веере"],
        "proposed_effects": [],
    }
    data.update(changes)
    return TurnProposal.model_validate(data)


def post_turn(client, game, **changes):
    payload = {"request_id": "turn-1", "expected_state_version": 1, "action": "Спросить о веере"}
    payload.update(changes)
    return client.post(f"/api/sessions/{game.id}/turns", json=payload)


def assert_unchanged(client, game):
    restored = client.get(f"/api/sessions/{game.id}").json()
    assert restored["state_version"] == 1
    assert restored["current_scene"] == "Ночной перекрёсток"
    assert restored["latest_turn"] is None
    with Session(client.app.state.engine) as db:
        assert list(db.exec(select(Turn).where(Turn.session_id == game.id))) == []


def test_valid_proposal_is_committed_once(client, fake_provider, akane_session):
    fake_provider.responses = [proposal()]
    first = post_turn(client, akane_session)
    duplicate = post_turn(client, akane_session, action="Другое действие", expected_state_version=99)
    assert first.status_code == 201
    assert duplicate.status_code == 200
    assert duplicate.json() == first.json()
    result = first.json()
    assert result["state_version"] == 2
    assert result["visual_directive"] == {
        "mode": "sprite_scene",
        "character_id": "akane",
        "emotion": "fan",
        "pose": "fan_open",
        "outfit": "red_dress",
    }
    assert result["speaker"] == "Аканэ Куроха"
    assert result["choices"] == ["Осмотреть след", "Спросить о веере"]
    assert result["provider_id"] == "ollama"
    assert result["model_id"] == "qwen3:14b-q4_K_M"
    assert result["created_at"]
    assert "raw_response" not in result
    assert fake_provider.call_count == 1
    restored = client.get(f"/api/sessions/{akane_session.id}").json()
    assert restored["state_version"] == 2
    assert restored["latest_turn"]["id"] == result["id"]
    assert restored["latest_turn"]["visual_directive"] == result["visual_directive"]
    with Session(client.app.state.engine) as db:
        turns = list(db.exec(select(Turn).where(Turn.session_id == akane_session.id)))
        assert len(turns) == 1
        assert json.loads(turns[0].raw_response)["visual_directive"]["emotion"] == "fan"


@pytest.mark.parametrize(
    "error,code",
    [
        (ProviderUnavailableError(raw_response="SECRET RAW"), "provider_unavailable"),
        (ProviderResponseError("model_unavailable", raw_response="SECRET RAW"), "model_unavailable"),
    ],
)
def test_unavailable_provider_is_safe_and_does_not_repair(client, fake_provider, akane_session, error, code, caplog):
    fake_provider.errors = [error]
    response = post_turn(client, akane_session)
    assert response.status_code == 503
    assert response.json()["code"] == code
    assert response.json()["retryable"] is True
    assert re.search("[А-Яа-я]", response.json()["detail"])
    assert "SECRET RAW" not in response.text + caplog.text
    assert fake_provider.call_count == 1
    assert_unchanged(client, akane_session)


def test_invalid_json_repairs_once_with_diagnostics(client, fake_provider, akane_session, monkeypatch):
    requests = []
    generate = fake_provider.generate_turn

    def record(request):
        requests.append(request)
        return generate(request)

    monkeypatch.setattr(fake_provider, "generate_turn", record)
    fake_provider.errors = [ProviderResponseError(raw_response="BROKEN JSON")]
    fake_provider.responses = [proposal()]
    response = post_turn(client, akane_session)
    assert response.status_code == 201
    assert fake_provider.call_count == 2
    assert "BROKEN JSON" in requests[1].user_prompt
    assert "provider_invalid_response" in requests[1].user_prompt
    assert "BROKEN JSON" not in response.text


def test_invalid_json_twice_has_no_state_change(client, fake_provider, akane_session, caplog):
    fake_provider.errors = [ProviderResponseError(raw_response="SECRET RAW") for _ in range(2)]
    response = post_turn(client, akane_session)
    assert response.status_code == 502
    assert response.json()["code"] == "invalid_model_response"
    assert re.search("[А-Яа-я]", response.json()["detail"])
    assert "SECRET RAW" not in response.text + caplog.text
    assert fake_provider.call_count == 2
    assert_unchanged(client, akane_session)


@pytest.mark.parametrize(
    "changes",
    [
        {"dialogue": {"character_id": "unknown", "text": "Текст"}},
        {"visual_directive": {"emotion": "fan", "pose": "../../escape"}},
        {"visual_directive": {"emotion": "fan", "outfit": "url(evil)"}},
        {"suggested_choices": ["   ", "Продолжить"]},
        {"suggested_choices": ["Продолжить", " продолжить "]},
        {"proposed_effects": [{"key": "state_version", "value": 100}]},
        {"narration": "   "},
        {"dialogue": {"character_id": "akane", "text": "   "}},
    ],
)
def test_invalid_domain_proposal_repairs_then_rejects(client, fake_provider, akane_session, changes):
    fake_provider.responses = [proposal(**changes), proposal(**changes)]
    response = post_turn(client, akane_session)
    assert response.status_code == 502
    assert response.json()["code"] == "invalid_model_response"
    assert fake_provider.call_count == 2
    assert_unchanged(client, akane_session)


def test_unknown_character_can_be_repaired(client, fake_provider, akane_session):
    fake_provider.responses = [proposal(dialogue={"character_id": "wrong", "text": "Текст"}), proposal()]
    assert post_turn(client, akane_session).status_code == 201
    assert fake_provider.call_count == 2


def test_unknown_emotion_falls_back_without_repair(client, fake_provider, akane_session):
    fake_provider.responses = [proposal(visual_directive={"emotion": "unknown"})]
    response = post_turn(client, akane_session)
    assert response.status_code == 201
    assert response.json()["visual_directive"]["emotion"] == "neutral"
    assert fake_provider.call_count == 1
    with Session(client.app.state.engine) as db:
        saved = db.exec(select(Turn).where(Turn.session_id == akane_session.id)).one()
        assert json.loads(saved.raw_response)["visual_directive"]["emotion"] == "unknown"
        assert json.loads(saved.visual_directive)["emotion"] == "neutral"


@pytest.mark.parametrize("choices", [["only"], ["1", "2", "3", "4", "5"]])
def test_schema_choice_count_failure_rejects_after_one_repair(client, akane_session, choices):
    raw = proposal().model_dump()
    raw["suggested_choices"] = choices
    calls = []

    def respond(request):
        calls.append(request)
        return httpx.Response(200, json={"message": {"content": json.dumps(raw)}})

    with httpx.Client(transport=httpx.MockTransport(respond)) as http_client:
        provider = OllamaProvider("http://ollama.test", 1, http_client)
        client.app.dependency_overrides[get_provider_registry] = lambda: ProviderRegistry([provider])
        response = post_turn(client, akane_session)
    assert response.status_code == 502
    assert len(calls) == 2
    assert_unchanged(client, akane_session)


def test_stale_version_rejected_before_generation(client, fake_provider, akane_session):
    response = post_turn(client, akane_session, expected_state_version=2)
    assert response.status_code == 409
    assert response.json()["code"] == "state_conflict"
    assert fake_provider.call_count == 0
    assert_unchanged(client, akane_session)


def test_replay_wins_when_commit_occurs_between_initial_lookup_and_version_check(
    client,
    fake_provider,
    akane_session,
    monkeypatch,
):
    fake_provider.responses = [proposal()]
    load_context = repository.load_context
    winner = []

    def concurrent_commit(db, session_id, version):
        monkeypatch.setattr(repository, "load_context", load_context)
        winner.append(post_turn(client, akane_session))
        return load_context(db, session_id, version)

    monkeypatch.setattr(repository, "load_context", concurrent_commit)
    replay = post_turn(client, akane_session)
    assert winner[0].status_code == 201
    assert replay.status_code == 200
    assert replay.json() == winner[0].json()
    assert fake_provider.call_count == 1


def test_missing_session(client, fake_provider):
    response = client.post(
        "/api/sessions/missing/turns",
        json={
            "request_id": "one",
            "expected_state_version": 1,
            "action": "Продолжить",
        },
    )
    assert response.status_code == 404
    assert response.json()["code"] == "not_found"
    assert re.search("[А-Яа-я]", response.json()["detail"])
    assert fake_provider.call_count == 0


@pytest.mark.parametrize("changes", [{"action": " "}, {"action": "x" * 4001}, {"request_id": " "}])
def test_invalid_request_does_not_generate(client, fake_provider, akane_session, changes):
    assert post_turn(client, akane_session, **changes).status_code == 422
    assert fake_provider.call_count == 0
    assert_unchanged(client, akane_session)


def test_failure_between_insert_and_version_update_rolls_back(client, fake_provider, akane_session):
    fake_provider.responses = [proposal()]
    engine = client.app.state.engine

    def fail_after_insert(conn, cursor, statement, parameters, context, executemany):
        if statement.startswith("INSERT INTO turns"):
            raise RuntimeError("Injected after turn insert")

    event.listen(engine, "after_cursor_execute", fail_after_insert)
    try:
        with pytest.raises(RuntimeError, match="Injected after turn insert"):
            post_turn(client, akane_session)
    finally:
        event.remove(engine, "after_cursor_execute", fail_after_insert)
    assert_unchanged(client, akane_session)


def test_conditional_update_defends_version_in_database(client, fake_provider, akane_session):
    fake_provider.responses = [proposal()]
    # A trigger changes the version after all Python checks, before the UPDATE.
    with client.app.state.engine.begin() as connection:
        connection.execute(
            text("""
            CREATE TRIGGER change_version AFTER INSERT ON turns BEGIN
              UPDATE story_sessions SET state_version = state_version + 7 WHERE id = NEW.session_id;
            END
        """)
        )
    response = post_turn(client, akane_session)
    assert response.status_code == 409
    assert response.json()["code"] == "state_conflict"
    assert_unchanged(client, akane_session)


def test_generation_releases_transaction_and_rechecks_version(client, fake_provider, akane_session, monkeypatch):
    sessions = []

    def tracked_session():
        with Session(client.app.state.engine) as db:
            sessions.append(db)
            yield db

    def advance_during_generation(request):
        assert not sessions[-1].in_transaction()
        with client.app.state.engine.begin() as connection:
            connection.execute(
                text("UPDATE story_sessions SET state_version = 2 WHERE id = :id"), {"id": akane_session.id}
            )
        return proposal()

    client.app.dependency_overrides[get_session] = tracked_session
    monkeypatch.setattr(fake_provider, "generate_turn", advance_during_generation)
    response = post_turn(client, akane_session)
    assert response.status_code == 409
    with Session(client.app.state.engine) as db:
        assert db.get(StorySession, akane_session.id).state_version == 2
        assert list(db.exec(select(Turn).where(Turn.session_id == akane_session.id))) == []


@pytest.mark.parametrize("same_request", [True, False])
def test_concurrent_requests_commit_only_once(client, fake_provider, akane_session, monkeypatch, same_request):
    barrier = Barrier(2)

    def concurrent_generate(request):
        barrier.wait(timeout=10)
        return proposal()

    monkeypatch.setattr(fake_provider, "generate_turn", concurrent_generate)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(post_turn, client, akane_session)
        second = pool.submit(post_turn, client, akane_session, request_id="turn-1" if same_request else "turn-2")
        responses = [first.result(timeout=15), second.result(timeout=15)]
    assert sorted(response.status_code for response in responses) == ([200, 201] if same_request else [201, 409])
    if same_request:
        assert responses[0].json() == responses[1].json()
    with Session(client.app.state.engine) as db:
        assert db.get(StorySession, akane_session.id).state_version == 2
        assert len(list(db.exec(select(Turn).where(Turn.session_id == akane_session.id)))) == 1


def test_prompt_contains_state_facts_and_only_eight_recent_complete_turns(
    client, fake_provider, akane_session, monkeypatch
):
    requests = []

    def generate(request):
        requests.append(request)
        return proposal()

    monkeypatch.setattr(fake_provider, "generate_turn", generate)
    for number in range(10):
        response = post_turn(
            client,
            akane_session,
            request_id=f"request-{number}",
            expected_state_version=number + 1,
            action=f"Действие {number}",
        )
        assert response.status_code == 201
    request = requests[-1]
    assert request.model_id == akane_session.model_id
    assert "Аканэ Куроха" in request.system_prompt
    assert "чужое воспоминание" in request.system_prompt
    assert "fan" in request.system_prompt
    assert "2–4" in request.system_prompt
    assert "suggested_choices" in request.response_schema["properties"]
    context = json.loads(request.user_prompt)
    assert context["action"] == "Действие 9"
    assert context["state"]["state_version"] == 10
    assert len(context["recent_turns"]) == 8
    assert [turn["action"] for turn in context["recent_turns"]] == [f"Действие {n}" for n in range(1, 9)]
    assert all(
        {"narration", "dialogue", "choices", "visual_directive"} <= turn.keys() for turn in context["recent_turns"]
    )
