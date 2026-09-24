from typing import Annotated, Literal

from fastapi import APIRouter, Depends, status
from sqlmodel import Session

from app.core.config import RuntimeSettingsDep
from app.core.errors import ApiError, ErrorResponse
from app.db.engine import get_session
from app.modules.stories.schemas import SessionDetail, SessionSummary, StartSessionRequest, StoryDetail, StorySummary

from .service import (
    SessionNotFoundError,
    StoryNotFoundError,
    UnsupportedModelError,
    get_session_detail,
    get_story,
    list_autosaves,
    list_session_summaries,
    list_stories,
    start_story_session,
)

router = APIRouter(prefix="/api", tags=["Истории"])
SessionDep = Annotated[Session, Depends(get_session)]


@router.get("/stories", response_model=list[StorySummary])
def read_stories(session: SessionDep) -> list[StorySummary]:
    return list_stories(session)


@router.get("/stories/{story_id}", response_model=StoryDetail, responses={404: {"model": ErrorResponse}})
def read_story(story_id: str, session: SessionDep) -> StoryDetail:
    try:
        return get_story(session, story_id)
    except StoryNotFoundError as error:
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "История не найдена.") from error


@router.post(
    "/stories/{story_id}/sessions",
    status_code=status.HTTP_201_CREATED,
    response_model=SessionDetail,
    responses={404: {"model": ErrorResponse}, 422: {"model": ErrorResponse}},
)
def create_story_session(
    story_id: str,
    payload: StartSessionRequest,
    session: SessionDep,
    settings: RuntimeSettingsDep,
) -> SessionDetail:
    try:
        return start_story_session(session, story_id, payload, settings.ollama_model)
    except StoryNotFoundError as error:
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "История не найдена.") from error
    except UnsupportedModelError as error:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "validation_error",
            "Выбранные провайдер или модель не поддерживаются.",
        ) from error


@router.get("/sessions", response_model=list[SessionSummary])
def read_sessions(session: SessionDep, kind: Literal["player", "author"] = "player") -> list[SessionSummary]:
    return list_session_summaries(session, kind)


@router.get("/autosaves", response_model=list[SessionSummary])
def read_autosaves(session: SessionDep) -> list[SessionSummary]:
    return list_autosaves(session)


@router.get("/sessions/{session_id}", response_model=SessionDetail, responses={404: {"model": ErrorResponse}})
def read_session(session_id: str, session: SessionDep) -> SessionDetail:
    try:
        return get_session_detail(session, session_id)
    except SessionNotFoundError as error:
        raise ApiError(
            status.HTTP_404_NOT_FOUND,
            "not_found",
            "Игровая сессия не найдена. Начните новую игру.",
        ) from error
