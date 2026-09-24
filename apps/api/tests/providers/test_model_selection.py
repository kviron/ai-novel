import pytest

from app.modules.providers.model_selection import UnsupportedModelError, choose_model


def test_stale_default_falls_back_to_installed_model() -> None:
    assert choose_model(["local:small", "local:large"], None, "old:missing") == "local:small"


def test_explicit_missing_model_is_rejected() -> None:
    with pytest.raises(UnsupportedModelError):
        choose_model(["local:small"], "old:missing", "local:small")
