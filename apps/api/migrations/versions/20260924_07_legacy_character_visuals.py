"""Distinguish migrated cast from newly authored characters for replay rules."""

from alembic import op
from sqlalchemy import text

revision = "20260924_07"
down_revision = "20260924_06"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.get_bind().execute(text(
        "UPDATE characters SET source_type = 'legacy' "
        "WHERE source_type = 'local' AND id IN ("
        "SELECT character_id FROM character_revisions "
        "WHERE revision_number = 1 AND created_at = '1970-01-01T00:00:00+00:00'"
        ")"
    ))


def downgrade() -> None:
    op.get_bind().execute(text("UPDATE characters SET source_type = 'local' WHERE source_type = 'legacy'"))
