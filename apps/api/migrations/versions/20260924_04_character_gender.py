"""Store character gender for catalog filters without guessing from names."""

from alembic import op
from sqlalchemy import Column, String, text

revision = "20260924_04"
down_revision = "20260924_03"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("characters", Column("gender", String(), nullable=False, server_default="unspecified"))
    # Existing seeded installs predate this field; preserve other characters as unspecified.
    op.get_bind().execute(text("UPDATE characters SET gender = 'female' WHERE id = 'akane'"))


def downgrade() -> None:
    op.drop_column("characters", "gender")
