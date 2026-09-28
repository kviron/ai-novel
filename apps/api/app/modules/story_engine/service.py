import json
from dataclasses import replace

from sqlmodel import Session

from app.core.errors import ProviderResponseError, ProviderUnavailableError
from app.modules.llm_harness.budget import ContextBudgetError, fit_layers
from app.modules.llm_harness.executor import GenerationRejectedError, GenerationTask, LLMHarness
from app.modules.llm_harness.models import ModelCatalog, PromptLayer, UnknownModelProfileError, catalog_for_model
from app.modules.providers.model_selection import UnsupportedModelError, available_models
from app.modules.providers.service import ProviderRegistry
from app.modules.stories.schemas import SessionDetail
from app.modules.stories.service import get_session_detail

from . import repository
from .contracts import AcceptedTurn, TurnCreate, TurnResult
from .memory import ensure_memory
from .prompt import build_prompt, preferred_speaker_limit
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
    memory_provider_id: str | None = None,
    memory_model_id: str | None = None,
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
        catalog = catalog_for_model(
            registry, context_tokens, model_context_windows, context.provider_id, context.model_id
        )
        context = _select_history(context, request, catalog)
        summary_provider = memory_provider_id or context.provider_id
        summary_model = memory_model_id or context.model_id
        if context.older_turns:
            summary_catalog = (
                catalog
                if (summary_provider, summary_model) == (context.provider_id, context.model_id)
                else catalog_for_model(registry, context_tokens, model_context_windows, summary_provider, summary_model)
            )
            try:
                context = ensure_memory(
                    session,
                    registry,
                    context,
                    summary_catalog,
                    provider_id=summary_provider,
                    model_id=summary_model,
                )
            except GenerationRejectedError as error:
                raise TurnGenerationFailedError(raw_response=error.raw_response) from None
        accepted, raw_response = _generate_turn(registry, context, request, catalog)
    except (
        ProviderUnavailableError,
        ProviderResponseError,
        TurnGenerationFailedError,
        ContextBudgetError,
        UnknownModelProfileError,
    ):
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
    catalog: ModelCatalog,
) -> tuple[AcceptedTurn, str]:
    """Propose and repair without owning or opening any database transaction."""
    profile = catalog.resolve(context.provider_id, context.model_id)
    generation_request = build_prompt(context, request, profile.working_window)
    harness = LLMHarness(registry, catalog)
    speaker_limit = context.dialogue_speaker_limit or preferred_speaker_limit(context, request.action)
    validation_attempt = 0
    valid_fallback: tuple[AcceptedTurn, str] | None = None

    def validate_with_speaker_preference(proposal):
        nonlocal validation_attempt, valid_fallback
        validation_attempt += 1
        accepted = validate_proposal(proposal, context)
        speakers = {segment.character_id for segment in accepted.segments if segment.kind == "dialogue"}
        if validation_attempt == 1 and len(speakers) > speaker_limit:
            valid_fallback = (accepted, proposal.model_dump_json())
            raise InvalidProposalError("prefer_single_speaker")
        return accepted

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
                validator=validate_with_speaker_preference,
                retryable_errors=(InvalidProposalError,),
            )
        )
    except GenerationRejectedError as error:
        if valid_fallback is not None:
            return valid_fallback
        raise TurnGenerationFailedError(raw_response=error.raw_response) from None
    except (ProviderUnavailableError, ProviderResponseError):
        if valid_fallback is not None:
            return valid_fallback
        raise
    return result.value, result.raw_response


def _select_history(context: GenerationContext, request: TurnCreate, catalog: ModelCatalog) -> GenerationContext:
    """Move displaced recent turns into memory before constructing the game request."""
    profile = catalog.resolve(context.provider_id, context.model_id)
    recent = context.recent_turns
    speaker_limit = preferred_speaker_limit(context, request.action)
    for keep in range(len(recent), -1, -1):
        moved = [
            {"id": turn["id"], "action": turn["action"], "segments": turn["segments"]}
            for turn in recent[: len(recent) - keep]
        ]
        older = [*(context.older_turns or []), *moved]
        candidate = replace(
            context,
            older_turns=older,
            recent_turns=recent[-keep:] if keep else [],
            memory_summary="М" * 2500 if older else "",
            dialogue_speaker_limit=speaker_limit,
        )
        prompt = build_prompt(candidate, request, profile.working_window)
        layers = [
            PromptLayer("system", "system", prompt.system_prompt, required=True),
            PromptLayer("user", "user", prompt.user_prompt, required=True),
            PromptLayer(
                "schema",
                "schema",
                json.dumps(
                    prompt.model_dump(mode="json", include={"response_schema"})["response_schema"],
                    ensure_ascii=False,
                ),
                required=True,
            ),
        ]
        try:
            fit_layers(profile, layers, min(1024, profile.output_limit))
            return replace(candidate, memory_summary="")
        except ContextBudgetError:
            continue
    raise ContextBudgetError("Required game context exceeds the selected model window")
