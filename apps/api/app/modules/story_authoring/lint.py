"""Pure, deterministic validation of a fully resolved authoring aggregate."""

from __future__ import annotations

import re
from collections.abc import Collection

from app.modules.story_authoring.schemas import DraftDiagnostic, DraftValidationResult, StoryDraft

_MODEL_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:/-]*$")
_STEP_ORDER = {
    step: index for index, step in enumerate(("identity", "mode", "hero", "cast", "rules", "canon", "review"))
}


def order_diagnostics(diagnostics: list[DraftDiagnostic]) -> list[DraftDiagnostic]:
    """Apply one stable wizard-step, field, item, and code order to every diagnostic source."""
    return sorted(
        diagnostics,
        key=lambda item: (_STEP_ORDER[item.step], item.field, item.item_id or "", item.code),
    )


def validate_draft(draft: StoryDraft, available_models: Collection[str]) -> DraftValidationResult:
    diagnostics: list[DraftDiagnostic] = []

    def add(code: str, severity: str, step: str, field: str, *, item_id: str | None = None) -> None:
        diagnostics.append(
            DraftDiagnostic(
                code=code,
                severity=severity,
                step=step,
                field=field,
                item_id=item_id,
                message=code.replace("_", " "),
            )
        )

    identity = draft.identity
    for field in ("title", "slug", "premise", "setting", "opening_situation"):
        if not getattr(identity, field).strip():
            add(f"identity_{field}_required", "error", "identity", field)
    if identity.cover_material_id is None:
        add("cover_missing", "warning", "identity", "cover_material_id")

    hero = draft.hero
    if not hero.hero_allowed_sources:
        add("hero_source_required", "error", "hero", "hero_allowed_sources")
    revisions = {revision.id: revision for revision in draft.character_revisions}
    if hero.hero_policy == "fixed":
        if not hero.fixed_hero_revision_id:
            add("hero_fixed_revision_required", "error", "hero", "fixed_hero_revision_id")
        elif hero.fixed_hero_revision_id not in revisions:
            add("hero_fixed_revision_missing", "error", "hero", "fixed_hero_revision_id")
        elif revisions[hero.fixed_hero_revision_id].age < 18:
            add("hero_character_underage", "error", "hero", "fixed_hero_revision_id")

    cast = sorted(draft.cast.characters, key=lambda item: (item.order_index, item.id))
    if not cast:
        add("cast_optional_empty", "warning", "cast", "characters")
    seen_cast_ids: set[str] = set()
    seen_cast_characters: set[str] = set()
    seen_cast_order: set[int] = set()
    fixed_revision = revisions.get(hero.fixed_hero_revision_id) if hero.fixed_hero_revision_id else None
    for member in cast:
        if member.id in seen_cast_ids:
            add("cast_id_duplicate", "error", "cast", "characters", item_id=member.id)
        seen_cast_ids.add(member.id)
        if member.character_id in seen_cast_characters:
            add("cast_character_duplicate", "error", "cast", "characters", item_id=member.id)
        seen_cast_characters.add(member.character_id)
        if member.order_index in seen_cast_order:
            add("cast_order_duplicate", "error", "cast", "characters", item_id=member.id)
        seen_cast_order.add(member.order_index)
        revision = revisions.get(member.revision_id)
        if revision is None:
            add("cast_revision_missing", "error", "cast", "revision_id", item_id=member.id)
        else:
            if revision.character_id != member.character_id:
                add("cast_revision_character_mismatch", "error", "cast", "revision_id", item_id=member.id)
            if revision.age < 18:
                add("cast_character_underage", "error", "cast", "revision_id", item_id=member.id)
        if hero.hero_policy == "fixed" and fixed_revision is not None:
            if fixed_revision.character_id == member.character_id and member.role != "protagonist":
                add("hero_fixed_cast_conflict", "error", "hero", "fixed_hero_revision_id", item_id=member.id)

    rules = draft.rules
    policy = rules.generation_policy
    if (
        policy.min_choices > policy.max_choices
        or (policy.choice_policy == "free_input_only" and (policy.min_choices or policy.max_choices))
        or (policy.choice_policy != "free_input_only" and policy.max_choices == 0)
    ):
        add("choice_count_invalid", "error", "rules", "generation_policy")
    allowed = {theme.casefold() for theme in rules.themes_allowed}
    if allowed.intersection(theme.casefold() for theme in rules.themes_blocked):
        add("theme_overlap", "error", "rules", "themes_blocked")
    if rules.recommended_provider_id != "ollama":
        add("provider_unsupported", "error", "rules", "recommended_provider_id")
    if not rules.recommended_model_id or not _MODEL_ID.fullmatch(rules.recommended_model_id):
        add("model_identifier_required", "error", "rules", "recommended_model_id")
    elif rules.recommended_model_id not in available_models and (
        f"{rules.recommended_provider_id}:{rules.recommended_model_id}" not in available_models
    ):
        add("model_unavailable", "warning", "rules", "recommended_model_id")

    facts = sorted(draft.canon.facts, key=lambda item: (item.order_index, item.id))
    beats = sorted(draft.canon.beats, key=lambda item: (item.order_index, item.id))
    if (
        draft.mode.mode == "hybrid"
        and not any(fact.severity == "hard" for fact in facts)
        and not any(beat.required for beat in beats)
    ):
        add("hybrid_structure_required", "error", "canon", "facts")
    if draft.mode.mode == "freeform":
        if facts:
            add("freeform_fact_forbidden", "error", "canon", "facts")
        if beats:
            add("freeform_beat_forbidden", "error", "canon", "beats")
    if rules.ending_policy == "required_beats_then_end" and not any(
        beat.required and beat.ending_gate for beat in beats
    ):
        add("ending_gate_required", "error", "canon", "beats")
    if not draft.canon.creative_goals.strip() and not any(fact.severity == "soft" for fact in facts):
        add("soft_guidance_missing", "warning", "canon", "creative_goals")

    seen_fact_ids: set[str] = set()
    seen_fact_order: set[int] = set()
    character_ids = {revision.character_id for revision in revisions.values()}
    for fact in facts:
        if fact.id in seen_fact_ids:
            add("fact_id_duplicate", "error", "canon", "facts", item_id=fact.id)
        seen_fact_ids.add(fact.id)
        if fact.order_index in seen_fact_order:
            add("fact_order_duplicate", "error", "canon", "facts", item_id=fact.id)
        seen_fact_order.add(fact.order_index)
        for character_id in fact.referenced_character_ids:
            if character_id not in character_ids:
                add("fact_character_missing", "error", "canon", "referenced_character_ids", item_id=fact.id)

    seen_beat_ids: set[str] = set()
    seen_beat_order: set[int] = set()
    beat_by_id = {beat.id: beat for beat in beats}
    dependencies: dict[str, str] = {}
    for beat in beats:
        if beat.id in seen_beat_ids:
            add("beat_id_duplicate", "error", "canon", "beats", item_id=beat.id)
        seen_beat_ids.add(beat.id)
        if beat.order_index in seen_beat_order:
            add("beat_order_duplicate", "error", "canon", "beats", item_id=beat.id)
        seen_beat_order.add(beat.order_index)
        condition = beat.activation_condition
        if condition.kind == "after_beat":
            dependencies[beat.id] = condition.beat_id
            target = beat_by_id.get(condition.beat_id)
            if target is None:
                add("beat_dependency_missing", "error", "canon", "activation_condition", item_id=beat.id)
            elif target.order_index >= beat.order_index:
                add("beat_dependency_not_prior", "error", "canon", "activation_condition", item_id=beat.id)

    # Each node has at most one predecessor. Walk iteratively so malformed long chains cannot overflow the stack.
    visited: set[str] = set()
    for beat in beats:
        if beat.id in visited:
            continue
        path: set[str] = set()
        node = beat.id
        while node in dependencies and node not in visited:
            if node in path:
                add("beat_dependency_cycle", "error", "canon", "activation_condition", item_id=node)
                break
            path.add(node)
            node = dependencies[node]
        visited.update(path)

    return DraftValidationResult(
        valid=not any(item.severity == "error" for item in diagnostics), diagnostics=order_diagnostics(diagnostics)
    )
