"""Reconcile databases that applied the first materials migration early.

Revision 10 was expanded during development after a local database had already
applied it. Keep this repair separate so that database upgrades are additive.
"""

from alembic import op
from sqlalchemy import Column, String, inspect

revision = "20260925_11"
down_revision = "20260925_10"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {column["name"] for column in inspect(op.get_bind()).get_columns("characters")}
    if "origin_character_id" not in columns:
        op.add_column("characters", Column("origin_character_id", String(), nullable=True))


def downgrade() -> None:
    # Revision 10 owns this column; undoing the repair must not remove it.
    pass
