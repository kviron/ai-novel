"""Load and serialize the complete versioned authoring aggregate."""

from __future__ import annotations

import hashlib
import json

from sqlmodel import Session, select

from app.db.models import CanonFact, CharacterRevision, StoryBeat, StoryVersion, StoryVersionCharacter
from app.modules.story_authoring.schemas import (
    CanonFactDefinition,
    CharacterRevisionSnapshot,
    GenerationPolicy,
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


def _json_list(value: str) -> list[str]:
    parsed = json.loads(value)
    if not isinstance(parsed, list):
        raise ValueError("Stored authoring list must be a JSON array")
    return parsed


def _condition(value: str) -> dict:
    parsed = json.loads(value)
    if not isinstance(parsed, dict):
        raise ValueError("Stored beat condition must be a JSON object")
    if "type" in parsed and "kind" not in parsed:
        parsed["kind"] = parsed.pop("type")
    return parsed


def load_story_draft(session: Session, story_id: str) -> StoryDraft:
    """Return the story's editable draft with all persisted children resolved."""
    version = session.exec(
        select(StoryVersion).where(StoryVersion.story_id == story_id, StoryVersion.status == "draft")
    ).first()
    if version is None:
        raise LookupError(f"Draft not found for story {story_id}")

    cast_rows = sorted(
        session.exec(select(StoryVersionCharacter).where(StoryVersionCharacter.version_id == version.id)),
        key=lambda row: (row.order_index, row.id),
    )
    fact_rows = sorted(
        session.exec(select(CanonFact).where(CanonFact.version_id == version.id)),
        key=lambda row: (row.order_index, row.id),
    )
    beat_rows = sorted(
        session.exec(select(StoryBeat).where(StoryBeat.version_id == version.id)),
        key=lambda row: (row.order_index, row.id),
    )

    revision_ids = {row.revision_id for row in cast_rows}
    if version.fixed_hero_revision_id:
        revision_ids.add(version.fixed_hero_revision_id)
    revisions = (
        sorted(
            session.exec(select(CharacterRevision).where(CharacterRevision.id.in_(revision_ids))),
            key=lambda row: row.id,
        )
        if revision_ids
        else []
    )

    return StoryDraft(
        story_id=version.story_id,
        version_id=version.id,
        version_number=version.version_number,
        status=version.status,
        draft_revision=version.draft_revision,
        based_on_version_id=version.based_on_version_id,
        rules_version=version.rules_version,
        created_at=version.created_at,
        published_at=version.published_at,
        identity=StoryIdentitySection(
            title=version.title,
            slug=version.slug,
            short_description=version.short_description,
            premise=version.premise,
            cover_material_id=version.cover_material_id,
            genres=_json_list(version.genres),
            tone=_json_list(version.tone),
            setting=version.setting,
            opening_situation=version.opening_situation,
            content_rating=version.content_rating,
        ),
        mode=StoryModeSection(mode=version.mode),
        hero=StoryHeroSection(
            hero_policy=version.hero_policy,
            hero_allowed_sources=_json_list(version.hero_allowed_sources),
            fixed_hero_revision_id=version.fixed_hero_revision_id,
        ),
        cast=StoryCastSection(
            characters=[
                StoryCastMember(
                    id=row.id,
                    character_id=row.character_id,
                    revision_id=row.revision_id,
                    order_index=row.order_index,
                    role=row.role,
                    color=row.color,
                    playable=row.playable,
                )
                for row in cast_rows
            ]
        ),
        rules=StoryRulesSection(
            themes_allowed=_json_list(version.themes_allowed),
            themes_blocked=_json_list(version.themes_blocked),
            ending_policy=version.ending_policy,
            recommended_provider_id=version.recommended_provider_id,
            recommended_model_id=version.recommended_model_id,
            generation_policy=GenerationPolicy(
                narration_perspective=version.narration_perspective,
                prose_density=version.prose_density,
                choice_policy=version.choice_policy,
                min_choices=version.min_choices,
                max_choices=version.max_choices,
                allow_romance=version.allow_romance,
                allow_violence=version.allow_violence,
                allow_horror=version.allow_horror,
                allow_sexual_themes=version.allow_sexual_themes,
                desired_themes=version.desired_themes,
                forbidden_outcomes=version.forbidden_outcomes,
            ),
        ),
        canon=StoryCanonSection(
            creative_goals=version.creative_goals,
            facts=[
                CanonFactDefinition(
                    id=row.id,
                    order_index=row.order_index,
                    title=row.title,
                    statement=row.statement,
                    severity=row.severity,
                    scope=row.scope,
                    referenced_character_ids=_json_list(row.referenced_character_ids),
                )
                for row in fact_rows
            ],
            beats=[
                StoryBeatDefinition(
                    id=row.id,
                    order_index=row.order_index,
                    title=row.title,
                    description=row.description,
                    activation_condition=_condition(row.activation_condition),
                    completion_evidence=row.completion_evidence,
                    required=row.required,
                    ending_gate=row.ending_gate,
                )
                for row in beat_rows
            ],
        ),
        character_revisions=[
            CharacterRevisionSnapshot(
                id=row.id,
                character_id=row.character_id,
                revision_number=row.revision_number,
                name=row.name,
                gender=row.gender,
                age=row.age,
                personality=row.personality,
                appearance=row.appearance,
                biography=row.biography,
                speech=row.speech,
                role=row.role,
            )
            for row in revisions
        ],
    )


def canonical_snapshot(draft: StoryDraft) -> tuple[str, str]:
    """Serialize resolved draft data with stable child order and hash those UTF-8 bytes."""
    ordered = draft.model_copy(
        update={
            "cast": draft.cast.model_copy(
                update={"characters": sorted(draft.cast.characters, key=lambda item: (item.order_index, item.id))}
            ),
            "canon": draft.canon.model_copy(
                update={
                    "facts": sorted(draft.canon.facts, key=lambda item: (item.order_index, item.id)),
                    "beats": sorted(draft.canon.beats, key=lambda item: (item.order_index, item.id)),
                }
            ),
            "character_revisions": sorted(draft.character_revisions, key=lambda item: item.id),
        }
    )
    serialized = ordered.model_dump_json(exclude={"diagnostics"})
    digest = hashlib.sha256(serialized.encode("utf-8")).hexdigest()
    return serialized, digest
