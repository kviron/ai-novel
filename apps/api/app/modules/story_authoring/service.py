"""Transactional lifecycle for story drafts and immutable published versions."""

from __future__ import annotations

import json
from collections.abc import Collection

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.db.models import (
    CanonFact,
    Story,
    StoryBeat,
    StoryVersion,
    StoryVersionCharacter,
    new_public_id,
    utc_timestamp,
)
from app.modules.story_authoring import repository
from app.modules.story_authoring.definition import load_story_draft
from app.modules.story_authoring.lint import validate_draft
from app.modules.story_authoring.schemas import (
    DraftDiagnostic,
    DraftValidationResult,
    StoryCanonSection,
    StoryCastSection,
    StoryDraft,
    StoryHeroSection,
    StoryIdentitySection,
    StoryModeSection,
    StoryRulesSection,
)


class DraftConflictError(Exception):
    def __init__(self, latest_revision: int):
        self.latest_revision = latest_revision
        super().__init__(f"Draft revision changed to {latest_revision}")


class DraftInvalidError(Exception):
    def __init__(self, diagnostics: list[DraftDiagnostic]):
        self.diagnostics = diagnostics
        super().__init__("Draft has validation errors")


class ModeChangeConflictError(Exception):
    def __init__(self):
        super().__init__("Changing mode would discard incompatible author content")


_SECTION_TYPES = {
    "identity": StoryIdentitySection,
    "mode": StoryModeSection,
    "hero": StoryHeroSection,
    "cast": StoryCastSection,
    "rules": StoryRulesSection,
    "canon": StoryCanonSection,
}


def _validation(session: Session, draft: StoryDraft, available_models: Collection[str]) -> list[DraftDiagnostic]:
    diagnostics = validate_draft(draft, available_models).diagnostics
    if draft.identity.slug:
        owner = repository.slug_owner(session, draft.identity.slug)
        if owner is not None and owner.id != draft.story_id:
            diagnostics.append(
                DraftDiagnostic(
                    code="identity_slug_duplicate",
                    severity="error",
                    step="identity",
                    field="slug",
                    message="Slug is already used by another story",
                )
            )
    return diagnostics


def _with_diagnostics(session: Session, draft: StoryDraft, available_models: Collection[str]) -> StoryDraft:
    draft.diagnostics = _validation(session, draft, available_models)
    return draft


def validate_story_draft(
    session: Session, story_id: str, *, available_models: Collection[str] = ()
) -> DraftValidationResult:
    """Validate the persisted draft including catalog slug uniqueness, without changing it."""
    diagnostics = _validation(session, load_story_draft(session, story_id), available_models)
    return DraftValidationResult(
        valid=not any(item.severity == "error" for item in diagnostics), diagnostics=diagnostics
    )


def create_story_draft(session: Session, identity: StoryIdentitySection | None = None) -> StoryDraft:
    """Atomically create a stable catalog identity and its first editable version."""
    identity = identity or StoryIdentitySection()
    story_id = new_public_id()
    story = Story(
        id=story_id,
        slug=f"draft-{story_id}",
        title=identity.title or "Untitled story",
        premise=identity.premise,
        current_scene=identity.opening_situation,
    )
    version = StoryVersion(
        story_id=story_id,
        version_number=1,
        mode="freeform",
        title=identity.title,
        slug=identity.slug,
        short_description=identity.short_description,
        premise=identity.premise,
        cover_material_id=identity.cover_material_id,
        genres=json.dumps(identity.genres),
        tone=json.dumps(identity.tone),
        setting=identity.setting,
        opening_situation=identity.opening_situation,
        content_rating=identity.content_rating,
    )
    try:
        session.add(story)
        session.add(version)
        session.flush()
        session.commit()
    except Exception:
        session.rollback()
        raise
    return _with_diagnostics(session, load_story_draft(session, story_id), ())


def replace_draft_section(
    session: Session,
    story_id: str,
    section: str,
    payload: StoryIdentitySection
    | StoryModeSection
    | StoryHeroSection
    | StoryCastSection
    | StoryRulesSection
    | StoryCanonSection,
    expected_revision: int,
    *,
    confirm_mode_change: bool = False,
    available_models: Collection[str] = (),
) -> StoryDraft:
    """Replace one complete typed section, with optimistic concurrency and one commit."""
    section_type = _SECTION_TYPES.get(section)
    if section_type is None:
        raise ValueError(f"Unknown draft section: {section}")
    if not isinstance(payload, section_type):
        raise TypeError(f"{section} requires {section_type.__name__}")
    # Revalidate mutated model instances as well as ordinary request DTOs.
    payload = section_type.model_validate(payload.model_dump())
    version = repository.draft_version(session, story_id)
    if version.draft_revision != expected_revision:
        raise DraftConflictError(version.draft_revision)
    current = load_story_draft(session, story_id)
    if getattr(current, section).model_dump() == payload.model_dump():
        return _with_diagnostics(session, current, available_models)

    if section in {"cast", "canon"}:
        candidate = current.model_copy(update={section: payload})
        structural_codes = {
            "cast_id_duplicate",
            "cast_character_duplicate",
            "cast_order_duplicate",
            "fact_id_duplicate",
            "fact_order_duplicate",
            "beat_id_duplicate",
            "beat_order_duplicate",
        }
        structural_errors = [
            item for item in validate_draft(candidate, available_models).diagnostics if item.code in structural_codes
        ]
        if structural_errors:
            raise DraftInvalidError(structural_errors)

    if section == "mode" and payload.mode != current.mode.mode:
        drops_canon = payload.mode == "freeform" and bool(current.canon.facts or current.canon.beats)
        drops_goals = payload.mode == "hybrid" and bool(current.canon.creative_goals.strip())
        if (drops_canon or drops_goals) and not confirm_mode_change:
            raise ModeChangeConflictError

    try:
        if section == "identity":
            for field in StoryIdentitySection.model_fields:
                value = getattr(payload, field)
                setattr(version, field, json.dumps(value) if field in {"genres", "tone"} else value)
        elif section == "mode":
            version.mode = payload.mode
            if payload.mode == "freeform":
                repository.replace_canon(
                    session, version.id, StoryCanonSection(creative_goals=current.canon.creative_goals)
                )
            else:
                version.creative_goals = ""
        elif section == "hero":
            version.hero_policy = payload.hero_policy
            version.hero_allowed_sources = json.dumps(payload.hero_allowed_sources)
            version.fixed_hero_revision_id = payload.fixed_hero_revision_id
        elif section == "cast":
            repository.replace_cast(session, version.id, payload)
        elif section == "rules":
            version.themes_allowed = json.dumps(payload.themes_allowed)
            version.themes_blocked = json.dumps(payload.themes_blocked)
            version.ending_policy = payload.ending_policy
            version.recommended_provider_id = payload.recommended_provider_id
            version.recommended_model_id = payload.recommended_model_id
            for field in payload.generation_policy.model_fields:
                setattr(version, field, getattr(payload.generation_policy, field))
        elif section == "canon":
            version.creative_goals = payload.creative_goals
            repository.replace_canon(session, version.id, payload)
        version.draft_revision += 1
        session.flush()
        updated = _with_diagnostics(session, load_story_draft(session, story_id), available_models)
        session.commit()
        return updated
    except Exception:
        session.rollback()
        raise


def publish_draft(session: Session, story_id: str, *, available_models: Collection[str] = ()) -> StoryDraft:
    """Validate the complete aggregate and atomically advance the story's published pointer."""
    version = repository.draft_version(session, story_id)
    story = session.get(Story, story_id)
    draft = load_story_draft(session, story_id)
    diagnostics = _validation(session, draft, available_models)
    if any(item.severity == "error" for item in diagnostics):
        raise DraftInvalidError(diagnostics)
    try:
        published_at = utc_timestamp()
        version.status = "published"
        version.published_at = published_at
        story.current_published_version_id = version.id
        story.slug = version.slug
        story.title = version.title
        story.premise = version.premise
        story.description = version.short_description
        story.current_scene = version.opening_situation
        session.commit()
    except IntegrityError as error:
        session.rollback()
        owner = repository.slug_owner(session, draft.identity.slug)
        if owner is not None and owner.id != story_id:
            raise DraftInvalidError(
                [
                    DraftDiagnostic(
                        code="identity_slug_duplicate",
                        severity="error",
                        step="identity",
                        field="slug",
                        message="Slug is already used by another story",
                    )
                ]
            ) from error
        raise
    except Exception:
        session.rollback()
        raise
    return draft.model_copy(update={"status": "published", "published_at": published_at, "diagnostics": diagnostics})


def create_draft_from_version(session: Session, story_id: str, version_id: str) -> StoryDraft:
    """Clone one published version into the next mutable version with fresh child IDs."""
    source = repository.published_version(session, story_id, version_id)
    active = session.exec(
        select(StoryVersion).where(StoryVersion.story_id == story_id, StoryVersion.status == "draft")
    ).first()
    if active is not None:
        raise DraftConflictError(active.draft_revision)
    numbers = session.exec(select(StoryVersion.version_number).where(StoryVersion.story_id == story_id)).all()
    version_number = max(numbers) + 1
    excluded = {"id", "version_number", "status", "draft_revision", "based_on_version_id", "created_at", "published_at"}
    values = {
        column.name: getattr(source, column.name)
        for column in StoryVersion.__table__.columns
        if column.name not in excluded
    }
    clone = StoryVersion(
        **values,
        version_number=version_number,
        status="draft",
        draft_revision=1,
        based_on_version_id=source.id,
    )
    try:
        session.add(clone)
        session.flush()
        for row in repository.child_rows(session, StoryVersionCharacter, source.id):
            session.add(
                StoryVersionCharacter(
                    id=new_public_id(),
                    version_id=clone.id,
                    character_id=row.character_id,
                    revision_id=row.revision_id,
                    order_index=row.order_index,
                    role=row.role,
                    color=row.color,
                    playable=row.playable,
                )
            )
        for row in repository.child_rows(session, CanonFact, source.id):
            session.add(
                CanonFact(
                    id=new_public_id(),
                    version_id=clone.id,
                    order_index=row.order_index,
                    title=row.title,
                    statement=row.statement,
                    severity=row.severity,
                    scope=row.scope,
                    referenced_character_ids=row.referenced_character_ids,
                )
            )
        beats = repository.child_rows(session, StoryBeat, source.id)
        id_map = {row.id: new_public_id() for row in beats}
        for row in beats:
            condition = json.loads(row.activation_condition)
            if condition.get("kind", condition.get("type")) == "after_beat":
                condition["beat_id"] = id_map[condition["beat_id"]]
            session.add(
                StoryBeat(
                    id=id_map[row.id],
                    version_id=clone.id,
                    order_index=row.order_index,
                    title=row.title,
                    description=row.description,
                    activation_condition=json.dumps(condition),
                    completion_evidence=row.completion_evidence,
                    required=row.required,
                    ending_gate=row.ending_gate,
                )
            )
        session.commit()
    except Exception:
        session.rollback()
        raise
    return _with_diagnostics(session, load_story_draft(session, story_id), ())
