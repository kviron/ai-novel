"""Pin one protagonist snapshot to each playthrough."""

from alembic import op
from sqlalchemy import Column, ForeignKey, Integer, String, text

revision = "20260926_12"
down_revision = "20260925_11"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("stories", Column("hero_policy", String(), nullable=False, server_default="choice"))
    op.add_column("stories", Column("hero_policy_version", Integer(), nullable=False, server_default="1"))
    op.add_column(
        "stories", Column("hero_allowed_sources", String(), nullable=False, server_default='["catalog", "draft"]')
    )
    op.add_column("stories", Column("fixed_hero_revision_id", String(), nullable=True))
    op.add_column("stories", Column("playable_character_ids", String(), nullable=False, server_default="[]"))
    op.create_table(
        "session_protagonists",
        Column("session_id", String(), ForeignKey("story_sessions.id"), primary_key=True),
        Column("source_kind", String(), nullable=False),
        Column("source_character_id", String(), ForeignKey("characters.id"), nullable=True),
        Column("source_revision_id", String(), ForeignKey("character_revisions.id"), nullable=True),
        Column("policy_version", Integer(), nullable=False),
        Column("name", String(), nullable=False),
        Column("address", String(), nullable=False),
        Column("gender", String(), nullable=False),
        Column("appearance", String(), nullable=False),
        Column("biography", String(), nullable=False),
        Column("personality", String(), nullable=False),
        Column("age", Integer(), nullable=True),
    )
    op.create_table(
        "protagonist_exports",
        Column("session_id", String(), ForeignKey("story_sessions.id"), primary_key=True),
        Column("character_id", String(), ForeignKey("characters.id"), nullable=False, unique=True),
    )
    op.get_bind().execute(
        text(
            "INSERT INTO session_protagonists "
            "(session_id, source_kind, policy_version, name, address, gender, appearance, biography, personality) "
            "SELECT id, 'legacy', 1, 'Игрок', 'Игрок', 'unspecified', '', '', '' FROM story_sessions"
        )
    )


def downgrade() -> None:
    op.drop_table("protagonist_exports")
    op.drop_table("session_protagonists")
    with op.batch_alter_table("stories") as batch:
        batch.drop_column("playable_character_ids")
        batch.drop_column("fixed_hero_revision_id")
        batch.drop_column("hero_allowed_sources")
        batch.drop_column("hero_policy_version")
        batch.drop_column("hero_policy")
