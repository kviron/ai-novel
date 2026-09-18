from typing import Literal

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from starlette.exceptions import HTTPException as StarletteHTTPException


class ErrorResponse(BaseModel):
    """Stable, safe error body shared by every public API failure."""

    model_config = ConfigDict(extra="forbid")

    code: str
    detail: str
    retryable: bool = False


class ApiError(Exception):
    """Public error metadata separated from internal exception diagnostics."""

    def __init__(self, status_code: int, code: str, detail: str, *, retryable: bool = False) -> None:
        super().__init__(code)
        self.status_code = status_code
        self.response = ErrorResponse(code=code, detail=detail, retryable=retryable)


def install_exception_handlers(app: FastAPI) -> None:
    """Install the single public error representation for domain and framework failures."""

    @app.exception_handler(ApiError)
    async def api_error_handler(_request: Request, error: ApiError) -> JSONResponse:
        return JSONResponse(status_code=error.status_code, content=error.response.model_dump())

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(_request: Request, _error: RequestValidationError) -> JSONResponse:
        response = ErrorResponse(
            code="validation_error",
            detail="Проверьте правильность заполнения обязательных полей.",
        )
        return JSONResponse(status_code=422, content=response.model_dump())

    @app.exception_handler(StarletteHTTPException)
    async def http_error_handler(_request: Request, error: StarletteHTTPException) -> JSONResponse:
        if error.status_code == 404:
            response = ErrorResponse(code="not_found", detail="Запрошенный ресурс не найден.")
        else:
            response = ErrorResponse(code="http_error", detail="Не удалось выполнить запрос.")
        return JSONResponse(status_code=error.status_code, content=response.model_dump())

ProviderErrorCode = Literal[
    "provider_unavailable",
    "model_unavailable",
    "provider_invalid_response",
]


class ProviderUnavailableError(Exception):
    """The provider could not complete an HTTP request."""

    code: ProviderErrorCode = "provider_unavailable"

    def __init__(self, *, raw_response: str | None = None) -> None:
        super().__init__("Provider is unavailable")
        self.raw_response = raw_response


class ProviderResponseError(Exception):
    """The provider returned an unusable response or rejected a model."""

    def __init__(
        self,
        code: Literal["model_unavailable", "provider_invalid_response"] = "provider_invalid_response",
        *,
        raw_response: str | None = None,
    ) -> None:
        message = (
            "Provider returned an invalid response"
            if code == "provider_invalid_response"
            else "Model is unavailable"
        )
        super().__init__(message)
        self.code: ProviderErrorCode = code
        self.raw_response = raw_response
