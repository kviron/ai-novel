from dataclasses import dataclass
from typing import Any

from app.modules.stories.seed import AKANE_EMOTIONS

from .contracts import AcceptedTurn, CanonicalVisualDirective, TurnProposal


@dataclass(frozen=True)
class GenerationContext:
    """Detached snapshot: generation holds neither a DB transaction nor ORM objects."""

    session_id: str
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
    if directive.pose not in {"default", "fan_open"}:
        raise InvalidProposalError("unknown_pose_id")
    if directive.outfit != "red_dress":
        raise InvalidProposalError("unknown_outfit_id")
    choices = [choice.strip() for choice in proposal.suggested_choices]
    if not 2 <= len(choices) <= 4 or not all(choices):
        raise InvalidProposalError("expected_2_to_4_nonempty_choices")
    if len({choice.casefold() for choice in choices}) != len(choices):
        raise InvalidProposalError("duplicate_choices")
    if not proposal.narration.strip() or not proposal.dialogue.text.strip():
        raise InvalidProposalError("empty_narration_or_dialogue")
    # No mutable story effects are authored in the first playable slice.
    if proposal.proposed_effects:
        raise InvalidProposalError("effects_not_allowed")
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
        ),
    )
