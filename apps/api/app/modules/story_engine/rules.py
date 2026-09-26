import re
from dataclasses import dataclass
from typing import Any

from app.modules.providers.contracts import SceneSegment
from app.modules.stories.content import (
    AKANE_BACKGROUNDS,
    AKANE_EMOTIONS,
    AKANE_INITIAL_BACKGROUND,
    AKANE_OUTFIT,
    AKANE_POSES,
    MARK_OUTFIT,
)

from .contracts import AcceptedTurn, CanonicalVisualDirective, TurnProposal


@dataclass(frozen=True)
class GenerationContext:
    """Detached snapshot: generation holds neither a DB transaction nor ORM objects."""

    session_id: str
    active_turn_id: str | None
    state_version: int
    current_scene: str
    provider_id: str
    model_id: str
    story: dict[str, Any]
    protagonist: dict[str, Any]
    characters: list[dict[str, Any]]
    recent_turns: list[dict[str, Any]]


class InvalidProposalError(Exception):
    """Contains rule identifiers only, never untrusted model content."""


# Only unmistakable second-person voluntary actions are rejected here. A broad
# language classifier would erase legitimate consequences and sensory narration.
PROTAGONIST_ACTION_PATTERN = re.compile(
    r"\b(?:ты|вы)\s+(?:решил(?:а|и)?|сказал(?:а|и)?|ответил(?:а|и)?|спросил(?:а|и)?)\b",
    re.IGNORECASE,
)


def validate_proposal(proposal: TurnProposal, context: GenerationContext) -> AcceptedTurn:
    """Accept only known identifiers and meaningful choices; normalize missing emotion assets."""
    characters = {character["id"]: character for character in context.characters}
    if proposal.segments is not None:
        segments = proposal.segments
    elif proposal.dialogue is not None:
        if not proposal.narration or not proposal.narration.strip():
            raise InvalidProposalError("empty_narration_or_dialogue")
        segments = [
            SceneSegment(kind="narration", text=proposal.narration),
            SceneSegment(kind="dialogue", text=proposal.dialogue.text, character_id=proposal.dialogue.character_id),
        ]
    else:
        segments = []
    if not segments or not any(segment.kind == "dialogue" for segment in segments):
        raise InvalidProposalError("missing_dialogue")
    for segment in segments:
        if not segment.text.strip():
            raise InvalidProposalError("empty_segment")
        if segment.kind == "dialogue" and segment.character_id not in characters:
            raise InvalidProposalError("unknown_character_id")
        if segment.kind == "narration" and segment.character_id is not None:
            raise InvalidProposalError("narration_has_character_id")
        if segment.kind == "dialogue" and segment.character_id is None:
            raise InvalidProposalError("missing_character_id")
    dialogue_segments = [segment for segment in segments if segment.kind == "dialogue"]
    narration_segments = [segment for segment in segments if segment.kind == "narration"]
    for narration in narration_segments:
        if PROTAGONIST_ACTION_PATTERN.search(narration.text):
            raise InvalidProposalError("protagonist_action_forbidden")
        normalized_narration = " ".join(narration.text.casefold().split())
        for dialogue in dialogue_segments:
            normalized_dialogue = " ".join(dialogue.text.casefold().split())
            if len(normalized_dialogue) >= 24 and normalized_dialogue in normalized_narration:
                raise InvalidProposalError("dialogue_repeated_in_narration")
    character = characters.get(dialogue_segments[-1].character_id)
    if character is None:
        raise InvalidProposalError("unknown_character_id")
    directive = proposal.visual_directive
    uses_legacy_visuals = character["id"] == "akane" or character.get("source_type") == "legacy"
    allowed_poses = AKANE_POSES if uses_legacy_visuals else frozenset({"default"})
    if directive.pose not in allowed_poses:
        raise InvalidProposalError("unknown_pose_id")
    allowed_outfit = AKANE_OUTFIT if uses_legacy_visuals else MARK_OUTFIT if character["id"] == "mark" else "none"
    if directive.outfit != allowed_outfit:
        raise InvalidProposalError("unknown_outfit_id")
    choices = [choice.strip() for choice in proposal.suggested_choices]
    if not 2 <= len(choices) <= 4 or not all(choices):
        raise InvalidProposalError("expected_2_to_4_nonempty_choices")
    if len({choice.casefold() for choice in choices}) != len(choices):
        raise InvalidProposalError("duplicate_choices")
    if proposal.segments is None and (not proposal.narration or not proposal.narration.strip()):
        raise InvalidProposalError("empty_narration_or_dialogue")
    # MVP sessions have no reversible world-state effects; accepting one would make rewind unsafe.
    if proposal.proposed_effects:
        raise InvalidProposalError("effects_not_allowed")
    previous_background = (
        context.recent_turns[-1]["visual_directive"].get("background") if context.recent_turns else None
    )
    # An unknown or omitted location never creates an asset URL; it keeps the last valid backdrop.
    background = directive.background if directive.background in AKANE_BACKGROUNDS else previous_background
    if background not in AKANE_BACKGROUNDS:
        background = AKANE_INITIAL_BACKGROUND
    speaking_ids = {segment.character_id for segment in dialogue_segments}
    if directive.present_character_ids is not None:
        present_ids = directive.present_character_ids
        if len(set(present_ids)) != len(present_ids) or any(
            character_id not in characters for character_id in present_ids
        ):
            raise InvalidProposalError("unknown_or_duplicate_present_character_id")
        if not speaking_ids.issubset(present_ids):
            raise InvalidProposalError("speaker_not_present")
    else:
        previous_directive = context.recent_turns[-1]["visual_directive"] if context.recent_turns else {}
        inherited = previous_directive.get("present_character_ids", []) if previous_background == background else []
        present_ids = list(dict.fromkeys([*inherited, *[segment.character_id for segment in dialogue_segments]]))
        present_ids = [character_id for character_id in present_ids if character_id in characters]
    return AcceptedTurn(
        speaker=character["name"],
        narration="\n".join(segment.text.strip() for segment in narration_segments),
        dialogue=dialogue_segments[-1].text.strip(),
        segments=[segment.model_copy(update={"text": segment.text.strip()}) for segment in segments],
        choices=choices,
        visual_directive=CanonicalVisualDirective(
            character_id=character["id"],
            emotion=directive.emotion if directive.emotion in AKANE_EMOTIONS else "neutral",
            pose=directive.pose,
            outfit=directive.outfit,
            background=background,
            present_character_ids=present_ids,
        ),
    )
