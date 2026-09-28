"""Read-only emotion aliases for shipped character art."""

from collections.abc import Iterator

from app.db.models import CharacterMaterial


def sprite_entries(materials: list[CharacterMaterial]) -> Iterator[tuple[str, str, CharacterMaterial]]:
    """Expose Ashley's blushing art as embarrassment without changing saved revisions."""
    entries = []
    for material in materials:
        if material.kind.startswith("sprite:"):
            _, emotion, variant = material.kind.split(":", 2)
            entries.append((emotion, variant, material))
    yield from entries
    if any(emotion == "embarrassed" and variant == "default" for emotion, variant, _ in entries):
        return
    for emotion, variant, material in entries:
        if (
            emotion == "lust"
            and variant == "default"
            and material.source == "bundled:ashley/ashley--lust--default.png"
        ):
            yield "embarrassed", "default", material
            return
