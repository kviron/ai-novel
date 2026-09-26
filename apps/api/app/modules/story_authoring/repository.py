"""Persistence primitives for mutable story drafts."""

from __future__ import annotations

import json
from collections.abc import Iterable

from sqlmodel import Session, select

from app.db.models import CanonFact, Story, StoryBeat, StoryVersion, StoryVersionCharacter
from app.modules.story_authoring.schemas import StoryCanonSection, StoryCastSection


def draft_version(session: Session, story_id: str) -> StoryVersion:
    version = session.exec(
        select(StoryVersion).where(StoryVersion.story_id == story_id, StoryVersion.status == "draft")
    ).first()
    if version is None:
        raise LookupError(f"Draft not found for story {story_id}")
    return version


def published_version(session: Session, story_id: str, version_id: str) -> StoryVersion:
    version = session.get(StoryVersion, version_id)
    if version is None or version.story_id != story_id or version.status != "published":
        raise LookupError(f"Published version not found: {version_id}")
    return version


def child_rows(session: Session, model: type, version_id: str) -> list:
    return list(session.exec(select(model).where(model.version_id == version_id)))


def replace_rows(session: Session, model: type, version_id: str, rows: Iterable) -> None:
    for existing in child_rows(session, model, version_id):
        session.delete(existing)
    session.flush()
    session.add_all(list(rows))
    session.flush()


def replace_cast(session: Session, version_id: str, section: StoryCastSection) -> None:
    replace_rows(
        session,
        StoryVersionCharacter,
        version_id,
        (
            StoryVersionCharacter(
                id=item.id,
                version_id=version_id,
                character_id=item.character_id,
                revision_id=item.revision_id,
                order_index=item.order_index,
                role=item.role,
                color=item.color,
                playable=item.playable,
            )
            for item in section.characters
        ),
    )


def replace_canon(session: Session, version_id: str, section: StoryCanonSection) -> None:
    replace_rows(
        session,
        CanonFact,
        version_id,
        (
            CanonFact(
                id=item.id,
                version_id=version_id,
                order_index=item.order_index,
                title=item.title,
                statement=item.statement,
                severity=item.severity,
                scope=item.scope,
                referenced_character_ids=json.dumps(item.referenced_character_ids),
            )
            for item in section.facts
        ),
    )
    replace_rows(
        session,
        StoryBeat,
        version_id,
        (
            StoryBeat(
                id=item.id,
                version_id=version_id,
                order_index=item.order_index,
                title=item.title,
                description=item.description,
                activation_condition=item.activation_condition.model_dump_json(),
                completion_evidence=item.completion_evidence,
                required=item.required,
                ending_gate=item.ending_gate,
            )
            for item in section.beats
        ),
    )


def slug_owner(session: Session, slug: str) -> Story | None:
    return session.exec(select(Story).where(Story.slug == slug)).first()
