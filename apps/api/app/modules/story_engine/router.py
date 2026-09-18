from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlmodel import Session

from app.core.errors import ApiError, ErrorResponse, ProviderResponseError, ProviderUnavailableError
from app.db.engine import get_session
from app.modules.providers.router import ProviderRegistryDep
from app.modules.stories.service import SessionNotFoundError

from .contracts import TurnCreate, TurnResult
from .repository import StateConflictError
from .service import TurnGenerationFailedError, create_turn

router = APIRouter(prefix="/api/sessions", tags=["Story turns"])
SessionDep = Annotated[Session, Depends(get_session)]


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
) -> TurnResult:
    try:
        result, created = create_turn(session, registry, session_id, payload)
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
