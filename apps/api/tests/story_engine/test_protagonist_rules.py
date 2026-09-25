import json

import pytest
from sqlmodel import Session

from app.db.models import Character, Story
from app.modules.providers.contracts import TurnProposal
from app.modules.story_engine.contracts import TurnCreate
from app.modules.story_engine.prompt import build_prompt
from app.modules.story_engine.repository import load_context
from app.modules.story_engine.rules import InvalidProposalError, validate_proposal


def playable_akane_game(client):
    story = client.get("/api/stories").json()[0]
    with Session(client.app.state.engine) as session:
        row = session.get(Story, story["id"])
        row.hero_policy = "fixed"
        row.fixed_hero_revision_id = session.get(Character, "akane").current_revision_id
        row.playable_character_ids = json.dumps(["akane"])
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
    assert '"protagonist"' in prompt.system_prompt
    assert "не придумывай действия и реплики героя игрока" in prompt.system_prompt
    assert '"id": "mark"' in prompt.system_prompt
    assert "character_id: 'akane'" not in prompt.system_prompt
    assert "Для Аканэ используй" not in prompt.system_prompt
    assert '"character_id": "mark"' in prompt.system_prompt


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
