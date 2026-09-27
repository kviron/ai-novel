"""Local authoring HTTP boundary over the draft lifecycle service."""

import json
from contextlib import contextmanager
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query, Request, status
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlmodel import Session, select

from app.core.config import RuntimeSettingsDep
from app.core.errors import ApiError, DraftConflictResponse, DraftInvalidResponse, ErrorResponse
from app.db.engine import get_session
from app.db.models import SessionBeat, StoryDraftSnapshot, StoryMaterial, StorySession
from app.modules.providers.model_selection import NoAvailableModelError, UnsupportedModelError, available_models
from app.modules.providers.router import ProviderRegistryDep
from app.modules.stories.protagonist import HeroSelectionError
from app.modules.stories.schemas import SessionDetail
from app.modules.story_authoring.cover import MAX_COVER_BYTES, InvalidCoverError, StoryCoverMaterial, save_story_cover
from app.modules.story_authoring.definition import load_published_story_version, load_story_draft
from app.modules.story_authoring.presentation import public_diagnostics, public_draft, public_validation
from app.modules.story_authoring.schemas import (
    DraftValidationResult,
    StoryCanonSection,
    StoryCastSection,
    StoryDraft,
    StoryHeroSection,
    StoryIdentitySection,
    StoryModeSection,
    StoryRulesSection,
)
from app.modules.story_authoring.service import (
    DraftConflictError,
    DraftInvalidError,
    ModeChangeConflictError,
    create_draft_from_version,
    create_story_draft,
    publish_draft,
    replace_draft_section,
    validate_story_draft,
)
from app.modules.story_authoring.sessions import AuthorTestSessionRequest, create_author_test_session

router = APIRouter(prefix="/api/author/stories", tags=["Авторская студия"])
version_router = APIRouter(prefix="/api/stories", tags=["Истории"])
material_router = APIRouter(prefix="/api", tags=["Истории"])
SessionDep = Annotated[Session, Depends(get_session)]
SectionName = Literal["identity", "mode", "hero", "cast", "rules", "canon"]
_SECTION_TYPES = {
    "identity": StoryIdentitySection,
    "mode": StoryModeSection,
    "hero": StoryHeroSection,
    "cast": StoryCastSection,
    "rules": StoryRulesSection,
    "canon": StoryCanonSection,
}


class SectionUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_revision: int = Field(ge=1)
    data: dict[str, Any]


class AuthorSessionAudit(BaseModel):
    session_id: str
    source: Literal["draft_snapshot", "published_version"]
    story_version_id: str | None
    draft_snapshot_id: str | None
    snapshot_sha256: str | None
    source_draft_revision: int | None
    snapshot_title: str | None
    snapshot_premise: str | None
    completed_beat_ids: list[str]


def _available_models(registry: ProviderRegistryDep) -> list[str]:
    try:
        return available_models(registry, "ollama")
    except (NoAvailableModelError, UnsupportedModelError):
        return []


@contextmanager
def _author_errors(missing_code: str = "story_not_found"):
    try:
        yield
    except LookupError as error:
        raise ApiError(404, missing_code, "История или версия не найдена.") from error
    except DraftConflictError as error:
        raise ApiError(
            409,
            "draft_conflict",
            "Черновик был изменён. Обновите его и повторите сохранение.",
            latest_revision=error.latest_revision,
        ) from error
    except DraftInvalidError as error:
        diagnostics = [item.model_dump() for item in public_diagnostics(error.diagnostics)]
        raise ApiError(
            422, "draft_invalid", "Исправьте ошибки черновика перед продолжением.", diagnostics=diagnostics
        ) from error
    except ModeChangeConflictError as error:
        raise ApiError(
            422, "mode_change_conflict", "Смена режима удалит несовместимые данные. Подтвердите действие."
        ) from error
    except HeroSelectionError as error:
        raise ApiError(422, "hero_not_allowed", "Выбранный герой недоступен в этой новелле.") from error
    except UnsupportedModelError as error:
        raise ApiError(422, "validation_error", "Выбранные провайдер или модель не поддерживаются.") from error
    except NoAvailableModelError as error:
        raise ApiError(503, "model_unavailable", "Нет доступных моделей Ollama.", retryable=True) from error


@router.post("", status_code=status.HTTP_201_CREATED, response_model=StoryDraft)
def create_story(session: SessionDep, payload: StoryIdentitySection | None = None) -> StoryDraft:
    with _author_errors():
        return public_draft(create_story_draft(session, payload))


@router.get("/{story_id}/draft", response_model=StoryDraft, responses={404: {"model": ErrorResponse}})
def get_draft(story_id: str, session: SessionDep, registry: ProviderRegistryDep) -> StoryDraft:
    with _author_errors():
        draft = load_story_draft(session, story_id)
        draft.diagnostics = validate_story_draft(
            session, story_id, available_models=_available_models(registry)
        ).diagnostics
        return public_draft(draft)


@router.put(
    "/{story_id}/draft/{section}",
    response_model=StoryDraft,
    responses={409: {"model": DraftConflictResponse}, 422: {"model": DraftInvalidResponse}},
)
def save_section(
    story_id: str,
    section: SectionName,
    payload: SectionUpdate,
    session: SessionDep,
    registry: ProviderRegistryDep,
    confirm_mode_change: bool = False,
) -> StoryDraft:
    with _author_errors():
        try:
            data = _SECTION_TYPES[section].model_validate(payload.data)
        except ValidationError as error:
            raise ApiError(422, "validation_error", "Проверьте поля раздела черновика.") from error
        draft = replace_draft_section(
            session,
            story_id,
            section,
            data,
            payload.expected_revision,
            confirm_mode_change=confirm_mode_change,
            available_models=_available_models(registry),
        )
        return public_draft(draft)


@router.post("/{story_id}/validate", response_model=DraftValidationResult)
def validate_story(story_id: str, session: SessionDep, registry: ProviderRegistryDep) -> DraftValidationResult:
    with _author_errors():
        result = validate_story_draft(session, story_id, available_models=_available_models(registry))
        return public_validation(result)


@router.post("/{story_id}/publish", response_model=StoryDraft, responses={422: {"model": DraftInvalidResponse}})
def publish_story(story_id: str, session: SessionDep, registry: ProviderRegistryDep) -> StoryDraft:
    with _author_errors():
        return public_draft(publish_draft(session, story_id, available_models=_available_models(registry)))


@router.post("/{story_id}/draft-from/{version_id}", status_code=status.HTTP_201_CREATED, response_model=StoryDraft)
def clone_published_story(story_id: str, version_id: str, session: SessionDep) -> StoryDraft:
    with _author_errors("version_not_found"):
        return public_draft(create_draft_from_version(session, story_id, version_id))


@router.post(
    "/{story_id}/test-sessions",
    status_code=status.HTTP_201_CREATED,
    response_model=SessionDetail,
    responses={422: {"model": DraftInvalidResponse}, 503: {"model": ErrorResponse}},
)
def start_test_session(
    story_id: str,
    session: SessionDep,
    settings: RuntimeSettingsDep,
    registry: ProviderRegistryDep,
    payload: AuthorTestSessionRequest | None = None,
) -> SessionDetail:
    with _author_errors():
        return create_author_test_session(
            session, story_id, payload or AuthorTestSessionRequest(), settings.ollama_model, registry
        )


@router.get("/test-sessions/{session_id}/audit", response_model=AuthorSessionAudit)
def author_session_audit(session_id: str, session: SessionDep) -> AuthorSessionAudit:
    game = session.get(StorySession, session_id)
    if game is None or game.kind != "author":
        raise ApiError(404, "session_not_found", "Авторская тестовая сессия не найдена.")
    snapshot = session.get(StoryDraftSnapshot, game.draft_snapshot_id) if game.draft_snapshot_id else None
    payload = json.loads(snapshot.payload) if snapshot else None
    completed = session.exec(
        select(SessionBeat).where(SessionBeat.session_id == session_id, SessionBeat.status == "completed")
    ).all()
    return AuthorSessionAudit(
        session_id=game.id,
        source="draft_snapshot" if snapshot else "published_version",
        story_version_id=game.story_version_id,
        draft_snapshot_id=game.draft_snapshot_id,
        snapshot_sha256=snapshot.sha256 if snapshot else None,
        source_draft_revision=snapshot.source_draft_revision if snapshot else None,
        snapshot_title=payload["identity"]["title"] if payload else None,
        snapshot_premise=payload["identity"]["premise"] if payload else None,
        completed_beat_ids=sorted(beat.beat_id for beat in completed),
    )


@router.post("/{story_id}/draft/cover", status_code=status.HTTP_201_CREATED, response_model=StoryCoverMaterial)
async def upload_cover(
    story_id: str,
    request: Request,
    session: SessionDep,
    settings: RuntimeSettingsDep,
    filename: Annotated[str, Query(min_length=1, max_length=255)],
    creator: Annotated[str, Query(min_length=1, max_length=200)],
    license: Annotated[str, Query(min_length=1, max_length=200)],
    source: Annotated[str, Query(min_length=1, max_length=500)],
) -> StoryCoverMaterial:
    with _author_errors():
        load_story_draft(session, story_id)
        data = bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data) > MAX_COVER_BYTES:
                raise ApiError(413, "cover_too_large", "Обложка превышает допустимый размер 10 МБ.")
        try:
            return save_story_cover(
                session,
                settings.asset_dir,
                story_id,
                bytes(data),
                mime_type=request.headers.get("content-type", ""),
                filename=filename,
                creator=creator,
                license=license,
                source=source,
            )
        except InvalidCoverError as error:
            raise ApiError(
                422, "invalid_material", "Нужна обложка PNG, JPEG или WebP и сведения об авторстве."
            ) from error


@version_router.get(
    "/{story_id}/versions/{version_id}", response_model=StoryDraft, responses={404: {"model": ErrorResponse}}
)
def get_published_version(story_id: str, version_id: str, session: SessionDep) -> StoryDraft:
    with _author_errors("version_not_found"):
        return load_published_story_version(session, story_id, version_id)


@material_router.get("/story-materials/{material_id}")
def get_story_material(material_id: str, session: SessionDep, settings: RuntimeSettingsDep) -> Response:
    material = session.get(StoryMaterial, material_id)
    if material is None:
        raise ApiError(404, "not_found", "Материал обложки не найден.")
    asset_root = settings.asset_dir.resolve()
    path = (asset_root / material.asset_path).resolve()
    if path.parent != asset_root:
        raise ApiError(404, "not_found", "Материал обложки не найден.")
    try:
        content = path.read_bytes()
    except OSError as error:
        raise ApiError(404, "not_found", "Материал обложки не найден.") from error
    return Response(
        content,
        media_type=material.mime_type,
        headers={"Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff"},
    )
