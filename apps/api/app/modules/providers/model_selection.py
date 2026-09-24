"""Provider-owned policy for listing and validating installed models."""

from app.core.errors import ProviderResponseError, ProviderUnavailableError

from .service import ProviderRegistry


class UnsupportedModelError(Exception):
    pass


class NoAvailableModelError(Exception):
    pass


def available_models(registry: ProviderRegistry, provider_id: str) -> list[str]:
    try:
        models = registry.get(provider_id).list_models()
    except KeyError as error:
        raise UnsupportedModelError from error
    except (ProviderUnavailableError, ProviderResponseError) as error:
        raise NoAvailableModelError from error
    if not models:
        raise NoAvailableModelError
    return models


def choose_model(models: list[str], requested: str | None, configured: str) -> str:
    # A stale configured default must not prevent starting when Ollama has another model.
    model = requested or (configured if configured in models else models[0])
    if model not in models:
        raise UnsupportedModelError
    return model
