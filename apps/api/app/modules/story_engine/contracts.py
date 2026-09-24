from pydantic import BaseModel, ConfigDict, Field

from app.modules.providers.contracts import SceneSegment as SceneSegment
from app.modules.providers.contracts import TurnProposal as TurnProposal
from app.modules.providers.contracts import VisualDirective as VisualDirective


class TurnCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    request_id: str = Field(min_length=1, max_length=100)
    expected_state_version: int = Field(ge=1)
    action: str = Field(min_length=1, max_length=4000)


class RewindRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_state_version: int = Field(ge=1)


class ModelChangeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    expected_state_version: int = Field(ge=1)
    model_id: str = Field(min_length=1, max_length=160)


class CanonicalVisualDirective(VisualDirective):
    character_id: str
    # A default keeps pre-background saves replayable without rewriting their turns.
    background: str = "neon_crossroads"


class AcceptedTurn(BaseModel):
    """Canonical content after domain rules; carries no provider diagnostics."""

    speaker: str
    narration: str
    dialogue: str
    segments: list[SceneSegment]
    choices: list[str]
    visual_directive: CanonicalVisualDirective


class TurnResult(AcceptedTurn):
    id: str
    session_id: str
    request_id: str
    state_version: int
    action: str
    provider_id: str
    model_id: str
    prompt_version: str
    created_at: str
