"""Copy story-owned profiles into global identities and pinned revisions."""

from uuid import NAMESPACE_URL, uuid5

from alembic import op
from sqlalchemy import Column, ForeignKey, Integer, String, UniqueConstraint, text

revision = "20260924_05"
down_revision = "20260924_04"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "character_revisions",
        Column("id", String(), primary_key=True),
        Column("character_id", String(), ForeignKey("characters.id"), nullable=False),
        Column("revision_number", Integer(), nullable=False),
        Column("name", String(), nullable=False),
        Column("gender", String(), nullable=False),
        Column("age", Integer(), nullable=False),
        Column("personality", String(), nullable=False),
        Column("appearance", String(), nullable=False),
        Column("biography", String(), nullable=False, server_default=""),
        Column("speech", String(), nullable=False, server_default=""),
        Column("role", String(), nullable=False, server_default=""),
        Column("created_at", String(), nullable=False),
        UniqueConstraint("character_id", "revision_number", name="uq_character_revision_number"),
    )
    op.create_table(
        "story_characters",
        Column("story_id", String(), ForeignKey("stories.id"), primary_key=True),
        Column("character_id", String(), ForeignKey("characters.id"), primary_key=True),
        Column("revision_id", String(), ForeignKey("character_revisions.id"), nullable=False),
        Column("role", String(), nullable=False, server_default="cast"),
    )
    op.create_table(
        "session_characters",
        Column("session_id", String(), ForeignKey("story_sessions.id"), primary_key=True),
        Column("character_id", String(), ForeignKey("characters.id"), primary_key=True),
        Column("revision_id", String(), ForeignKey("character_revisions.id"), nullable=False),
    )
    op.add_column("characters", Column("current_revision_id", String(), nullable=True))
    op.add_column("characters", Column("source_type", String(), nullable=False, server_default="local"))

    bind = op.get_bind()
    old_characters = list(bind.execute(text(
        "SELECT id, story_id, name, gender, age, personality, appearance FROM characters ORDER BY id"
    )).mappings())
    for character in old_characters:
        revision_id = str(uuid5(NAMESPACE_URL, f"character-revision:{character['id']}:1"))
        bind.execute(text(
            "INSERT INTO character_revisions "
            "(id, character_id, revision_number, name, gender, age, personality, appearance, created_at) "
            "VALUES (:id, :character_id, 1, :name, :gender, :age, :personality, :appearance, :created_at)"
        ), {
            **character,
            "id": revision_id,
            "character_id": character["id"],
            "created_at": "1970-01-01T00:00:00+00:00",
        })
        bind.execute(text("UPDATE characters SET current_revision_id = :revision_id WHERE id = :character_id"), {
            "revision_id": revision_id, "character_id": character["id"]
        })
        bind.execute(text(
            "INSERT INTO story_characters (story_id, character_id, revision_id) "
            "VALUES (:story_id, :character_id, :revision_id)"
        ), {"story_id": character["story_id"], "character_id": character["id"], "revision_id": revision_id})
        bind.execute(text(
            "INSERT INTO session_characters (session_id, character_id, revision_id) "
            "SELECT id, :character_id, :revision_id FROM story_sessions WHERE story_id = :story_id"
        ), {"story_id": character["story_id"], "character_id": character["id"], "revision_id": revision_id})
        if character["id"] in {"akane", "mark"}:
            bind.execute(text("UPDATE characters SET source_type = 'builtin' WHERE id = :character_id"), {
                "character_id": character["id"]
            })


def downgrade() -> None:
    op.drop_column("characters", "source_type")
    op.drop_column("characters", "current_revision_id")
    op.drop_table("session_characters")
    op.drop_table("story_characters")
    op.drop_table("character_revisions")
