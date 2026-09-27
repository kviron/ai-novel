"""Store branch-scoped derived memory without changing canonical turns."""

from alembic import op
import sqlalchemy as sa

revision = "20260927_15"
down_revision = "20260927_14"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "memory_segments",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("session_id", sa.String(), sa.ForeignKey("story_sessions.id"), nullable=False),
        sa.Column("end_turn_id", sa.String(), sa.ForeignKey("turns.id"), nullable=False),
        sa.Column("source_turn_ids", sa.String(), nullable=False),
        sa.Column("summary", sa.String(), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.UniqueConstraint("session_id", "end_turn_id"),
    )
    op.create_index("ix_memory_segments_session_id", "memory_segments", ["session_id"])
    op.create_index("ix_memory_segments_end_turn_id", "memory_segments", ["end_turn_id"])


def downgrade() -> None:
    op.drop_index("ix_memory_segments_end_turn_id", table_name="memory_segments")
    op.drop_index("ix_memory_segments_session_id", table_name="memory_segments")
    op.drop_table("memory_segments")
