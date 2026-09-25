"""Pin material provenance to immutable character revisions."""

from alembic import op
from sqlalchemy import Column, ForeignKey, String, UniqueConstraint

revision = "20260925_10"
down_revision = "20260925_09"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("characters", Column("origin_character_id", String(), nullable=True))
    op.create_table(
        "character_materials",
        Column("id", String(), primary_key=True),
        Column("revision_id", String(), ForeignKey("character_revisions.id"), nullable=False),
        Column("kind", String(), nullable=False),
        Column("sha256", String(), nullable=False),
        Column("mime_type", String(), nullable=False),
        Column("filename", String(), nullable=False),
        Column("creator", String(), nullable=False),
        Column("license", String(), nullable=False),
        Column("source", String(), nullable=False),
        Column("created_at", String(), nullable=False),
        UniqueConstraint("revision_id", "kind"),
    )
    op.create_index("ix_character_materials_revision_id", "character_materials", ["revision_id"])


def downgrade() -> None:
    op.drop_index("ix_character_materials_revision_id", table_name="character_materials")
    op.drop_table("character_materials")
    with op.batch_alter_table("characters") as batch:
        batch.drop_column("origin_character_id")
