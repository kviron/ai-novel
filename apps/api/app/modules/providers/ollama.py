from typing import Any

import httpx
from pydantic import ValidationError

from app.core.errors import ProviderResponseError, ProviderUnavailableError
from app.modules.story_engine.contracts import TurnProposal

from .contracts import ProviderStatus, TurnGenerationRequest


class OllamaProvider:
    """Translate the provider-neutral contract to and from Ollama's HTTP API."""

    provider_id = "ollama"

    def __init__(
        self,
        base_url: str,
        timeout_seconds: float,
        client: httpx.Client | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout_seconds = timeout_seconds
        self._client = client or httpx.Client()

    def health(self) -> ProviderStatus:
        models = self.list_models()
        return ProviderStatus(
            provider_id=self.provider_id,
            available=True,
            detail="available",
            models=models,
        )

    def list_models(self) -> list[str]:
        response = self._request("GET", "/api/tags")
        try:
            payload = response.json()
            models = payload["models"]
            if not isinstance(models, list):
                raise TypeError("models must be a list")
            names = [model["name"] for model in models]
            if not all(isinstance(name, str) for name in names):
                raise TypeError("model names must be strings")
            return names
        except (KeyError, TypeError, ValueError) as error:
            raise ProviderResponseError(raw_response=response.text) from error

    def generate_turn(self, request: TurnGenerationRequest) -> TurnProposal:
        response_schema = request.model_dump(
            mode="json",
            include={"response_schema"},
        )["response_schema"]
        response = self._request(
            "POST",
            "/api/chat",
            model_id=request.model_id,
            json={
                "model": request.model_id,
                "messages": [
                    {"role": "system", "content": request.system_prompt},
                    {"role": "user", "content": request.user_prompt},
                ],
                "stream": False,
                "format": response_schema,
                "options": {"num_ctx": request.context_tokens},
            },
        )
        try:
            payload = response.json()
            content = payload["message"]["content"]
            if not isinstance(content, str):
                raise TypeError("message content must be a string")
        except (KeyError, TypeError, ValueError) as error:
            raise ProviderResponseError(raw_response=response.text) from error

        try:
            return TurnProposal.model_validate_json(content)
        except (ValidationError, ValueError):
            invalid_response = ProviderResponseError(raw_response=response.text)
        raise invalid_response

    def _request(
        self,
        method: str,
        path: str,
        *,
        model_id: str | None = None,
        json: dict[str, Any] | None = None,
    ) -> httpx.Response:
        try:
            response = self._client.request(
                method,
                f"{self._base_url}{path}",
                json=json,
                timeout=self._timeout_seconds,
            )
        except (httpx.RequestError, httpx.TimeoutException) as error:
            raise ProviderUnavailableError() from error

        if response.status_code == 404 and model_id is not None:
            raise ProviderResponseError("model_unavailable", raw_response=response.text)
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as error:
            raise ProviderUnavailableError(raw_response=response.text) from error
        return response
