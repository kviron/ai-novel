from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlmodel import Session

from app.db.engine import get_session

from .schemas import CharacterDetail, SessionDetail, StartSessionRequest, StoryDetail, StorySummary
from .service import (
    SessionNotFoundError,
    StoryNotFoundError,
    UnsupportedModelError,
    get_session_detail,
    get_story,
    list_stories,
    start_story_session,
)

router = APIRouter(prefix="/api", tags=["Истории"])
SessionDep = Annotated[Session, Depends(get_session)]


@router.get("/stories", response_model=list[StorySummary])
def read_stories(session: SessionDep) -> list[StorySummary]:
    return list_stories(session)


@router.get("/stories/{story_id}", response_model=StoryDetail)
def read_story(story_id: str, request: Request, session: SessionDep) -> StoryDetail:
    try:
        return get_story(session, story_id)
    except StoryNotFoundError as error:
        legacy_story = request.app.state.legacy_store.get_story(story_id)
        if legacy_story is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not_found") from error
        return StoryDetail(
            id=legacy_story["id"],
            slug=legacy_story["id"],
            title=legacy_story["title"],
            premise=legacy_story["premise"],
            story_mode="hybrid",
            recommended_provider_id="ollama",
            recommended_model_id="qwen3:14b-q4_K_M",
            current_scene=legacy_story["current_scene"],
            characters=[
                CharacterDetail(
                    id=character["id"],
                    name=character["name"],
                    age=character["age"],
                    personality=character["personality"],
                    appearance=character["appearance"],
                    visual_profile_version=character["visual_profile_version"],
                )
                for character in legacy_story["characters"]
            ],
        )


@router.post("/stories/{story_id}/sessions", status_code=status.HTTP_201_CREATED, response_model=SessionDetail)
def create_story_session(story_id: str, payload: StartSessionRequest, session: SessionDep) -> SessionDetail:
    try:
        return start_story_session(session, story_id, payload)
    except StoryNotFoundError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not_found") from error
    except UnsupportedModelError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="validation_error") from error


@router.get("/sessions/{session_id}", response_model=SessionDetail)
def read_session(session_id: str, session: SessionDep) -> SessionDetail:
    try:
        return get_session_detail(session, session_id)
    except SessionNotFoundError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not_found") from error
