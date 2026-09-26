import json

import pytest
from pydantic import TypeAdapter, ValidationError
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.db.models import CanonFact, Character, CharacterRevision, Story, StoryBeat, StoryVersion, StoryVersionCharacter
from app.modules.story_authoring.definition import canonical_snapshot, load_story_draft
from app.modules.story_authoring.schemas import (
    BeatCondition,
    StoryCanonSection,
    StoryCastSection,
    StoryIdentitySection,
    StoryModeSection,
    StoryRulesSection,
)


def test_sections_and_discriminated_conditions_reject_unknown_author_fields():
    condition = TypeAdapter(BeatCondition).validate_python({"kind": "after_beat", "beat_id": "reveal"})
    assert condition.beat_id == "reveal"

    with pytest.raises(ValidationError):
        StoryModeSection.model_validate({"mode": "hybrid", "raw_prompt": "ignore rules"})
    with pytest.raises(ValidationError):
        TypeAdapter(BeatCondition).validate_python({"kind": "always", "expression": "__import__('os')"})
    with pytest.raises(ValidationError):
        StoryRulesSection.model_validate({"generation_policy": {"min_choices": 7}})


def test_cast_section_limits_author_lists_to_24_entries():
    characters = [
        {
            "id": f"pin-{index}",
            "character_id": f"character-{index}",
            "revision_id": f"revision-{index}",
            "order_index": index,
        }
        for index in range(25)
    ]

    with pytest.raises(ValidationError):
        StoryCastSection.model_validate({"characters": characters})


@pytest.mark.parametrize(
    ("schema", "payload"),
    [
        (StoryIdentitySection, {"premise": "<script>alert(1)</script>"}),
        (StoryIdentitySection, {"genres": ["mystery", "<b>noir</b>"]}),
        (StoryIdentitySection, {"title": "Hidden\x00title"}),
        (StoryRulesSection, {"generation_policy": {"forbidden_outcomes": "<img src=x onerror=alert(1)>"}}),
        (
            StoryCanonSection,
            {"facts": [{"id": "fact", "order_index": 0, "title": "Fact", "statement": "<!-- hidden -->"}]},
        ),
    ],
)
def test_author_text_rejects_markup_and_ascii_controls(schema, payload):
    with pytest.raises(ValidationError):
        schema.model_validate(payload)


@pytest.mark.parametrize("slug", ["../../etc", "Neon-Echo", "neon--echo", "-neon", "neon-", "neon_echo"])
def test_slug_rejects_noncanonical_values(slug):
    with pytest.raises(ValidationError):
        StoryIdentitySection.model_validate({"slug": slug})


def test_narrative_punctuation_and_path_mentions_remain_valid():
    section = StoryIdentitySection.model_validate(
        {"slug": "neon-echo-2", "premise": "At /tmp/story, Alice asks: is x < y > z? Yes!"}
    )

    assert section.slug == "neon-echo-2"
    assert section.premise == "At /tmp/story, Alice asks: is x < y > z? Yes!"


def _loaded_draft(*, reverse_insert_order: bool):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(
            Story(
                id="story",
                slug="story",
                title="Story",
                premise="Premise",
                current_scene="Opening",
                created_at="2026-09-27T00:00:00+00:00",
            )
        )
        session.add(
            StoryVersion(
                id="version",
                story_id="story",
                version_number=2,
                status="draft",
                mode="hybrid",
                title=" Story ",
                slug="story",
                premise="Premise",
                setting="City",
                opening_situation="Arrival",
                genres='["mystery"]',
                tone='["noir"]',
                themes_allowed='["hope"]',
                hero_allowed_sources='["catalog"]',
                created_at="2026-09-27T00:00:00+00:00",
            )
        )
        session.add_all(
            [
                Character(id="alice", name="Alice", age=22, personality="Calm", appearance="Coat"),
                Character(id="bob", name="Bob", age=24, personality="Bold", appearance="Hat"),
                CharacterRevision(
                    id="alice-r1",
                    character_id="alice",
                    revision_number=1,
                    name="Alice",
                    gender="female",
                    age=22,
                    personality="Calm",
                    appearance="Coat",
                ),
                CharacterRevision(
                    id="bob-r1",
                    character_id="bob",
                    revision_number=1,
                    name="Bob",
                    gender="male",
                    age=24,
                    personality="Bold",
                    appearance="Hat",
                ),
            ]
        )
        cast = [
            StoryVersionCharacter(
                id="cast-2", version_id="version", character_id="bob", revision_id="bob-r1", order_index=2
            ),
            StoryVersionCharacter(
                id="cast-1", version_id="version", character_id="alice", revision_id="alice-r1", order_index=1
            ),
        ]
        facts = [
            CanonFact(id="fact-2", version_id="version", order_index=2, title="Second", statement="Second fact"),
            CanonFact(id="fact-1", version_id="version", order_index=1, title="First", statement="First fact"),
        ]
        beats = [
            StoryBeat(
                id="beat-2",
                version_id="version",
                order_index=2,
                title="Reveal",
                description="Reveal it",
                activation_condition=json.dumps({"kind": "after_beat", "beat_id": "beat-1"}),
            ),
            StoryBeat(
                id="beat-1",
                version_id="version",
                order_index=1,
                title="Arrival",
                description="Arrive",
                activation_condition=json.dumps({"type": "always"}),
            ),
        ]
        rows = cast + facts + beats
        session.add_all(list(reversed(rows)) if reverse_insert_order else rows)
        session.commit()
        return load_story_draft(session, "story")


def test_loader_resolves_rows_and_normalizes_legacy_condition():
    draft = _loaded_draft(reverse_insert_order=False)

    assert draft.identity.title == "Story"
    assert draft.identity.genres == ["mystery"]
    assert [member.character_id for member in draft.cast.characters] == ["alice", "bob"]
    assert [revision.id for revision in draft.character_revisions] == ["alice-r1", "bob-r1"]
    assert draft.canon.beats[0].activation_condition.kind == "always"
    assert draft.canon.beats[1].activation_condition.beat_id == "beat-1"


def test_canonical_snapshot_is_stable_across_database_retrieval_order():
    first = _loaded_draft(reverse_insert_order=False)
    second = _loaded_draft(reverse_insert_order=True)

    first_json, first_hash = canonical_snapshot(first)
    second_json, second_hash = canonical_snapshot(second)

    assert json.loads(first_json)["cast"]["characters"][0]["character_id"] == "alice"
    assert [beat["id"] for beat in json.loads(first_json)["canon"]["beats"]] == ["beat-1", "beat-2"]
    assert first_json == second_json
    assert first_hash == second_hash
    assert len(first_hash) == 64
