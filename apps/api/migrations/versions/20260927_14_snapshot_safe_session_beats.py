"""Make session beat identity independent from mutable author draft rows."""

from alembic import op
from sqlalchemy import text

revision = "20260927_14"
down_revision = "20260927_13"
branch_labels = None
depends_on = None

_NAMING = {"fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s"}


def upgrade() -> None:
    with op.batch_alter_table("session_beats", naming_convention=_NAMING) as batch:
        batch.drop_constraint("fk_session_beats_beat_id_story_beats", type_="foreignkey")
        batch.create_index("ix_session_beats_session_status", ["session_id", "status"])


def downgrade() -> None:
    bind = op.get_bind()
    incompatible = list(
        bind.execute(
            text(
                "SELECT DISTINCT sb.beat_id FROM session_beats AS sb "
                "LEFT JOIN story_beats AS b ON b.id = sb.beat_id "
                "WHERE b.id IS NULL ORDER BY sb.beat_id"
            )
        ).scalars()
    )
    if incompatible:
        identifiers = ", ".join(incompatible)
        raise RuntimeError(f"snapshot-only beat IDs cannot downgrade to 20260927_13: {identifiers}")
    with op.batch_alter_table("session_beats", naming_convention=_NAMING) as batch:
        batch.drop_index("ix_session_beats_session_status")
        batch.create_foreign_key(
            "fk_session_beats_beat_id_story_beats",
            "story_beats",
            ["beat_id"],
            ["id"],
        )
