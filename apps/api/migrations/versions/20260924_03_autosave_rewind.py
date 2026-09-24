"""Preserve turn ancestry and select one player autosave per story."""

from alembic import op
from sqlalchemy import Column, ForeignKey, Integer, String, text


revision = "20260924_03"
down_revision = "20260924_02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("story_sessions", Column("active_turn_id", String(), nullable=True))
    op.add_column("story_sessions", Column("rewind_count", Integer(), nullable=False, server_default="0"))
    op.add_column("turns", Column("parent_turn_id", String(), nullable=True))
    op.add_column("turns", Column("scene_after", String(), nullable=False, server_default=""))
    op.create_table(
        "autosaves",
        Column("story_id", String(), ForeignKey("stories.id"), primary_key=True),
        Column("session_id", String(), ForeignKey("story_sessions.id"), nullable=False),
    )

    bind = op.get_bind()
    games = bind.execute(text("SELECT id, story_id, current_scene, kind FROM story_sessions")).mappings()
    for game in games:
        turns = bind.execute(
            text("SELECT id FROM turns WHERE session_id = :session_id ORDER BY state_version, id"),
            {"session_id": game["id"]},
        ).scalars()
        parent = None
        for turn_id in turns:
            bind.execute(
                text("UPDATE turns SET parent_turn_id = :parent, scene_after = :scene WHERE id = :id"),
                {"parent": parent, "scene": game["current_scene"], "id": turn_id},
            )
            parent = turn_id
        if parent is not None:
            bind.execute(
                text("UPDATE story_sessions SET active_turn_id = :turn_id WHERE id = :session_id"),
                {"turn_id": parent, "session_id": game["id"]},
            )

    player_sessions = bind.execute(
        text("SELECT story_id, id FROM story_sessions WHERE kind = 'player' "
             "ORDER BY story_id, updated_at DESC, id DESC")
    ).mappings()
    selected_stories: set[str] = set()
    for game in player_sessions:
        if game["story_id"] in selected_stories:
            continue
        bind.execute(
            text("INSERT INTO autosaves (story_id, session_id) VALUES (:story_id, :session_id)"),
            {"story_id": game["story_id"], "session_id": game["id"]},
        )
        selected_stories.add(game["story_id"])


def downgrade() -> None:
    op.drop_table("autosaves")
    op.drop_column("turns", "scene_after")
    op.drop_column("turns", "parent_turn_id")
    op.drop_column("story_sessions", "rewind_count")
    op.drop_column("story_sessions", "active_turn_id")
