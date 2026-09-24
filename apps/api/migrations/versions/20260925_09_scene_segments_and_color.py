"""Store ordered scene segments and pin story-specific cast colors."""

from alembic import op
from sqlalchemy import Column, String

revision = "20260925_09"
down_revision = "20260925_08"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("turns", Column("segments", String(), nullable=True))
    op.add_column("story_characters", Column("color", String(), nullable=False, server_default="#D9A75F"))
    op.add_column("session_characters", Column("color", String(), nullable=False, server_default="#D9A75F"))


def downgrade() -> None:
    with op.batch_alter_table("session_characters") as batch:
        batch.drop_column("color")
    with op.batch_alter_table("story_characters") as batch:
        batch.drop_column("color")
    with op.batch_alter_table("turns") as batch:
        batch.drop_column("segments")
