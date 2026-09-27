from sqlmodel import Session

from app.core.errors import ProviderResponseError, ProviderUnavailableError
from app.modules.llm_harness.budget import ContextBudgetError
from app.modules.llm_harness.executor import GenerationRejectedError, GenerationTask, LLMHarness
from app.modules.llm_harness.models import ModelCatalog
from app.modules.providers.model_selection import UnsupportedModelError, available_models
from app.modules.providers.service import ProviderRegistry
from app.modules.stories.schemas import SessionDetail
from app.modules.stories.service import get_session_detail

from . import repository
from .contracts import AcceptedTurn, TurnCreate, TurnResult
from .prompt import build_prompt
from .rules import GenerationContext, InvalidProposalError, validate_proposal


class TurnGenerationFailedError(Exception):
    """Safe public failure; the last rejected response is diagnostic-only."""

    def __init__(self, *, raw_response: str | None = None) -> None:
        super().__init__("Turn generation failed")
        self.raw_response = raw_response


def create_turn(
    session: Session,
    registry: ProviderRegistry,
    session_id: str,
    request: TurnCreate,
    context_tokens: int,
    model_context_windows: dict[str, int] | None = None,
) -> tuple[TurnResult, bool]:
    """Generate, repair at most once, and save one canonical turn, or replay its saved result.

    No database changes survive a failure. Provider/model selection and all
    concurrency decisions are hidden from the caller behind this operation.
    """
    try:
        existing = repository.find_turn(session, session_id, request.request_id)
        if existing is not None:
            return existing, False
        context = repository.load_context(session, session_id, request.expected_state_version)
    except repository.StateConflictError:
        # A duplicate may have committed between the lookup and version read.
        session.rollback()
        existing = repository.find_turn(session, session_id, request.request_id)
        if existing is not None:
            return existing, False
        raise
    finally:
        # The context contains plain values: release the read transaction before I/O.
        session.rollback()
    try:
        accepted, raw_response = _generate_turn(registry, context, request, context_tokens, model_context_windows)
    except (ProviderUnavailableError, ProviderResponseError, TurnGenerationFailedError, ContextBudgetError):
        # A committed duplicate wins even when this request's generation failed.
        # Discard any prior snapshot before checking, then release the fresh read.
        session.rollback()
        try:
            existing = repository.find_turn(session, session_id, request.request_id)
        finally:
            session.rollback()
        if existing is not None:
            return existing, False
        raise
    return repository.commit_turn(session, context, request, accepted, raw_response)


def rewind_session(session: Session, session_id: str, expected_state_version: int) -> SessionDetail:
    repository.rewind_turn(session, session_id, expected_state_version)
    return get_session_detail(session, session_id)


def change_session_model(
    session: Session, registry: ProviderRegistry, session_id: str, model_id: str, expected_state_version: int
) -> SessionDetail:
    game = get_session_detail(session, session_id)
    session.rollback()
    if model_id not in available_models(registry, game.provider_id):
        raise UnsupportedModelError
    repository.change_model(session, session_id, expected_state_version, model_id)
    return get_session_detail(session, session_id)


def _generate_turn(
    registry: ProviderRegistry,
    context: GenerationContext,
    request: TurnCreate,
    context_tokens: int,
    model_context_windows: dict[str, int] | None = None,
) -> tuple[AcceptedTurn, str]:
    """Propose and repair without owning or opening any database transaction."""
    generation_request = build_prompt(context, request, context_tokens)
    harness = LLMHarness(registry, ModelCatalog(context_tokens, model_context_windows))
    try:
        result = harness.run(
            GenerationTask(
                task_kind="game_turn",
                provider_id=context.provider_id,
                model_id=context.model_id,
                output_kind="turn",
                system_prompt=generation_request.system_prompt,
                user_prompt=generation_request.user_prompt,
                response_schema=generation_request.model_dump(mode="json", include={"response_schema"})[
                    "response_schema"
                ],
                validator=lambda proposal: validate_proposal(proposal, context),
                retryable_errors=(InvalidProposalError,),
            )
        )
    except GenerationRejectedError as error:
        raise TurnGenerationFailedError(raw_response=error.raw_response) from None
    return result.value, result.raw_response
