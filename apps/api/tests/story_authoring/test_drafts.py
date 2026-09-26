from __future__ import annotations

import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.db.models import CanonFact, Character, CharacterRevision, Story, StoryVersion
from app.modules.story_authoring.schemas import (
    CanonFactDefinition,
    StoryBeatDefinition,
    StoryCanonSection,
    StoryCastMember,
    StoryCastSection,
    StoryIdentitySection,
    StoryModeSection,
)
from app.modules.story_authoring.service import (
    DraftConflictError,
    DraftInvalidError,
    ModeChangeConflictError,
    create_draft_from_version,
    create_story_draft,
    publish_draft,
    replace_draft_section,
    validate_story_draft,
)


@pytest.fixture
def session():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    with Session(engine) as db:
        yield db
    engine.dispose()


def _valid_identity(slug="one"):
    return StoryIdentitySection(title="One", slug=slug, premise="Premise", setting="City", opening_situation="Arrival")


def _save(session, draft, section, payload, **kwargs):
    return replace_draft_section(session, draft.story_id, section, payload, draft.draft_revision, **kwargs)


def _publishable(session):
    draft = create_story_draft(session)
    draft = _save(session, draft, "identity", _valid_identity())
    return draft


def test_create_defaults_and_persists_story_and_one_draft(session):
    draft = create_story_draft(session)
    assert draft.version_number == 1
    assert draft.draft_revision == 1
    assert draft.mode.mode == "freeform"
    assert draft.status == "draft"
    assert session.get(Story, draft.story_id) is not None
    assert len(session.exec(select(StoryVersion).where(StoryVersion.story_id == draft.story_id)).all()) == 1


def test_identical_section_replacement_is_idempotent(session):
    draft = create_story_draft(session)
    first = _save(session, draft, "identity", _valid_identity())
    second = _save(session, first, "identity", _valid_identity())
    assert first.draft_revision == 2
    assert second.draft_revision == 2


def test_stale_revision_conflicts_with_latest_revision(session):
    draft = create_story_draft(session)
    current = _save(session, draft, "identity", _valid_identity())
    with pytest.raises(DraftConflictError) as raised:
        replace_draft_section(session, draft.story_id, "identity", _valid_identity("two"), draft.draft_revision)
    assert raised.value.latest_revision == current.draft_revision
    assert session.get(StoryVersion, draft.version_id).slug == "one"


def test_mode_change_requires_confirmation_before_dropping_canon(session):
    draft = create_story_draft(session)
    draft = _save(session, draft, "mode", StoryModeSection(mode="hybrid"))
    draft = _save(
        session,
        draft,
        "canon",
        StoryCanonSection(facts=[CanonFactDefinition(id="fact", order_index=0, title="Fact", statement="Truth")]),
    )
    with pytest.raises(ModeChangeConflictError):
        _save(session, draft, "mode", StoryModeSection(mode="freeform"))
    assert len(session.exec(select(CanonFact).where(CanonFact.version_id == draft.version_id)).all()) == 1
    changed = _save(session, draft, "mode", StoryModeSection(mode="freeform"), confirm_mode_change=True)
    assert changed.canon.facts == []
    assert changed.draft_revision == draft.draft_revision + 1


def test_mode_change_requires_confirmation_before_dropping_creative_goals(session):
    draft = create_story_draft(session)
    draft = _save(session, draft, "canon", StoryCanonSection(creative_goals="Find the lost city"))
    with pytest.raises(ModeChangeConflictError):
        _save(session, draft, "mode", StoryModeSection(mode="hybrid"))
    changed = _save(session, draft, "mode", StoryModeSection(mode="hybrid"), confirm_mode_change=True)
    assert changed.canon.creative_goals == ""


def test_publishing_freezes_version_and_updates_pointer(session):
    draft = _publishable(session)
    published = publish_draft(session, draft.story_id, available_models=["qwen3:14b-q4_K_M"])
    story = session.get(Story, draft.story_id)
    assert published.status == "published"
    assert published.published_at is not None
    assert story.current_published_version_id == draft.version_id
    assert story.slug == "one"
    with pytest.raises(LookupError):
        replace_draft_section(session, draft.story_id, "identity", _valid_identity("two"), draft.draft_revision)


def test_publish_failure_rolls_back_status_and_pointer(session):
    draft = create_story_draft(session)
    with pytest.raises(DraftInvalidError) as raised:
        publish_draft(session, draft.story_id, available_models=[])
    assert "identity_slug_required" in {item.code for item in raised.value.diagnostics}
    assert session.get(StoryVersion, draft.version_id).status == "draft"
    assert session.get(Story, draft.story_id).current_published_version_id is None


def test_duplicate_slug_rejected_at_publication_without_changing_pointer(session):
    first = _publishable(session)
    publish_draft(session, first.story_id)
    second = create_story_draft(session)
    second = _save(session, second, "identity", _valid_identity())
    with pytest.raises(DraftInvalidError) as raised:
        publish_draft(session, second.story_id)
    assert "identity_slug_duplicate" in {item.code for item in raised.value.diagnostics}
    assert session.get(Story, second.story_id).current_published_version_id is None


def test_validate_endpoint_service_reports_duplicate_slug_without_mutation(session):
    first = _publishable(session)
    publish_draft(session, first.story_id)
    second = create_story_draft(session)
    second = _save(session, second, "identity", _valid_identity())
    result = validate_story_draft(session, second.story_id)
    assert not result.valid
    assert "identity_slug_duplicate" in {item.code for item in result.diagnostics}
    assert session.get(StoryVersion, second.version_id).draft_revision == second.draft_revision


def test_clone_preserves_content_with_new_child_ids_and_provenance(session):
    draft = _publishable(session)
    draft = _save(session, draft, "mode", StoryModeSection(mode="hybrid"))
    draft = _save(
        session,
        draft,
        "canon",
        StoryCanonSection(
            facts=[CanonFactDefinition(id="fact", order_index=0, title="Fact", statement="Truth")],
            beats=[StoryBeatDefinition(id="beat", order_index=0, title="Beat", description="Arrive")],
        ),
    )
    published = publish_draft(session, draft.story_id)
    clone = create_draft_from_version(session, draft.story_id, published.version_id)
    assert clone.version_number == 2
    assert clone.based_on_version_id == published.version_id
    assert clone.canon.facts[0].id != published.canon.facts[0].id
    assert clone.canon.beats[0].id != published.canon.beats[0].id
    assert clone.canon.beats[0].description == "Arrive"
    assert session.get(StoryVersion, published.version_id).status == "published"


def test_clone_remaps_beat_dependencies_and_keeps_cast_pin(session):
    draft = _publishable(session)
    session.add(Character(id="alice", name="Alice", age=22, personality="Calm", appearance="Coat"))
    session.add(
        CharacterRevision(
            id="alice-r1",
            character_id="alice",
            revision_number=1,
            name="Alice",
            gender="female",
            age=22,
            personality="Calm",
            appearance="Coat",
        )
    )
    session.commit()
    draft = _save(
        session,
        draft,
        "cast",
        StoryCastSection(
            characters=[StoryCastMember(id="pin", character_id="alice", revision_id="alice-r1", order_index=0)]
        ),
    )
    draft = _save(session, draft, "mode", StoryModeSection(mode="hybrid"))
    draft = _save(
        session,
        draft,
        "canon",
        StoryCanonSection(
            facts=[CanonFactDefinition(id="fact", order_index=0, title="Fact", statement="Truth")],
            beats=[
                StoryBeatDefinition(id="beat-1", order_index=0, title="First", description="First"),
                StoryBeatDefinition(
                    id="beat-2",
                    order_index=1,
                    title="Second",
                    description="Second",
                    activation_condition={"kind": "after_beat", "beat_id": "beat-1"},
                ),
            ],
        ),
    )
    published = publish_draft(session, draft.story_id)
    clone = create_draft_from_version(session, draft.story_id, published.version_id)
    assert clone.cast.characters[0].id != "pin"
    assert clone.cast.characters[0].revision_id == "alice-r1"
    assert clone.canon.beats[1].activation_condition.beat_id == clone.canon.beats[0].id
    assert clone.canon.beats[0].id != "beat-1"


def test_child_ids_are_stable_across_identical_section_replacement(session):
    draft = create_story_draft(session)
    section = StoryCanonSection(facts=[CanonFactDefinition(id="fact", order_index=0, title="Fact", statement="Truth")])
    first = _save(session, draft, "canon", section)
    second = _save(session, first, "canon", section)
    assert second.draft_revision == first.draft_revision
    assert session.exec(select(CanonFact).where(CanonFact.version_id == draft.version_id)).one().id == "fact"


@pytest.mark.parametrize(
    ("section", "code"),
    [
        (
            StoryCanonSection(
                facts=[
                    CanonFactDefinition(id="same", order_index=0, title="One", statement="One"),
                    CanonFactDefinition(id="same", order_index=1, title="Two", statement="Two"),
                ]
            ),
            "fact_id_duplicate",
        ),
        (
            StoryCanonSection(
                beats=[
                    StoryBeatDefinition(id="one", order_index=0, title="One", description="One"),
                    StoryBeatDefinition(id="two", order_index=0, title="Two", description="Two"),
                ]
            ),
            "beat_order_duplicate",
        ),
        (
            StoryCastSection(
                characters=[
                    StoryCastMember(id="one", character_id="alice", revision_id="alice-r1", order_index=0),
                    StoryCastMember(id="two", character_id="bob", revision_id="bob-r1", order_index=0),
                ]
            ),
            "cast_order_duplicate",
        ),
    ],
)
def test_section_constraints_reject_before_database_write(session, section, code):
    draft = create_story_draft(session)
    name = "cast" if isinstance(section, StoryCastSection) else "canon"
    with pytest.raises(DraftInvalidError) as raised:
        _save(session, draft, name, section)
    assert code in {item.code for item in raised.value.diagnostics}
    assert session.get(StoryVersion, draft.version_id).draft_revision == 1
    assert session.exec(select(CanonFact).where(CanonFact.version_id == draft.version_id)).all() == []
