"""Allow a catalog character to exist before attachment to any story."""

from alembic import op
from sqlalchemy import String

revision = "20260924_06"
down_revision = "20260924_05"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Old installs may contain profiles predating the adult-only write policy.
    # Keep those records intact; new API writes validate age before persistence.
    with op.batch_alter_table("characters") as batch:
        batch.alter_column("story_id", existing_type=String(), nullable=True)


def downgrade() -> None:
    with op.batch_alter_table("characters") as batch:
        batch.alter_column("story_id", existing_type=String(), nullable=False)
