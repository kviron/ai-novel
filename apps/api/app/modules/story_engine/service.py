from sqlmodel import Session

from app.core.errors import ProviderResponseError, ProviderUnavailableError
from app.modules.providers.service import ProviderRegistry

from . import repository
from .contracts import AcceptedTurn, TurnCreate, TurnResult
from .prompt import build_prompt, repair_prompt
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
        accepted, raw_response = _generate_turn(registry, context, request)
    except (ProviderUnavailableError, ProviderResponseError, TurnGenerationFailedError):
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


def _generate_turn(
    registry: ProviderRegistry,
    context: GenerationContext,
    request: TurnCreate,
) -> tuple[AcceptedTurn, str]:
    """Propose and repair without owning or opening any database transaction."""
    try:
        provider = registry.get(context.provider_id)
    except KeyError:
        raise ProviderUnavailableError() from None
    generation_request = build_prompt(context, request)
    raw_response = ""
    for attempt in range(2):
        try:
            proposal = provider.generate_turn(generation_request)
            raw_response = proposal.model_dump_json()
            accepted = validate_proposal(proposal, context)
            break
        except ProviderResponseError as error:
            if error.code == "model_unavailable":
                raise
            raw_response = error.raw_response or ""
            validation_error = error.code
        except InvalidProposalError as error:
            validation_error = str(error)
        if attempt == 1:
            raise TurnGenerationFailedError(raw_response=raw_response) from None
        generation_request = repair_prompt(generation_request, validation_error, raw_response)
    return accepted, raw_response
