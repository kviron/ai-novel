from types import SimpleNamespace

from app.modules.characters.sprite_catalog import sprite_entries


def test_ashley_blushing_sprite_is_available_as_embarrassed_without_replacing_original():
    blush = SimpleNamespace(
        kind="sprite:lust:default",
        source="bundled:ashley/ashley--lust--default.png",
    )

    assert list(sprite_entries([blush])) == [
        ("lust", "default", blush),
        ("embarrassed", "default", blush),
    ]


def test_explicit_embarrassed_sprite_takes_precedence_over_ashley_alias():
    blush = SimpleNamespace(kind="sprite:lust:default", source="bundled:ashley/ashley--lust--default.png")
    explicit = SimpleNamespace(kind="sprite:embarrassed:default", source="uploaded:portrait")

    assert list(sprite_entries([blush, explicit])) == [
        ("lust", "default", blush),
        ("embarrassed", "default", explicit),
    ]
