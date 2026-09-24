"""Pin story-specific character roles into new and existing sessions."""

from alembic import op
from sqlalchemy import Column, String, text

revision = "20260925_08"
down_revision = "20260924_07"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("session_characters", Column("role", String(), nullable=False, server_default="cast"))
    op.get_bind().execute(text(
        "UPDATE session_characters SET role = COALESCE(("
        "SELECT story_characters.role FROM story_characters "
        "JOIN story_sessions ON story_sessions.story_id = story_characters.story_id "
        "WHERE story_sessions.id = session_characters.session_id "
        "AND story_characters.character_id = session_characters.character_id"
        "), 'cast')"
    ))


def downgrade() -> None:
    with op.batch_alter_table("session_characters") as batch_op:
        batch_op.drop_column("role")
