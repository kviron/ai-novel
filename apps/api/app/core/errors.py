from typing import Literal

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
