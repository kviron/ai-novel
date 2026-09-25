"""Validated character images and a portable, versioned archive boundary."""

import hashlib
import json
import os
from io import BytesIO
from pathlib import Path
from tempfile import NamedTemporaryFile
from zipfile import ZIP_DEFLATED, BadZipFile, ZipFile

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlmodel import Session

from app.db.models import Character, CharacterMaterial, CharacterRevision

from . import repository
from .schemas import CharacterWrite
from .service import CharacterNotFoundError, _character_profile

MAX_AVATAR_BYTES = 10 * 1024 * 1024
MAX_ARCHIVE_BYTES = 50 * 1024 * 1024
MIME_EXTENSIONS = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}


class InvalidMaterialError(Exception):
    pass


class ArchiveLimitError(InvalidMaterialError):
    pass


class ArchiveMaterial(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: str = "avatar"
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    mime_type: str
    filename: str = Field(min_length=1, max_length=255)
    creator: str = Field(min_length=1, max_length=200)
    license: str = Field(min_length=1, max_length=200)
    source: str = Field(min_length=1, max_length=500)


class ArchiveRevision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    revision_number: int = Field(ge=1)
    profile: CharacterWrite
    avatar: ArchiveMaterial | None = None
    cover: ArchiveMaterial | None = None


class CharacterArchive(BaseModel):
    model_config = ConfigDict(extra="forbid")

    format_version: int = 1
    origin_character_id: str
    current_revision_number: int = Field(ge=1)
    revisions: list[ArchiveRevision] = Field(min_length=1, max_length=100)


def _mime_for_bytes(data: bytes) -> str | None:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def _blob_path(asset_dir: Path, digest: str, mime_type: str) -> Path:
    return asset_dir / f"{digest}.{MIME_EXTENSIONS[mime_type]}"


def _save_blob(asset_dir: Path, data: bytes, mime_type: str) -> str:
    digest = hashlib.sha256(data).hexdigest()
    destination = _blob_path(asset_dir, digest, mime_type)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        if hashlib.sha256(destination.read_bytes()).hexdigest() != digest:
            raise InvalidMaterialError("Stored material hash mismatch")
        return digest
    # The digest path must become visible only after the complete blob has been written.
    with NamedTemporaryFile(dir=destination.parent, prefix=".material-", delete=False) as temporary:
        temporary.write(data)
        temporary_path = Path(temporary.name)
    try:
        os.replace(temporary_path, destination)
    finally:
        temporary_path.unlink(missing_ok=True)
    return digest


def seed_builtin_materials(session: Session, asset_dir: Path) -> None:
    """Register shipped portraits once; never replace an author's newer revision."""
    repository_root = Path(__file__).resolve().parents[5]
    portraits = {
        "akane": "akane-avatar-v1.png",
        "mark": "mark-avatar-v1.png",
    }
    for character_id, filename in portraits.items():
        character = session.get(Character, character_id)
        if character is None or character.current_revision_id is None:
            continue
        first_revision = repository.list_revisions(session, character_id)[0]
        revision_id = first_revision.id
        if repository.material_for_revision(session, revision_id) is not None:
            continue
        path = repository_root / "apps" / "web" / "src" / "shared" / "ui" / "characters" / filename
        digest = _save_blob(asset_dir, path.read_bytes(), "image/png")
        session.add(
            CharacterMaterial(
                revision_id=revision_id,
                kind="avatar",
                sha256=digest,
                mime_type="image/png",
                filename=filename,
                creator="AI Visual Novel project (AI-assisted)",
                license="Unspecified; verify before redistribution",
                source=f"bundled:{filename}",
            )
        )


def avatar_bytes(asset_dir: Path, material: CharacterMaterial) -> bytes:
    path = _blob_path(asset_dir, material.sha256, material.mime_type)
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != material.sha256:
        raise InvalidMaterialError("Material hash mismatch")
    return data


def upload_material(
    session: Session,
    asset_dir: Path,
    character_id: str,
    data: bytes,
    *,
    mime_type: str,
    filename: str,
    creator: str,
    license: str,
    source: str,
    kind: str,
):
    character = session.get(Character, character_id)
    if character is None:
        raise CharacterNotFoundError
    if (
        not data
        or len(data) > MAX_AVATAR_BYTES
        or mime_type not in MIME_EXTENSIONS
        or _mime_for_bytes(data) != mime_type
    ):
        raise InvalidMaterialError("Invalid image")
    if not all((filename.strip(), creator.strip(), license.strip(), source.strip())):
        raise InvalidMaterialError("Material provenance is required")
    previous = session.get(CharacterRevision, character.current_revision_id)
    if kind not in {"avatar", "cover"}:
        raise InvalidMaterialError("Unsupported material kind")
    digest = _save_blob(asset_dir, data, mime_type)
    revision = CharacterRevision(
        character_id=character.id,
        revision_number=repository.list_revisions(session, character.id)[-1].revision_number + 1,
        **{field: getattr(previous, field) for field in CharacterWrite.model_fields},
    )
    session.add(revision)
    session.flush()
    for old_material in repository.materials_for_revision(session, previous.id):
        if old_material.kind == kind:
            continue
        session.add(
            CharacterMaterial(
                revision_id=revision.id,
                kind=old_material.kind,
                sha256=old_material.sha256,
                mime_type=old_material.mime_type,
                filename=old_material.filename,
                creator=old_material.creator,
                license=old_material.license,
                source=old_material.source,
            )
        )
    session.add(
        CharacterMaterial(
            revision_id=revision.id,
            kind=kind,
            sha256=digest,
            mime_type=mime_type,
            filename=Path(filename).name[:255],
            creator=creator.strip()[:200],
            license=license.strip()[:200],
            source=source.strip()[:500],
        )
    )
    character.current_revision_id = revision.id
    session.commit()
    return _character_profile(session, character, revision)


def export_character(session: Session, asset_dir: Path, character_id: str) -> bytes:
    character = session.get(Character, character_id)
    if character is None:
        raise CharacterNotFoundError
    revisions = repository.list_revisions(session, character_id)
    if len(revisions) > 100:
        raise ArchiveLimitError("Character has too many revisions for the portable archive")
    current = next(item for item in revisions if item.id == character.current_revision_id)
    manifest_revisions = []
    blobs: dict[str, bytes] = {}
    for revision in revisions:
        archive_materials = {}
        for material in repository.materials_for_revision(session, revision.id):
            archive_materials[material.kind] = ArchiveMaterial(
                **{field: getattr(material, field) for field in ArchiveMaterial.model_fields}
            )
            entry = f"assets/{material.sha256}.{MIME_EXTENSIONS[material.mime_type]}"
            blobs[entry] = avatar_bytes(asset_dir, material)
        manifest_revisions.append(
            ArchiveRevision(
                revision_number=revision.revision_number,
                profile=CharacterWrite(**{field: getattr(revision, field) for field in CharacterWrite.model_fields}),
                avatar=archive_materials.get("avatar"),
                cover=archive_materials.get("cover"),
            )
        )
    manifest = CharacterArchive(
        origin_character_id=character.origin_character_id or character.id,
        current_revision_number=current.revision_number,
        revisions=manifest_revisions,
    )
    output = BytesIO()
    with ZipFile(output, "w", compression=ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", manifest.model_dump_json(indent=2))
        for name, data in blobs.items():
            archive.writestr(name, data)
    content = output.getvalue()
    if len(content) > MAX_ARCHIVE_BYTES:
        raise ArchiveLimitError("Character archive exceeds the portable size limit")
    return content


def import_character(session: Session, asset_dir: Path, data: bytes):
    if not data or len(data) > MAX_ARCHIVE_BYTES:
        raise InvalidMaterialError("Archive too large or empty")
    try:
        with ZipFile(BytesIO(data)) as package:
            entries = package.infolist()
            names = [item.filename for item in entries]
            if len(entries) > 201 or len(names) != len(set(names)) or "manifest.json" not in names:
                raise InvalidMaterialError("Invalid archive entries")
            if any(item.file_size > MAX_AVATAR_BYTES for item in entries if item.filename != "manifest.json"):
                raise InvalidMaterialError("Archive material too large")
            if package.getinfo("manifest.json").file_size > 128 * 1024:
                raise InvalidMaterialError("Manifest too large")
            manifest = CharacterArchive.model_validate(json.loads(package.read("manifest.json")))
            if manifest.format_version != 1 or [r.revision_number for r in manifest.revisions] != list(
                range(1, len(manifest.revisions) + 1)
            ):
                raise InvalidMaterialError("Unsupported archive revision sequence")
            if manifest.current_revision_number > len(manifest.revisions):
                raise InvalidMaterialError("Invalid current revision")
            expected = {"manifest.json"}
            blobs: dict[str, tuple[bytes, str]] = {}
            for revision in manifest.revisions:
                for kind, material in (("avatar", revision.avatar), ("cover", revision.cover)):
                    if material is None:
                        continue
                    if material.kind != kind or material.mime_type not in MIME_EXTENSIONS:
                        raise InvalidMaterialError("Unsupported material")
                    entry = f"assets/{material.sha256}.{MIME_EXTENSIONS[material.mime_type]}"
                    expected.add(entry)
                    content = package.read(entry)
                    if (
                        len(content) > MAX_AVATAR_BYTES
                        or hashlib.sha256(content).hexdigest() != material.sha256
                        or _mime_for_bytes(content) != material.mime_type
                    ):
                        raise InvalidMaterialError("Corrupt material")
                    blobs[entry] = (content, material.mime_type)
            if set(names) != expected:
                raise InvalidMaterialError("Unexpected archive entries")
    except (BadZipFile, KeyError, ValueError, ValidationError, json.JSONDecodeError, RuntimeError) as error:
        raise InvalidMaterialError("Invalid character archive") from error

    for content, mime_type in blobs.values():
        _save_blob(asset_dir, content, mime_type)
    first = manifest.revisions[0].profile
    character = Character(
        source_type="imported",
        origin_character_id=manifest.origin_character_id,
        **first.model_dump(include={"name", "gender", "age", "personality", "appearance"}),
    )
    session.add(character)
    session.flush()
    current = None
    for item in manifest.revisions:
        revision = CharacterRevision(
            character_id=character.id, revision_number=item.revision_number, **item.profile.model_dump()
        )
        session.add(revision)
        session.flush()
        for material in (item.avatar, item.cover):
            if material:
                session.add(CharacterMaterial(revision_id=revision.id, **material.model_dump()))
        if item.revision_number == manifest.current_revision_number:
            current = revision
    character.current_revision_id = current.id
    session.commit()
    return _character_profile(session, character, current)
