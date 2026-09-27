import json

import pytest
from sqlmodel import Session, select

from app.db.models import SessionBeat, StoryBeat, StorySession, Turn
from app.modules.providers.contracts import TurnProposal
from app.modules.story_authoring.runtime import RuntimeStoryDefinition
from app.modules.story_engine import repository
from app.modules.story_engine.contracts import TurnCreate
from app.modules.story_engine.prompt import build_prompt
from app.modules.story_engine.rules import GenerationContext, InvalidProposalError, validate_proposal


def runtime_story(
    *,
    mode="hybrid",
    ending_policy="required_beats_then_end",
    choice_policy="choices_and_free_input",
    min_choices=2,
    max_choices=4,
) -> RuntimeStoryDefinition:
    return RuntimeStoryDefinition.model_validate(
        {
            "story_id": "story",
            "version_id": "version",
            "version_number": 1,
            "title": "Тест",
            "slug": "test",
            "premise": "Сырой авторский текст",
            "description": "Описание",
            "cover_image_url": None,
            "mode": mode,
            "opening_situation": "Начало",
            "setting": "Город",
            "recommended_provider_id": "ollama",
            "recommended_model_id": "model",
            "generation_policy": {
                "narration_perspective": "first_person",
                "prose_density": "detailed",
                "choice_policy": choice_policy,
                "min_choices": min_choices,
                "max_choices": max_choices,
                "allow_romance": False,
                "allow_violence": True,
                "allow_horror": False,
                "allow_sexual_themes": False,
                "desired_themes": "Авторская тема",
                "forbidden_outcomes": "Авторский запрет",
            },
            "themes_allowed": [],
            "themes_blocked": [],
            "ending_policy": ending_policy,
            "creative_goals": "Импровизируй атмосферно",
            "facts": [
                {"id": "hard-1", "order_index": 0, "title": "Истина", "statement": "Луна красная", "severity": "hard"},
                {"id": "soft-1", "order_index": 1, "title": "Слух", "statement": "В башне призрак", "severity": "soft"},
            ],
            "beats": [
                {
                    "id": "beat-1",
                    "order_index": 0,
                    "title": "Ключ",
                    "description": "Найти ключ",
                    "completion_evidence": "Ключ в руке",
                    "required": True,
                    "ending_gate": True,
                },
                {
                    "id": "beat-2",
                    "order_index": 1,
                    "title": "Дверь",
                    "description": "Открыть дверь",
                    "activation_condition": {"kind": "after_beat", "beat_id": "beat-1"},
                },
            ],
            "hero_policy": "choice",
            "hero_allowed_sources": ["catalog"],
            "fixed_hero_revision_id": None,
            "cast": [],
            "character_revisions": [],
        }
    )


def context(*, mode="hybrid", completed=(), story=None) -> GenerationContext:
    return GenerationContext(
        session_id="session",
        active_turn_id=None,
        state_version=1,
        current_scene="Начало",
        provider_id="ollama",
        model_id="model",
        story=story or runtime_story(mode=mode),
        protagonist={"id": "hero", "name": "Герой", "available_emotions": ["neutral"]},
        characters=[{"id": "npc", "name": "НПС", "source_type": "local"}],
        recent_turns=[],
        completed_beat_ids=frozenset(completed),
        available_beat_ids=frozenset({"beat-1"}),
    )


def proposal(**changes) -> TurnProposal:
    data = {
        "segments": [{"kind": "dialogue", "character_id": "npc", "text": "Идём."}],
        "visual_directive": {"emotion": "neutral", "pose": "default", "outfit": "none"},
        "suggested_choices": ["Да", "Нет"],
        "proposed_effects": [],
        "canon_assessments": [{"fact_id": "hard-1", "status": "upheld", "evidence": "Луна остаётся красной"}],
        "completed_beat_ids": [],
        "requests_ending": False,
    }
    data.update(changes)
    return TurnProposal.model_validate(data)


def test_freeform_prompt_has_goals_without_beats_and_keeps_author_text_out_of_system():
    story = runtime_story(mode="freeform", ending_policy="open_ended").model_copy(update={"beats": []})
    ctx = context(mode="freeform")
    ctx = GenerationContext(**{**ctx.__dict__, "story": story, "available_beat_ids": frozenset()})
    request = build_prompt(ctx, TurnCreate(request_id="one", expected_state_version=1, action="Ждать"), 4096)
    payload = json.loads(request.user_prompt)
    assert payload["story"]["creative_goals"] == "Импровизируй атмосферно"
    assert "available_beats" not in payload
    assert "Сырой авторский текст" not in request.system_prompt


def test_hybrid_prompt_orders_facts_and_only_includes_available_beats():
    request = build_prompt(context(), TurnCreate(request_id="one", expected_state_version=1, action="Ждать"), 4096)
    payload = json.loads(request.user_prompt)
    assert [fact["id"] for fact in payload["hard_facts"]] == ["hard-1"]
    assert [fact["id"] for fact in payload["soft_facts"]] == ["soft-1"]
    assert [beat["id"] for beat in payload["available_beats"]] == ["beat-1"]
    assert payload["available_beats"][0]["completion_evidence"] == "Ключ в руке"
    assert "рекомендац" in request.system_prompt.casefold()
    assert "провер" in request.system_prompt.casefold()


@pytest.mark.parametrize(
    ("choice_policy", "minimum", "maximum"),
    [
        ("free_input_only", 0, 0),
        ("choices_only", 1, 1),
        ("choices_and_free_input", 6, 6),
    ],
)
def test_prompt_and_schema_enforce_pinned_generation_policy(choice_policy, minimum, maximum):
    story = runtime_story(
        choice_policy=choice_policy,
        min_choices=minimum if choice_policy != "free_input_only" else 2,
        max_choices=maximum if choice_policy != "free_input_only" else 4,
    )
    request = build_prompt(
        context(story=story),
        TurnCreate(request_id="policy", expected_state_version=1, action="Продолжить"),
        4096,
    )
    choices = request.response_schema["properties"]["suggested_choices"]
    assert (choices["minItems"], choices["maxItems"]) == (minimum, maximum)
    assert choice_policy in request.system_prompt
    assert "first_person" in request.system_prompt
    assert "detailed" in request.system_prompt
    assert "allow_romance=false" in request.system_prompt
    assert "allow_violence=true" in request.system_prompt
    assert "allow_horror=false" in request.system_prompt
    assert "allow_sexual_themes=false" in request.system_prompt
    assert story.ending_policy in request.system_prompt
    assert f"{minimum}..{maximum}" in request.system_prompt
    assert "Авторская тема" not in request.system_prompt
    assert "Авторский запрет" not in request.system_prompt
    payload = json.loads(request.user_prompt)
    assert payload["story"]["generation_policy"]["desired_themes"] == "Авторская тема"
    assert payload["story"]["generation_policy"]["forbidden_outcomes"] == "Авторский запрет"


@pytest.mark.parametrize(
    ("choice_policy", "minimum", "maximum", "choices", "accepted"),
    [
        ("free_input_only", 2, 4, [], True),
        ("free_input_only", 2, 4, ["Лишний выбор"], False),
        ("choices_only", 1, 1, ["Один"], True),
        ("choices_only", 1, 1, [], False),
        ("choices_and_free_input", 6, 6, ["1", "2", "3", "4", "5", "6"], True),
        ("choices_and_free_input", 6, 6, ["1", "2", "3", "4", "5"], False),
    ],
)
def test_choice_validation_uses_pinned_policy(choice_policy, minimum, maximum, choices, accepted):
    story = runtime_story(choice_policy=choice_policy, min_choices=minimum, max_choices=maximum)
    candidate = proposal(suggested_choices=choices)
    if accepted:
        assert validate_proposal(candidate, context(story=story)).choices == choices
    else:
        with pytest.raises(InvalidProposalError, match="choice_count_out_of_policy"):
            validate_proposal(candidate, context(story=story))


@pytest.mark.parametrize(
    ("changes", "code"),
    [
        ({"canon_assessments": []}, "missing_hard_fact_assessment"),
        (
            {
                "canon_assessments": [
                    {"fact_id": "hard-1", "status": "upheld", "evidence": "a"},
                    {"fact_id": "hard-1", "status": "upheld", "evidence": "b"},
                ]
            },
            "duplicate_hard_fact_assessment",
        ),
        (
            {"canon_assessments": [{"fact_id": "unknown", "status": "upheld", "evidence": "a"}]},
            "unknown_hard_fact_assessment",
        ),
        (
            {"canon_assessments": [{"fact_id": "hard-1", "status": "violated", "evidence": "сломано"}]},
            "hard_fact_violated",
        ),
        ({"completed_beat_ids": ["unknown"]}, "unknown_beat"),
        ({"completed_beat_ids": ["beat-2"]}, "locked_beat"),
        ({"requests_ending": True}, "ending_gate_not_satisfied"),
    ],
)
def test_hybrid_proposals_are_validated_deterministically(changes, code):
    with pytest.raises(InvalidProposalError, match=code):
        validate_proposal(proposal(**changes), context())


def test_freeform_ignores_authored_canon_contract_but_keeps_base_safety_rules():
    accepted = validate_proposal(proposal(canon_assessments=[], completed_beat_ids=[]), context(mode="freeform"))
    assert accepted.completed_beat_ids == []
    unsafe = proposal(
        segments=[
            {"kind": "narration", "text": "Ты решил уйти."},
            {"kind": "dialogue", "character_id": "npc", "text": "Стой."},
        ],
        canon_assessments=[],
    )
    with pytest.raises(InvalidProposalError, match="protagonist_action_forbidden"):
        validate_proposal(unsafe, context(mode="freeform"))


def test_duplicate_already_completed_beat_is_rejected():
    with pytest.raises(InvalidProposalError, match="duplicate_beat_completion"):
        validate_proposal(proposal(completed_beat_ids=["beat-1"]), context(completed=("beat-1",)))


def test_ending_gate_only_requires_beats_with_both_required_and_gate_flags():
    story = runtime_story()
    beats = [
        story.beats[0].model_copy(update={"id": "both", "required": True, "ending_gate": True}),
        story.beats[0].model_copy(update={"id": "required-only", "required": True, "ending_gate": False}),
        story.beats[0].model_copy(update={"id": "gate-only", "required": False, "ending_gate": True}),
    ]
    story = story.model_copy(update={"beats": beats})
    ctx = context(story=story, completed=("required-only", "gate-only"))
    ctx = GenerationContext(**{**ctx.__dict__, "available_beat_ids": frozenset({"both"})})
    accepted = validate_proposal(proposal(completed_beat_ids=["both"], requests_ending=True), ctx)
    assert accepted.completed_beat_ids == ["both"]

    blocked = context(story=story, completed=("required-only", "gate-only"))
    with pytest.raises(InvalidProposalError, match="ending_gate_not_satisfied"):
        validate_proposal(proposal(requests_ending=True), blocked)


def _game_proposal(*, completed_beat_ids):
    return TurnProposal.model_validate(
        {
            "segments": [{"kind": "dialogue", "character_id": "akane", "text": "Ключ найден."}],
            "visual_directive": {"emotion": "neutral", "pose": "default", "outfit": "red_dress"},
            "suggested_choices": ["Продолжить", "Осмотреться"],
            "proposed_effects": [],
            "canon_assessments": [],
            "completed_beat_ids": completed_beat_ids,
            "requests_ending": False,
        }
    )


def _install_beat(client, game, *, beat_id="test-beat", condition='{"kind":"always"}', order_index=0):
    with Session(client.app.state.engine) as db:
        persisted = db.get(StorySession, game.id)
        db.add(
            StoryBeat(
                id=beat_id,
                version_id=persisted.story_version_id,
                order_index=order_index,
                title="Ключ",
                description="Найти ключ",
                activation_condition=condition,
                completion_evidence="Ключ найден",
            )
        )
        db.commit()


def test_completed_beat_is_written_atomically_with_accepted_turn(client, fake_provider, akane_session):
    _install_beat(client, akane_session)
    with Session(client.app.state.engine) as db:
        db.add(SessionBeat(session_id=akane_session.id, beat_id="test-beat", status="available"))
        db.commit()
    fake_provider.responses = [_game_proposal(completed_beat_ids=["test-beat"])]
    response = client.post(
        f"/api/sessions/{akane_session.id}/turns",
        json={"request_id": "beat-turn", "expected_state_version": 1, "action": "Поднять ключ"},
    )
    assert response.status_code == 201
    with Session(client.app.state.engine) as db:
        saved = db.get(SessionBeat, (akane_session.id, "test-beat"))
        assert saved.status == "completed"
        assert saved.completed_turn_id == response.json()["id"]


def test_two_invalid_proposals_leave_turn_and_beats_unchanged(client, fake_provider, akane_session):
    _install_beat(client, akane_session)
    fake_provider.responses = [
        _game_proposal(completed_beat_ids=["unknown"]),
        _game_proposal(completed_beat_ids=["unknown"]),
    ]
    response = client.post(
        f"/api/sessions/{akane_session.id}/turns",
        json={"request_id": "bad-beat", "expected_state_version": 1, "action": "Продолжить"},
    )
    assert response.status_code == 502
    with Session(client.app.state.engine) as db:
        assert list(db.exec(select(Turn).where(Turn.session_id == akane_session.id))) == []
        assert list(db.exec(select(SessionBeat).where(SessionBeat.session_id == akane_session.id))) == []


def test_rewind_relocks_dependent_beats_and_alternate_branch_recompletion_moves_marker(
    client, fake_provider, akane_session
):
    _install_beat(client, akane_session, beat_id="beat-a")
    _install_beat(
        client,
        akane_session,
        beat_id="beat-b",
        condition='{"kind":"after_beat","beat_id":"beat-a"}',
        order_index=1,
    )
    fake_provider.responses = [_game_proposal(completed_beat_ids=["beat-a"])]
    first = client.post(
        f"/api/sessions/{akane_session.id}/turns",
        json={"request_id": "first-a", "expected_state_version": 1, "action": "Найти ключ"},
    )
    assert first.status_code == 201
    rewound = client.post(
        f"/api/sessions/{akane_session.id}/rewind",
        json={"expected_state_version": 2},
    )
    assert rewound.status_code == 200
    with Session(client.app.state.engine) as db:
        branch = repository.load_context(db, akane_session.id, 3)
    assert branch.completed_beat_ids == frozenset()
    assert branch.available_beat_ids == frozenset({"beat-a"})

    fake_provider.responses = [_game_proposal(completed_beat_ids=["beat-a"])]
    alternate = client.post(
        f"/api/sessions/{akane_session.id}/turns",
        json={"request_id": "alternate-a", "expected_state_version": 3, "action": "Найти другой ключ"},
    )
    assert alternate.status_code == 201
    with Session(client.app.state.engine) as db:
        marker = db.get(SessionBeat, (akane_session.id, "beat-a"))
        branch = repository.load_context(db, akane_session.id, 4)
    assert marker.completed_turn_id == alternate.json()["id"]
    assert branch.completed_beat_ids == frozenset({"beat-a"})
    assert branch.available_beat_ids == frozenset({"beat-b"})
