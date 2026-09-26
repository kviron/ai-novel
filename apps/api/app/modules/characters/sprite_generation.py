"""Provider-neutral sprite generation contract and prompt."""

from pydantic import BaseModel, ConfigDict, Field

SPRITE_CONTRACT_VERSION = 1


class SpriteGenerationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    character_id: str
    revision_id: str
    emotion: str = Field(pattern=r"^[a-z][a-z0-9_-]{0,31}$")
    variant: str = Field(default="default", pattern=r"^[a-z][a-z0-9_-]{0,31}$")
    identity_prompt: str = Field(min_length=1, max_length=6000)
    reference_material_id: str | None = None
    sprite_contract_version: int = SPRITE_CONTRACT_VERSION


def sprite_system_prompt() -> str:
    return (
        "Create exactly one production visual-novel character sprite. Output a 1024x1536 RGBA PNG "
        "with a true transparent background (never a checkerboard or flat color). Show one complete adult "
        "character only, full body including hair, hands, clothing, and feet. Keep every visible pixel at "
        "least 24 px from left, right, and top, and 16 px from bottom. Align the bottom-center character "
        "anchor to x=512 with the lowest visible pixel between y=1456 and y=1504. No text, labels, panels, "
        "borders, scenery, shadows cut by the canvas, other people, or duplicated body parts. Preserve identity, "
        "outfit, accessories, camera angle, projection, render style, and scale from the accepted neutral "
        "reference. Express the requested emotion through face, head tilt, torso lean, hands, arms, and gesture. "
        "Return only the image. Sprite contract version: 1."
    )
