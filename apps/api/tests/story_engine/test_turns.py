import json
import re
import sqlite3
import traceback
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event, Lock
from types import SimpleNamespace

import httpx
import pytest
from conftest import create_v01_database
from fakes import FakeLLMProvider
from fastapi.testclient import TestClient
from sqlalchemy import event, text
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.core.config import Settings
from app.core.errors import ProviderResponseError, ProviderUnavailableError
from app.db.engine import get_session
from app.db.models import StorySession, Turn
from app.main import create_app
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
        "background": "neon_crossroads",
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


def test_dialogue_history_follows_only_the_active_branch(client, fake_provider, akane_session):
    fake_provider.responses = [proposal(), proposal()]
    first = post_turn(client, akane_session).json()
    second = client.post(
        f"/api/sessions/{akane_session.id}/turns",
        json={"request_id": "turn-2", "expected_state_version": 2, "action": "Осмотреть след"},
    ).json()

    response = client.get(f"/api/sessions/{akane_session.id}/dialogue-history")
    assert response.status_code == 200
    assert [(turn["action"], turn["speaker"]) for turn in response.json()] == [
        ("Спросить о веере", "Аканэ Куроха"),
        ("Осмотреть след", "Аканэ Куроха"),
    ]

    rewind = client.post(
        f"/api/sessions/{akane_session.id}/rewind", json={"expected_state_version": second["state_version"]}
    )
    assert rewind.status_code == 200
    active_history = client.get(f"/api/sessions/{akane_session.id}/dialogue-history").json()
    assert [turn["id"] for turn in active_history] == [first["id"]]


def test_dialogue_history_is_empty_for_new_session_and_missing_session_returns_404(client, akane_session):
    assert client.get(f"/api/sessions/{akane_session.id}/dialogue-history").json() == []
    assert client.get("/api/sessions/missing/dialogue-history").status_code == 404


def test_mark_can_speak_with_his_own_outfit(client, fake_provider, akane_session):
    fake_provider.responses = [
        proposal(
            dialogue={"character_id": "mark", "text": "В архиве есть ещё одна запись."},
            visual_directive={"emotion": "neutral", "pose": "default", "outfit": "dark_coat"},
        )
    ]

    result = post_turn(client, akane_session)

    assert result.status_code == 201
    assert result.json()["speaker"] == "Марк Ветров"
    assert result.json()["visual_directive"]["character_id"] == "mark"
    assert result.json()["visual_directive"]["outfit"] == "dark_coat"


def test_newly_attached_character_can_speak_without_borrowing_demo_assets(client, fake_provider):
    story_id = client.get("/api/stories").json()[0]["id"]
    created = client.post(
        "/api/characters",
        json={
            "name": "Мира",
            "gender": "female",
            "age": 27,
            "personality": "Внимательная",
            "appearance": "Синий плащ",
        },
    ).json()
    assert (
        client.post(
            f"/api/stories/{story_id}/characters",
            json={
                "character_id": created["id"],
                "revision_id": created["current_revision_id"],
            },
        ).status_code
        == 201
    )
    game = client.post(f"/api/stories/{story_id}/sessions", json={"provider_id": "ollama"}).json()
    fake_provider.responses = [
        proposal(
            dialogue={"character_id": created["id"], "text": "Я видела сигнал."},
            visual_directive={"emotion": "neutral", "pose": "default", "outfit": "none"},
        )
    ]

    response = client.post(
        f"/api/sessions/{game['id']}/turns",
        json={
            "request_id": "local-cast-1",
            "expected_state_version": 1,
            "action": "Спросить Миру",
        },
    )

    assert response.status_code == 201
    assert response.json()["speaker"] == "Мира"
    assert response.json()["visual_directive"]["outfit"] == "none"
    assert fake_provider.call_count == 1


def test_background_choice_survives_reload_and_rewind(client, fake_provider, akane_session):
    fake_provider.responses = [proposal(visual_directive={"emotion": "neutral", "background": "signal_archive"})]
    result = post_turn(client, akane_session)
    assert result.status_code == 201
    assert result.json()["visual_directive"]["background"] == "signal_archive"
    restored = client.get(f"/api/sessions/{akane_session.id}").json()
    assert restored["visual_state"]["background"] == "signal_archive"

    rewound = client.post(f"/api/sessions/{akane_session.id}/rewind", json={"expected_state_version": 2})
    assert rewound.status_code == 200
    assert rewound.json()["visual_state"]["background"] == "neon_crossroads"


def test_unknown_background_falls_back_to_last_known_location(client, fake_provider, akane_session):
    fake_provider.responses = [
        proposal(visual_directive={"emotion": "neutral", "background": "signal_archive"}),
        proposal(visual_directive={"emotion": "neutral", "background": "../../escape"}),
    ]
    assert post_turn(client, akane_session).status_code == 201
    second = post_turn(client, akane_session, request_id="turn-2", expected_state_version=2)
    assert second.status_code == 201
    assert second.json()["visual_directive"]["background"] == "signal_archive"


def test_rewind_then_new_action_keeps_both_branches(client, fake_provider, akane_session):
    fake_provider.responses = [
        proposal(dialogue={"character_id": "akane", "text": "Первая реплика"}),
        proposal(dialogue={"character_id": "akane", "text": "Старый путь"}),
        proposal(dialogue={"character_id": "akane", "text": "Новый путь"}),
    ]
    initial = client.get(f"/api/sessions/{akane_session.id}").json()
    assert initial["can_rewind"] is False
    first = post_turn(client, akane_session).json()
    old_branch = post_turn(client, akane_session, request_id="old-branch", expected_state_version=2).json()

    rewind = client.post(f"/api/sessions/{akane_session.id}/rewind", json={"expected_state_version": 3})
    assert rewind.status_code == 200
    assert rewind.json()["state_version"] == 4
    assert rewind.json()["latest_turn"]["id"] == first["id"]
    assert rewind.json()["can_rewind"] is True

    new_branch = post_turn(client, akane_session, request_id="new-branch", expected_state_version=4).json()
    replay = post_turn(client, akane_session, request_id="old-branch", expected_state_version=3)
    assert replay.status_code == 200
    assert replay.json()["id"] == old_branch["id"]
    restored = client.get(f"/api/sessions/{akane_session.id}").json()
    assert restored["latest_turn"]["id"] == new_branch["id"]
    assert restored["latest_turn"]["dialogue"] == "Новый путь"
    with Session(client.app.state.engine) as db:
        old = db.get(Turn, old_branch["id"])
        new = db.get(Turn, new_branch["id"])
        assert old.parent_turn_id == first["id"]
        assert new.parent_turn_id == first["id"]
        assert db.get(StorySession, akane_session.id).active_turn_id == new.id


def test_rewind_first_turn_restores_initial_scene_and_rejects_stale_revision(client, fake_provider, akane_session):
    start = client.post(f"/api/sessions/{akane_session.id}/rewind", json={"expected_state_version": 1})
    assert start.status_code == 422
    fake_provider.responses = [proposal()]
    assert post_turn(client, akane_session).status_code == 201

    stale = client.post(f"/api/sessions/{akane_session.id}/rewind", json={"expected_state_version": 1})
    assert stale.status_code == 409
    assert client.get(f"/api/sessions/{akane_session.id}").json()["latest_turn"] is not None

    rewound = client.post(f"/api/sessions/{akane_session.id}/rewind", json={"expected_state_version": 2})
    assert rewound.status_code == 200
    assert rewound.json()["latest_turn"] is None
    assert rewound.json()["current_scene"] == "Ночной перекрёсток"
    assert rewound.json()["visual_state"] == {
        "emotion": "neutral",
        "pose": "default",
        "outfit": "red_dress",
        "background": "neon_crossroads",
    }
    assert rewound.json()["can_rewind"] is False


def test_rewind_stops_after_ten_steps_and_preserves_all_turns(client, fake_provider, akane_session):
    fake_provider.responses = [proposal() for _ in range(11)]
    for index in range(11):
        result = post_turn(
            client,
            akane_session,
            request_id=f"advance-{index}",
            expected_state_version=index + 1,
        )
        assert result.status_code == 201
    for index in range(10):
        result = client.post(
            f"/api/sessions/{akane_session.id}/rewind",
            json={"expected_state_version": 12 + index},
        )
        assert result.status_code == 200
    assert result.json()["can_rewind"] is False
    denied = client.post(f"/api/sessions/{akane_session.id}/rewind", json={"expected_state_version": 22})
    assert denied.status_code == 422
    with Session(client.app.state.engine) as db:
        assert len(list(db.exec(select(Turn).where(Turn.session_id == akane_session.id)))) == 11


def test_new_branch_prompt_excludes_abandoned_future(client, fake_provider, akane_session, monkeypatch):
    fake_provider.responses = [proposal(), proposal(), proposal()]
    assert post_turn(client, akane_session).status_code == 201
    assert post_turn(client, akane_session, request_id="discarded", expected_state_version=2).status_code == 201
    rewound = client.post(f"/api/sessions/{akane_session.id}/rewind", json={"expected_state_version": 3})
    assert rewound.status_code == 200
    prompts = []
    generate = fake_provider.generate_turn

    def record(request):
        prompts.append(json.loads(request.user_prompt))
        return generate(request)

    monkeypatch.setattr(fake_provider, "generate_turn", record)
    assert post_turn(client, akane_session, request_id="alternative", expected_state_version=4).status_code == 201
    assert [turn["request_id"] for turn in prompts[0]["recent_turns"]] == ["turn-1"]


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


@pytest.mark.parametrize("failure", ["unavailable", "model_unavailable", "invalid_twice", "domain_invalid_twice"])
def test_late_duplicate_failure_replays_committed_winner(
    client,
    fake_provider,
    akane_session,
    monkeypatch,
    caplog,
    failure,
):
    entered = Event()
    winner_committed = Event()
    call_lock = Lock()
    call_count = 0

    def generate(request):
        nonlocal call_count
        with call_lock:
            call_count += 1
            call_number = call_count
        if call_number == 2:
            return proposal()
        entered.set()
        assert winner_committed.wait(timeout=10)
        if failure == "unavailable":
            raise ProviderUnavailableError(raw_response="PRIVATE DIAGNOSTIC")
        if failure == "model_unavailable":
            raise ProviderResponseError("model_unavailable", raw_response="PRIVATE DIAGNOSTIC")
        if failure == "domain_invalid_twice":
            return proposal(dialogue={"character_id": "PRIVATE DIAGNOSTIC", "text": "Текст"})
        raise ProviderResponseError(raw_response="PRIVATE DIAGNOSTIC")

    monkeypatch.setattr(fake_provider, "generate_turn", generate)
    with ThreadPoolExecutor(max_workers=1) as pool:
        outstanding_duplicate = pool.submit(post_turn, client, akane_session)
        try:
            assert entered.wait(timeout=10)
            winner = post_turn(client, akane_session)
        finally:
            winner_committed.set()
        replay = outstanding_duplicate.result(timeout=10)
    assert winner.status_code == 201
    assert replay.status_code == 200
    assert replay.json() == winner.json()
    assert call_count == (3 if failure.endswith("twice") else 2)
    assert "PRIVATE DIAGNOSTIC" not in replay.text + caplog.text
    with Session(client.app.state.engine) as db:
        assert db.get(StorySession, akane_session.id).state_version == 2
        assert len(list(db.exec(select(Turn).where(Turn.session_id == akane_session.id)))) == 1


@pytest.fixture()
def migrated_game(tmp_path):
    path = tmp_path / "legacy-story.db"
    create_v01_database(path, story_id="old-story", turn_id="old-turn")
    with sqlite3.connect(path) as connection:
        # Deliberately unrelated display names and insertion order: neither identifies the visual.
        connection.executemany(
            "INSERT INTO characters VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
                ("z-character", "old-story", "Narrator", 25, "Наблюдательная", "Красное платье", 1),
                ("a-character", "old-story", "Другое имя", 25, "Наблюдательная", "Красное платье", 1),
            ],
        )
    provider = FakeLLMProvider(provider_id="legacy")
    with TestClient(create_app(Settings(database_path=path), ProviderRegistry([provider]))) as legacy_client:
        with Session(legacy_client.app.state.engine) as db:
            game = db.exec(select(StorySession).where(StorySession.story_id == "old-story")).one()
            original = db.get(Turn, "old-turn").model_dump()
            game_id = game.id
        yield legacy_client, SimpleNamespace(id=game_id), provider, original


def test_migrated_legacy_replay_derives_character_without_rewriting_history(migrated_game):
    client, game, provider, original = migrated_game
    response = post_turn(client, game, request_id="legacy-request")
    assert response.status_code == 200
    assert response.json()["id"] == "old-turn"
    assert response.json()["speaker"] == "Narrator"
    assert response.json()["visual_directive"]["character_id"] == "a-character"
    assert provider.call_count == 0
    with Session(client.app.state.engine) as db:
        assert db.get(Turn, "old-turn").model_dump() == original
        assert db.get(StorySession, game.id).state_version == 2


def test_migrated_legacy_history_supports_next_strict_canonical_turn(migrated_game, monkeypatch):
    client, game, provider, original = migrated_game
    requests = []

    def generate(request):
        requests.append(request)
        return proposal(dialogue={"character_id": "z-character", "text": "Продолжим"})

    monkeypatch.setattr(provider, "generate_turn", generate)
    response = post_turn(client, game, request_id="next-turn", expected_state_version=2)
    assert response.status_code == 201
    assert response.json()["state_version"] == 3
    assert response.json()["visual_directive"]["character_id"] == "z-character"
    assert requests[0].model_id == "legacy"
    history = json.loads(requests[0].user_prompt)["recent_turns"]
    assert history[0]["visual_directive"]["character_id"] == "a-character"
    assert history[0]["dialogue"] == "Legacy dialogue"
    with Session(client.app.state.engine) as db:
        assert db.get(Turn, "old-turn").model_dump() == original
        turns = list(db.exec(select(Turn).where(Turn.session_id == game.id).order_by(Turn.state_version)))
        assert len(turns) == 2
        assert json.loads(turns[1].visual_directive)["character_id"] == "z-character"


def test_unrelated_integrity_abort_propagates_and_rolls_back(client, fake_provider, akane_session):
    fake_provider.responses = [proposal(narration="PRIVATE SQL DIAGNOSTIC")]
    with client.app.state.engine.begin() as connection:
        connection.execute(
            text("""
            CREATE TRIGGER reject_turn AFTER INSERT ON turns BEGIN
              SELECT RAISE(ABORT, 'unrelated integrity condition');
            END
        """)
        )
    with pytest.raises(IntegrityError, match="unrelated integrity condition") as raised:
        post_turn(client, akane_session)
    assert "PRIVATE SQL DIAGNOSTIC" not in "".join(traceback.format_exception(raised.value))
    assert_unchanged(client, akane_session)
