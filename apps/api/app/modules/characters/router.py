from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, status
from fastapi.responses import Response
from sqlmodel import Session

from app.core.config import RuntimeSettingsDep
from app.core.errors import ApiError, ErrorResponse, ProviderResponseError, ProviderUnavailableError
from app.db.engine import get_session
from app.db.models import CharacterMaterial
from app.modules.providers.model_selection import NoAvailableModelError
from app.modules.providers.router import ProviderRegistryDep

from .field_generation import generate_character_field, generate_story_role
from .materials import (
    MAX_ARCHIVE_BYTES,
    MAX_AVATAR_BYTES,
    ArchiveLimitError,
    InvalidMaterialError,
    avatar_bytes,
    export_character,
    import_character,
    upload_material,
)
from .schemas import (
    AttachCharacterRequest,
    BatchAttachRequest,
    CharacterHistory,
    CharacterProfile,
    CharacterWrite,
    GenerateCharacterFieldRequest,
    GeneratedCharacterField,
    GenerateStoryRoleRequest,
    PinRevisionRequest,
    StoryCharacterProfile,
)
from .service import (
    CharacterAlreadyAttachedError,
    CharacterNotFoundError,
    InvalidRevisionError,
    LastCastMemberError,
    SessionNotFoundError,
    StoryNotFoundError,
    attach_character,
    attach_characters_batch,
    create_character,
    detach_character,
    extract_session_character,
    get_character,
    list_characters,
    pin_revision,
    revise_character,
)

router = APIRouter(prefix="/api", tags=["Персонажи"])
SessionDep = Annotated[Session, Depends(get_session)]


@router.get("/characters", response_model=list[CharacterProfile])
def read_characters(session: SessionDep, exclude_story_id: str | None = None) -> list[CharacterProfile]:
    return list_characters(session, exclude_story_id)


async def _bounded_body(request: Request, limit: int) -> bytes:
    content = bytearray()
    async for chunk in request.stream():
        content.extend(chunk)
        if len(content) > limit:
            raise ApiError(413, "too_large", "Файл превышает допустимый размер.")
    return bytes(content)


@router.get("/character-materials/{material_id}")
def read_material(material_id: str, session: SessionDep, settings: RuntimeSettingsDep) -> Response:
    material = session.get(CharacterMaterial, material_id)
    if material is None:
        raise ApiError(404, "not_found", "Материал не найден.")
    try:
        return Response(
            avatar_bytes(settings.asset_dir, material),
            media_type=material.mime_type,
            headers={"Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff"},
        )
    except (FileNotFoundError, InvalidMaterialError) as error:
        raise ApiError(404, "not_found", "Материал не найден.") from error


@router.post("/characters/import", status_code=status.HTTP_201_CREATED, response_model=CharacterProfile)
async def import_character_archive(
    request: Request, session: SessionDep, settings: RuntimeSettingsDep
) -> CharacterProfile:
    data = await _bounded_body(request, MAX_ARCHIVE_BYTES)
    try:
        return import_character(session, settings.asset_dir, data)
    except InvalidMaterialError as error:
        raise ApiError(422, "invalid_archive", "Архив персонажа повреждён или не поддерживается.") from error


@router.get("/characters/{character_id}/export")
def export_character_archive(character_id: str, session: SessionDep, settings: RuntimeSettingsDep) -> Response:
    try:
        content = export_character(session, settings.asset_dir, character_id)
    except CharacterNotFoundError as error:
        raise ApiError(404, "not_found", "Персонаж не найден.") from error
    except ArchiveLimitError as error:
        raise ApiError(409, "archive_limit", "Архив слишком большой: до 100 ревизий и 50 МБ.") from error
    except (FileNotFoundError, InvalidMaterialError) as error:
        raise ApiError(409, "invalid_material", "Один из материалов персонажа недоступен.") from error
    return Response(
        content,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="character-{character_id}.zip"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.post(
    "/stories/{story_id}/characters/batch",
    status_code=status.HTTP_201_CREATED,
    response_model=list[StoryCharacterProfile],
)
def add_story_characters_batch(
    story_id: str, payload: BatchAttachRequest, session: SessionDep
) -> list[StoryCharacterProfile]:
    try:
        return attach_characters_batch(session, story_id, payload.character_ids)
    except (StoryNotFoundError, CharacterNotFoundError) as error:
        raise ApiError(404, "not_found", "История или персонаж не найдены.") from error
    except InvalidRevisionError as error:
        raise ApiError(422, "validation_error", "У персонажа нет доступной ревизии.") from error
    except CharacterAlreadyAttachedError as error:
        raise ApiError(409, "conflict", "Персонаж уже добавлен в историю.") from error


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
    "/sessions/{session_id}/characters/{character_id}/extract",
    status_code=status.HTTP_201_CREATED,
    response_model=CharacterProfile,
)
def extract_character(session_id: str, character_id: str, session: SessionDep) -> CharacterProfile:
    try:
        return extract_session_character(session, session_id, character_id)
    except (SessionNotFoundError, CharacterNotFoundError) as error:
        raise ApiError(404, "not_found", "Персонаж в этом прохождении не найден.") from error


@router.post(
    "/characters/{character_id}/revisions", status_code=status.HTTP_201_CREATED, response_model=CharacterProfile
)
def add_revision(character_id: str, payload: CharacterWrite, session: SessionDep) -> CharacterProfile:
    try:
        return revise_character(session, character_id, payload)
    except CharacterNotFoundError as error:
        raise ApiError(404, "not_found", "Персонаж не найден.") from error


@router.post("/characters/{character_id}/{kind}", status_code=status.HTTP_201_CREATED, response_model=CharacterProfile)
async def add_material(
    character_id: str,
    kind: str,
    request: Request,
    session: SessionDep,
    settings: RuntimeSettingsDep,
    filename: str = Query(min_length=1, max_length=255),
    creator: str = Query(min_length=1, max_length=200),
    license: str = Query(min_length=1, max_length=200),
    source: str = Query(min_length=1, max_length=500),
) -> CharacterProfile:
    data = await _bounded_body(request, MAX_AVATAR_BYTES)
    try:
        return upload_material(
            session,
            settings.asset_dir,
            character_id,
            data,
            mime_type=request.headers.get("content-type", ""),
            filename=filename,
            creator=creator,
            license=license,
            source=source,
            kind=kind,
        )
    except CharacterNotFoundError as error:
        raise ApiError(404, "not_found", "Персонаж не найден.") from error
    except InvalidMaterialError as error:
        raise ApiError(
            422, "invalid_material", "Нужен файл PNG, JPEG или WebP и сведения об авторе и лицензии."
        ) from error


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


@router.post("/stories/{story_id}/characters/generate-role", response_model=GeneratedCharacterField)
def generate_role(
    story_id: str,
    payload: GenerateStoryRoleRequest,
    session: SessionDep,
    settings: RuntimeSettingsDep,
    registry: ProviderRegistryDep,
) -> GeneratedCharacterField:
    try:
        return generate_story_role(session, story_id, payload, registry, settings.ollama_model)
    except StoryNotFoundError as error:
        raise ApiError(404, "not_found", "История не найдена.") from error
    except InvalidRevisionError as error:
        raise ApiError(422, "validation_error", "Ревизия не принадлежит персонажу.") from error
    except (NoAvailableModelError, ProviderUnavailableError, ProviderResponseError) as error:
        raise ApiError(
            503, "provider_unavailable", "Нейросеть недоступна. Проверьте Ollama и повторите.", retryable=True
        ) from error


@router.put("/stories/{story_id}/characters/{character_id}", response_model=StoryCharacterProfile)
def update_story_character(
    story_id: str, character_id: str, payload: PinRevisionRequest, session: SessionDep
) -> StoryCharacterProfile:
    try:
        return pin_revision(session, story_id, character_id, payload.revision_id, payload.role, payload.color)
    except CharacterNotFoundError as error:
        raise ApiError(404, "not_found", "Персонаж не привязан к истории.") from error
    except InvalidRevisionError as error:
        raise ApiError(422, "validation_error", "Ревизия не принадлежит персонажу.") from error


@router.delete("/stories/{story_id}/characters/{character_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_story_character(story_id: str, character_id: str, session: SessionDep) -> None:
    try:
        detach_character(session, story_id, character_id)
    except CharacterNotFoundError as error:
        raise ApiError(404, "not_found", "Персонаж не привязан к истории.") from error
    except LastCastMemberError as error:
        raise ApiError(409, "conflict", "Нельзя удалить последнего персонажа новеллы.") from error
