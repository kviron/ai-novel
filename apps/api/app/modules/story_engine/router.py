from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlmodel import Session

from app.core.config import RuntimeSettingsDep
from app.core.errors import ApiError, ErrorResponse, ProviderResponseError, ProviderUnavailableError
from app.db.engine import get_session
from app.modules.providers.model_selection import NoAvailableModelError, UnsupportedModelError
from app.modules.providers.router import ProviderRegistryDep
from app.modules.stories.schemas import SessionDetail
from app.modules.stories.service import SessionNotFoundError

from .contracts import ModelChangeRequest, RewindRequest, TurnCreate, TurnResult
from .repository import RewindUnavailableError, StateConflictError
from .service import TurnGenerationFailedError, change_session_model, create_turn, rewind_session

router = APIRouter(prefix="/api/sessions", tags=["Story turns"])
SessionDep = Annotated[Session, Depends(get_session)]


@router.post(
    "/{session_id}/model",
    response_model=SessionDetail,
    responses={
        404: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
        503: {"model": ErrorResponse},
    },
)
def post_model_change(
    session_id: str, payload: ModelChangeRequest, session: SessionDep, registry: ProviderRegistryDep
) -> SessionDetail:
    try:
        return change_session_model(session, registry, session_id, payload.model_id, payload.expected_state_version)
    except SessionNotFoundError:
        raise ApiError(404, "not_found", "Игровая сессия не найдена.") from None
    except StateConflictError:
        raise ApiError(409, "state_conflict", "Состояние игры изменилось. Обновите сессию.", retryable=True) from None
    except UnsupportedModelError:
        raise ApiError(422, "validation_error", "Выберите установленную модель Ollama.") from None
    except NoAvailableModelError:
        raise ApiError(
            503, "model_unavailable", "Модели Ollama недоступны. Повторите проверку.", retryable=True
        ) from None


@router.post(
    "/{session_id}/rewind",
    response_model=SessionDetail,
    responses={404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}, 422: {"model": ErrorResponse}},
)
def post_rewind(session_id: str, payload: RewindRequest, session: SessionDep) -> SessionDetail:
    try:
        return rewind_session(session, session_id, payload.expected_state_version)
    except SessionNotFoundError:
        raise ApiError(404, "not_found", "Игровая сессия не найдена.") from None
    except StateConflictError:
        raise ApiError(409, "state_conflict", "Состояние игры изменилось. Обновите сессию.", retryable=True) from None
    except RewindUnavailableError:
        raise ApiError(422, "rewind_unavailable", "Дальше вернуться нельзя.") from None


@router.post(
    "/{session_id}/turns",
    status_code=status.HTTP_201_CREATED,
    response_model=TurnResult,
    responses={
        200: {"model": TurnResult, "description": "Повтор ранее сохранённого хода"},
        404: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
        502: {"model": ErrorResponse},
        503: {"model": ErrorResponse},
    },
)
def post_turn(
    session_id: str,
    payload: TurnCreate,
    response: Response,
    session: SessionDep,
    registry: ProviderRegistryDep,
    settings: RuntimeSettingsDep,
) -> TurnResult:
    try:
        result, created = create_turn(session, registry, session_id, payload, settings.ollama_context_tokens)
    except SessionNotFoundError:
        raise ApiError(404, "not_found", "Игровая сессия не найдена. Начните новую игру.") from None
    except StateConflictError:
        raise ApiError(
            409,
            "state_conflict",
            "Состояние игры изменилось. Обновите сессию и повторите действие.",
            retryable=True,
        ) from None
    except ProviderUnavailableError:
        raise ApiError(
            503,
            "provider_unavailable",
            "Ollama недоступна. Проверьте, что она запущена, и повторите.",
            retryable=True,
        ) from None
    except ProviderResponseError:
        raise ApiError(
            503,
            "model_unavailable",
            "Модель недоступна. Установите модель в Ollama и повторите.",
            retryable=True,
        ) from None
    except TurnGenerationFailedError:
        raise ApiError(
            502,
            "invalid_model_response",
            "Модель дважды вернула некорректный ход. Повторите действие.",
            retryable=True,
        ) from None
    if not created:
        response.status_code = 200
    return result
