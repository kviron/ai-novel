from dataclasses import dataclass
from typing import Any

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
    characters: list[dict[str, Any]]
    recent_turns: list[dict[str, Any]]


class InvalidProposalError(Exception):
    """Contains rule identifiers only, never untrusted model content."""


def validate_proposal(proposal: TurnProposal, context: GenerationContext) -> AcceptedTurn:
    """Accept only known identifiers and meaningful choices; normalize missing emotion assets."""
    characters = {character["id"]: character for character in context.characters}
    character = characters.get(proposal.dialogue.character_id)
    if character is None:
        raise InvalidProposalError("unknown_character_id")
    directive = proposal.visual_directive
    # Unknown legacy casts retain their prior allowed poses; only Mark has a portrait-only pose.
    allowed_poses = frozenset({"default"}) if character["id"] == "mark" else AKANE_POSES
    if directive.pose not in allowed_poses:
        raise InvalidProposalError("unknown_pose_id")
    allowed_outfit = MARK_OUTFIT if character["id"] == "mark" else AKANE_OUTFIT
    if directive.outfit != allowed_outfit:
        raise InvalidProposalError("unknown_outfit_id")
    choices = [choice.strip() for choice in proposal.suggested_choices]
    if not 2 <= len(choices) <= 4 or not all(choices):
        raise InvalidProposalError("expected_2_to_4_nonempty_choices")
    if len({choice.casefold() for choice in choices}) != len(choices):
        raise InvalidProposalError("duplicate_choices")
    if not proposal.narration.strip() or not proposal.dialogue.text.strip():
        raise InvalidProposalError("empty_narration_or_dialogue")
    # MVP sessions have no reversible world-state effects; accepting one would make rewind unsafe.
    if proposal.proposed_effects:
        raise InvalidProposalError("effects_not_allowed")
    previous_background = (
        context.recent_turns[-1]["visual_directive"].get("background")
        if context.recent_turns else None
    )
    # An unknown or omitted location never creates an asset URL; it keeps the last valid backdrop.
    background = directive.background if directive.background in AKANE_BACKGROUNDS else previous_background
    if background not in AKANE_BACKGROUNDS:
        background = AKANE_INITIAL_BACKGROUND
    return AcceptedTurn(
        speaker=character["name"],
        narration=proposal.narration.strip(),
        dialogue=proposal.dialogue.text.strip(),
        choices=choices,
        visual_directive=CanonicalVisualDirective(
            character_id=character["id"],
            emotion=directive.emotion if directive.emotion in AKANE_EMOTIONS else "neutral",
            pose=directive.pose,
            outfit=directive.outfit,
            background=background,
        ),
    )
