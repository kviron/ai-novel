from __future__ import annotations

import pytest

from app.modules.story_authoring.lint import validate_draft
from app.modules.story_authoring.schemas import (
    AfterBeatCondition,
    CanonFactDefinition,
    CharacterRevisionSnapshot,
    StoryBeatDefinition,
    StoryCanonSection,
    StoryCastMember,
    StoryCastSection,
    StoryDraft,
    StoryHeroSection,
    StoryIdentitySection,
    StoryModeSection,
    StoryRulesSection,
)


@pytest.fixture
def valid_hybrid_draft():
    return StoryDraft(
        story_id="story",
        version_id="version",
        version_number=1,
        status="draft",
        draft_revision=1,
        rules_version=1,
        created_at="2026-09-27T00:00:00+00:00",
        identity=StoryIdentitySection(
            title="Story", slug="story", premise="Premise", setting="City", opening_situation="Arrival"
        ),
        mode=StoryModeSection(mode="hybrid"),
        hero=StoryHeroSection(hero_allowed_sources=["catalog"]),
        cast=StoryCastSection(
            characters=[
                StoryCastMember(id="pin", character_id="alice", revision_id="alice-r1", order_index=0, playable=True)
            ]
        ),
        rules=StoryRulesSection(),
        canon=StoryCanonSection(
            facts=[
                CanonFactDefinition(id="fact", order_index=0, title="Truth", statement="It is raining", severity="hard")
            ],
            beats=[
                StoryBeatDefinition(
                    id="beat-1", order_index=0, title="Arrival", description="Arrive", required=True, ending_gate=True
                )
            ],
        ),
        character_revisions=[
            CharacterRevisionSnapshot(
                id="alice-r1",
                character_id="alice",
                revision_number=1,
                name="Alice",
                gender="female",
                age=22,
                personality="Calm",
                appearance="Coat",
            )
        ],
    )


def _extra_beat(draft):
    draft.canon.beats.append(StoryBeatDefinition(id="beat-2", order_index=1, title="Reveal", description="Reveal"))


def _forward_beat(draft):
    draft.canon.beats[0].activation_condition = AfterBeatCondition(kind="after_beat", beat_id="beat-2")
    _extra_beat(draft)


def _cycle(draft):
    _extra_beat(draft)
    draft.canon.beats[0].activation_condition = AfterBeatCondition(kind="after_beat", beat_id="beat-2")
    draft.canon.beats[1].activation_condition = AfterBeatCondition(kind="after_beat", beat_id="beat-1")


def _mismatched_revision(draft):
    draft.character_revisions.append(
        draft.character_revisions[0].model_copy(update={"id": "bob-r1", "character_id": "bob"})
    )
    draft.cast.characters[0].revision_id = "bob-r1"


@pytest.mark.parametrize(
    ("mutation", "code"),
    [
        (lambda d: setattr(d.identity, "title", ""), "identity_title_required"),
        (lambda d: setattr(d.identity, "slug", ""), "identity_slug_required"),
        (lambda d: setattr(d.identity, "premise", ""), "identity_premise_required"),
        (lambda d: setattr(d.identity, "setting", ""), "identity_setting_required"),
        (lambda d: setattr(d.identity, "opening_situation", ""), "identity_opening_situation_required"),
        (lambda d: setattr(d.hero, "hero_allowed_sources", []), "hero_source_required"),
        (
            lambda d: (setattr(d.hero, "hero_policy", "fixed"), setattr(d.hero, "fixed_hero_revision_id", None)),
            "hero_fixed_revision_required",
        ),
        (
            lambda d: (setattr(d.hero, "hero_policy", "fixed"), setattr(d.hero, "fixed_hero_revision_id", "alice-r1")),
            "hero_fixed_cast_conflict",
        ),
        (lambda d: setattr(d.cast.characters[0], "revision_id", "missing"), "cast_revision_missing"),
        (_mismatched_revision, "cast_revision_character_mismatch"),
        (lambda d: setattr(d.character_revisions[0], "age", 17), "cast_character_underage"),
        (lambda d: (setattr(d.canon, "facts", []), setattr(d.canon, "beats", [])), "hybrid_structure_required"),
        (lambda d: d.canon.facts.append(d.canon.facts[0].model_copy()), "fact_id_duplicate"),
        (lambda d: d.canon.beats.append(d.canon.beats[0].model_copy(update={"id": "beat-2"})), "beat_order_duplicate"),
        (lambda d: d.canon.beats.append(d.canon.beats[0].model_copy()), "beat_id_duplicate"),
        (_forward_beat, "beat_dependency_not_prior"),
        (_cycle, "beat_dependency_cycle"),
        (
            lambda d: setattr(
                d.canon.beats[0], "activation_condition", AfterBeatCondition(kind="after_beat", beat_id="missing")
            ),
            "beat_dependency_missing",
        ),
        (
            lambda d: (
                setattr(d.rules, "ending_policy", "required_beats_then_end"),
                setattr(d.canon.beats[0], "ending_gate", False),
            ),
            "ending_gate_required",
        ),
        (lambda d: setattr(d.rules.generation_policy, "min_choices", 5), "choice_count_invalid"),
        (lambda d: setattr(d.rules.generation_policy, "choice_policy", "free_input_only"), "choice_count_invalid"),
        (lambda d: (d.rules.themes_allowed.append("Hope"), d.rules.themes_blocked.append("hope")), "theme_overlap"),
        (lambda d: setattr(d.rules, "recommended_provider_id", "remote"), "provider_unsupported"),
        (lambda d: setattr(d.rules, "recommended_model_id", ""), "model_identifier_required"),
        (lambda d: d.canon.facts[0].referenced_character_ids.append("missing"), "fact_character_missing"),
    ],
)
def test_lint_reports_stable_code(valid_hybrid_draft, mutation, code):
    mutation(valid_hybrid_draft)
    result = validate_draft(valid_hybrid_draft, ["qwen3:14b-q4_K_M"])
    assert code in {item.code for item in result.diagnostics}
    assert not result.valid


def test_freeform_rejects_hybrid_only_content(valid_hybrid_draft):
    valid_hybrid_draft.mode.mode = "freeform"
    result = validate_draft(valid_hybrid_draft, ["qwen3:14b-q4_K_M"])
    assert {item.code for item in result.diagnostics} >= {"freeform_fact_forbidden", "freeform_beat_forbidden"}


def test_diagnostics_have_stable_step_field_item_order(valid_hybrid_draft):
    valid_hybrid_draft.identity.title = ""
    valid_hybrid_draft.canon.beats[0].activation_condition = AfterBeatCondition(kind="after_beat", beat_id="missing")
    result = validate_draft(valid_hybrid_draft, ["qwen3:14b-q4_K_M"])
    errors = [item for item in result.diagnostics if item.severity == "error"]
    assert errors[0].code == "identity_title_required"
    assert errors[-1].step == "canon"
    assert errors[-1].item_id == "beat-1"


def test_warnings_permit_publication(valid_hybrid_draft):
    valid_hybrid_draft.identity.cover_material_id = None
    valid_hybrid_draft.cast.characters = []
    valid_hybrid_draft.character_revisions = []
    valid_hybrid_draft.canon.facts[0].severity = "hard"
    result = validate_draft(valid_hybrid_draft, [])
    assert result.valid
    assert {item.code for item in result.diagnostics} >= {
        "cover_missing",
        "cast_optional_empty",
        "soft_guidance_missing",
        "model_unavailable",
    }


def test_missing_cast_revision_pin_is_an_error(valid_hybrid_draft):
    valid_hybrid_draft.cast.characters[0].revision_id = ""
    result = validate_draft(valid_hybrid_draft, ["qwen3:14b-q4_K_M"])
    assert "cast_revision_missing" in {item.code for item in result.diagnostics}


def test_non_ai_playable_fixed_protagonist_is_permitted(valid_hybrid_draft):
    valid_hybrid_draft.hero.hero_policy = "fixed"
    valid_hybrid_draft.hero.fixed_hero_revision_id = "alice-r1"
    valid_hybrid_draft.cast.characters[0].role = "protagonist"
    result = validate_draft(valid_hybrid_draft, ["qwen3:14b-q4_K_M"])
    assert result.valid
