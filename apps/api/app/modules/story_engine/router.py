from typing import Annotated

from fastapi import APIRouter, Depends, Response
from fastapi.responses import JSONResponse
from sqlmodel import Session

from app.core.errors import ProviderResponseError, ProviderUnavailableError
from app.db.engine import get_session
from app.modules.providers.router import ProviderRegistryDep
from app.modules.stories.service import SessionNotFoundError

from .contracts import TurnCreate, TurnResult
from .repository import StateConflictError
from .service import TurnGenerationFailedError, create_turn

router = APIRouter(prefix="/api/sessions", tags=["Story turns"])
SessionDep = Annotated[Session, Depends(get_session)]


@router.post("/{session_id}/turns", status_code=201, response_model=TurnResult)
def post_turn(
    session_id: str,
    payload: TurnCreate,
    response: Response,
    session: SessionDep,
    registry: ProviderRegistryDep,
) -> TurnResult | JSONResponse:
    try:
        result, created = create_turn(session, registry, session_id, payload)
    except SessionNotFoundError:
        return _error(404, "not_found", "Игровая сессия не найдена. Начните новую игру.", False)
    except StateConflictError:
        return _error(409, "state_conflict", "Состояние игры изменилось. Обновите сессию и повторите действие.", True)
    except ProviderUnavailableError:
        return _error(503, "provider_unavailable", "Ollama недоступна. Проверьте, что она запущена, и повторите.", True)
    except ProviderResponseError:
        return _error(503, "model_unavailable", "Модель недоступна. Установите модель в Ollama и повторите.", True)
    except TurnGenerationFailedError:
        return _error(
            502, "invalid_model_response", "Модель дважды вернула некорректный ход. Повторите действие.", True
        )
    if not created:
        response.status_code = 200
    return result


def _error(status: int, code: str, detail: str, retryable: bool) -> JSONResponse:
    return JSONResponse(status_code=status, content={"code": code, "detail": detail, "retryable": retryable})
