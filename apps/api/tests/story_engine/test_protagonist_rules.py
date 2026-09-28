import json
from dataclasses import replace

import pytest
from sqlmodel import Session

from app.db.models import Character, Story, StoryVersion
from app.modules.providers.contracts import TurnProposal
from app.modules.story_engine.contracts import TurnCreate
from app.modules.story_engine.prompt import build_prompt
from app.modules.story_engine.repository import load_context
from app.modules.story_engine.rules import InvalidProposalError, validate_proposal


def playable_akane_game(client):
    story = client.get("/api/stories").json()[0]
    with Session(client.app.state.engine) as session:
        row = session.get(Story, story["id"])
        version = session.get(StoryVersion, row.current_published_version_id)
        version.hero_policy = "fixed"
        version.fixed_hero_revision_id = session.get(Character, "akane").current_revision_id
        session.commit()
    result = client.post(
        f"/api/stories/{story['id']}/sessions",
        json={"provider_id": "ollama", "hero": {"source_kind": "fixed"}},
    )
    assert result.status_code == 201
    return result.json()


def test_generation_context_separates_player_hero_from_npcs(client):
    game = playable_akane_game(client)
    with Session(client.app.state.engine) as session:
        context = load_context(session, game["id"], 1)

    assert context.protagonist["name"] == "Аканэ Куроха"
    assert [item["id"] for item in context.characters] == ["mark"]
    prompt = build_prompt(
        context,
        TurnCreate(request_id="scene-1", expected_state_version=1, action="Спросить Марка о сигнале"),
        8192,
    )
    payload = json.loads(prompt.user_prompt)
    assert payload["protagonist"]["name"] == "Аканэ Куроха"
    assert [character["id"] for character in payload["characters"]] == ["mark"]
    assert "не придумывай действия и реплики героя игрока" in prompt.system_prompt
    assert '"id": "mark"' not in prompt.system_prompt
    assert "character_id: 'akane'" not in prompt.system_prompt
    assert "Для Аканэ используй" not in prompt.system_prompt
    assert '"character_id": "mark"' not in prompt.system_prompt


def test_prompt_does_not_require_every_present_npc_to_speak(client, akane_session):
    with Session(client.app.state.engine) as session:
        context = load_context(session, akane_session.id, 1)

    prompt = build_prompt(
        context,
        TurnCreate(request_id="scene-ensemble", expected_state_version=1, action="Обращаюсь к Марку"),
        8192,
    )

    assert len(context.characters) == 2
    assert "Обычно выбирай одного говорящего NPC" in prompt.system_prompt
    assert "Молчащий NPC может оставаться в present_character_ids" in prompt.system_prompt
    assert "Не добавляй второму NPC реплику" in prompt.system_prompt
    assert "не чередуй их механически" in prompt.system_prompt
    assert "Для Марка (id: mark) используй outfit: dark_coat, pose: default" in prompt.system_prompt


def test_player_thought_is_structured_and_hero_emotion_is_limited_to_saved_sprites(client, akane_session):
    with Session(client.app.state.engine) as session:
        loaded = load_context(session, akane_session.id, 1)
    context = replace(loaded, protagonist={**loaded.protagonist, "available_emotions": ["neutral", "surprised"]})
    prompt = build_prompt(
        context,
        TurnCreate(request_id="scene-2", expected_state_version=1, action="Я смутилась. «Всё хорошо» (Она заметила?)"),
        8192,
    )
    payload = json.loads(prompt.user_prompt)
    assert payload["player_parts"] == [
        {"kind": "action", "text": "Я смутилась."},
        {"kind": "speech", "text": "Всё хорошо"},
        {"kind": "thought", "text": "Она заметила?"},
    ]
    assert "NPC не слышат и не знают thought" in prompt.system_prompt
    hero_emotions = prompt.response_schema["$defs"]["VisualDirective"]["properties"]["protagonist_emotion"]["enum"]
    assert hero_emotions == ("neutral", "surprised")

    base = {
        "segments": [
            {"kind": "narration", "text": "Марк отвёл взгляд."},
            {"kind": "dialogue", "character_id": "mark", "text": "Вы в порядке?"},
        ],
        "suggested_choices": ["Ответить", "Промолчать"],
        "proposed_effects": [],
    }
    allowed = context.protagonist["available_emotions"]
    assert allowed == ["neutral", "surprised"]
    accepted = validate_proposal(
        TurnProposal.model_validate(
            {
                **base,
                "visual_directive": {
                    "emotion": "neutral",
                    "pose": "default",
                    "outfit": "dark_coat",
                    "protagonist_emotion": "neutral",
                },
            }
        ),
        context,
    )
    assert accepted.visual_directive.protagonist_emotion == "neutral"
    emotional = validate_proposal(
        TurnProposal.model_validate(
            {
                **base,
                "visual_directive": {
                    "emotion": "neutral",
                    "pose": "default",
                    "outfit": "dark_coat",
                    "protagonist_emotion": "surprised",
                },
            }
        ),
        context,
    )
    assert emotional.visual_directive.protagonist_emotion == "surprised"
    unsupported = validate_proposal(
        TurnProposal.model_validate(
            {
                **base,
                "visual_directive": {
                    "emotion": "neutral",
                    "pose": "default",
                    "outfit": "dark_coat",
                    "protagonist_emotion": "not_uploaded",
                },
            }
        ),
        context,
    )
    assert unsupported.visual_directive.protagonist_emotion == "neutral"


def test_model_cannot_give_player_hero_a_dialogue_segment(client):
    game = playable_akane_game(client)
    with Session(client.app.state.engine) as session:
        context = load_context(session, game["id"], 1)
    proposal = TurnProposal.model_validate(
        {
            "segments": [
                {"kind": "narration", "text": "Марк отступает от двери."},
                {"kind": "dialogue", "character_id": "akane", "text": "Я открою её."},
            ],
            "visual_directive": {"emotion": "neutral", "pose": "default", "outfit": "dark_coat"},
            "suggested_choices": ["Спросить Марка", "Осмотреть дверь"],
            "proposed_effects": [],
        }
    )

    with pytest.raises(InvalidProposalError):
        validate_proposal(proposal, context)


def test_model_cannot_assign_an_explicit_decision_to_player_in_narration(client):
    game = playable_akane_game(client)
    with Session(client.app.state.engine) as session:
        context = load_context(session, game["id"], 1)
    proposal = TurnProposal.model_validate(
        {
            "segments": [
                {"kind": "narration", "text": "Ты решила открыть дверь, хотя Марк предупреждал об опасности."},
                {"kind": "dialogue", "character_id": "mark", "text": "Подожди, я слышу шаги."},
            ],
            "visual_directive": {"emotion": "neutral", "pose": "default", "outfit": "dark_coat"},
            "suggested_choices": ["Выслушать Марка", "Осмотреть замок"],
            "proposed_effects": [],
        }
    )

    with pytest.raises(InvalidProposalError, match="protagonist_action_forbidden"):
        validate_proposal(proposal, context)
