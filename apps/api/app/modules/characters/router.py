from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlmodel import Session

from app.core.config import RuntimeSettingsDep
from app.core.errors import ApiError, ErrorResponse, ProviderResponseError, ProviderUnavailableError
from app.db.engine import get_session
from app.modules.providers.model_selection import NoAvailableModelError
from app.modules.providers.router import ProviderRegistryDep

from .field_generation import generate_character_field
from .schemas import (
    AttachCharacterRequest,
    CharacterHistory,
    CharacterProfile,
    CharacterWrite,
    GenerateCharacterFieldRequest,
    GeneratedCharacterField,
    PinRevisionRequest,
    StoryCharacterProfile,
)
from .service import (
    CharacterAlreadyAttachedError,
    CharacterNotFoundError,
    InvalidRevisionError,
    StoryNotFoundError,
    attach_character,
    create_character,
    get_character,
    list_characters,
    pin_revision,
    revise_character,
)

router = APIRouter(prefix="/api", tags=["Персонажи"])
SessionDep = Annotated[Session, Depends(get_session)]


@router.get("/characters", response_model=list[CharacterProfile])
def read_characters(session: SessionDep) -> list[CharacterProfile]:
    return list_characters(session)


@router.post("/characters/generate-field", response_model=GeneratedCharacterField)
def generate_field(
    payload: GenerateCharacterFieldRequest, settings: RuntimeSettingsDep, registry: ProviderRegistryDep
) -> GeneratedCharacterField:
    try:
        return generate_character_field(payload, registry, settings.ollama_model)
    except (NoAvailableModelError, ProviderUnavailableError, ProviderResponseError) as error:
        raise ApiError(
            503, "provider_unavailable", "Нейросеть недоступна. Проверьте Ollama и повторите.", retryable=True
        ) from error


@router.get("/characters/{character_id}", response_model=CharacterHistory, responses={404: {"model": ErrorResponse}})
def read_character(character_id: str, session: SessionDep) -> CharacterHistory:
    try:
        return get_character(session, character_id)
    except CharacterNotFoundError as error:
        raise ApiError(404, "not_found", "Персонаж не найден.") from error


@router.post("/characters", status_code=status.HTTP_201_CREATED, response_model=CharacterProfile)
def add_character(payload: CharacterWrite, session: SessionDep) -> CharacterProfile:
    return create_character(session, payload)


@router.post(
    "/characters/{character_id}/revisions", status_code=status.HTTP_201_CREATED, response_model=CharacterProfile
)
def add_revision(character_id: str, payload: CharacterWrite, session: SessionDep) -> CharacterProfile:
    try:
        return revise_character(session, character_id, payload)
    except CharacterNotFoundError as error:
        raise ApiError(404, "not_found", "Персонаж не найден.") from error


@router.post(
    "/stories/{story_id}/characters", status_code=status.HTTP_201_CREATED, response_model=StoryCharacterProfile
)
def add_story_character(story_id: str, payload: AttachCharacterRequest, session: SessionDep) -> StoryCharacterProfile:
    try:
        return attach_character(session, story_id, payload)
    except StoryNotFoundError as error:
        raise ApiError(404, "not_found", "История не найдена.") from error
    except CharacterNotFoundError as error:
        raise ApiError(404, "not_found", "Персонаж не найден.") from error
    except InvalidRevisionError as error:
        raise ApiError(422, "validation_error", "Ревизия не принадлежит персонажу.") from error
    except CharacterAlreadyAttachedError as error:
        raise ApiError(409, "conflict", "Персонаж уже добавлен в историю.") from error


@router.put("/stories/{story_id}/characters/{character_id}", response_model=StoryCharacterProfile)
def update_story_character(
    story_id: str, character_id: str, payload: PinRevisionRequest, session: SessionDep
) -> StoryCharacterProfile:
    try:
        return pin_revision(session, story_id, character_id, payload.revision_id)
    except CharacterNotFoundError as error:
        raise ApiError(404, "not_found", "Персонаж не привязан к истории.") from error
    except InvalidRevisionError as error:
        raise ApiError(422, "validation_error", "Ревизия не принадлежит персонажу.") from error
