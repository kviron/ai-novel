"""Immutable, content-addressed story cover materials."""

from io import BytesIO
from pathlib import Path

from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, ConfigDict
from sqlmodel import Session

from app.db.models import Story, StoryMaterial
from app.modules.characters.materials import MIME_EXTENSIONS, _mime_for_bytes, _save_blob

MAX_COVER_BYTES = 10 * 1024 * 1024


class InvalidCoverError(Exception):
    pass


class StoryCoverMaterial(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    sha256: str
    mime_type: str
    filename: str
    creator: str
    license: str
    source: str


def save_story_cover(
    session: Session,
    asset_dir: Path,
    story_id: str,
    data: bytes,
    *,
    mime_type: str,
    filename: str,
    creator: str,
    license: str,
    source: str,
) -> StoryCoverMaterial:
    if session.get(Story, story_id) is None:
        raise LookupError(f"Story not found: {story_id}")
    if (
        not data
        or len(data) > MAX_COVER_BYTES
        or mime_type not in MIME_EXTENSIONS
        or _mime_for_bytes(data) != mime_type
    ):
        raise InvalidCoverError("Invalid cover image")
    if not all((filename.strip(), creator.strip(), license.strip(), source.strip())) or any(
        separator in filename for separator in ("/", "\\", ":")
    ):
        raise InvalidCoverError("Cover provenance is required; filename must be a name")
    try:
        with Image.open(BytesIO(data)) as image:
            image.verify()
    except (UnidentifiedImageError, OSError) as error:
        raise InvalidCoverError("Invalid cover image") from error

    digest = _save_blob(asset_dir, data, mime_type)
    material = StoryMaterial(
        story_id=story_id,
        sha256=digest,
        mime_type=mime_type,
        filename=filename.strip(),
        creator=creator.strip(),
        license=license.strip(),
        source=source.strip(),
        asset_path=f"{digest}.{MIME_EXTENSIONS[mime_type]}",
    )
    session.add(material)
    session.commit()
    session.refresh(material)
    return StoryCoverMaterial.model_validate(material, from_attributes=True)
