"""Create the playable-story persistence schema and migrate v0.1 SQLite data."""

from uuid import NAMESPACE_URL, uuid5

from alembic import op
from sqlalchemy import Column, ForeignKey, Integer, String, UniqueConstraint, inspect, text


revision = "20260918_01"
down_revision = None
branch_labels = None
depends_on = None

LEGACY_VISUAL_DIRECTIVE = '{"mode":"sprite_scene","emotion":"neutral","pose":"default","outfit":"red_dress"}'
LEGACY_PROVIDER_ID = "legacy"
LEGACY_MODEL_ID = "legacy"
LEGACY_PROMPT_VERSION = "legacy-v01"
LEGACY_TIMESTAMP = "1970-01-01T00:00:00+00:00"


def _create_story_sessions() -> None:
    op.create_table(
        "story_sessions",
        Column("id", String(), primary_key=True),
        Column("story_id", String(), ForeignKey("stories.id"), nullable=False, index=True),
        Column("state_version", Integer(), nullable=False, server_default="1"),
        Column("current_scene", String(), nullable=False),
        Column("provider_id", String(), nullable=False),
        Column("model_id", String(), nullable=False),
        Column("created_at", String(), nullable=False),
        Column("updated_at", String(), nullable=False),
    )


def _create_turns() -> None:
    op.create_table(
        "turns",
        Column("id", String(), primary_key=True),
        Column("session_id", String(), ForeignKey("story_sessions.id"), nullable=False, index=True),
        Column("request_id", String(), nullable=False),
        Column("state_version", Integer(), nullable=False),
        Column("action", String(), nullable=False),
        Column("narration", String(), nullable=False),
        Column("dialogue", String(), nullable=False),
        Column("choices", String(), nullable=False),
        Column("visual_directive", String(), nullable=False),
        Column("raw_response", String(), nullable=False),
        Column("provider_id", String(), nullable=False),
        Column("model_id", String(), nullable=False),
        Column("prompt_version", String(), nullable=False),
        Column("created_at", String(), nullable=False),
        UniqueConstraint("session_id", "request_id"),
    )


def _create_empty_schema() -> None:
    op.create_table(
        "stories",
        Column("id", String(), primary_key=True),
        Column("slug", String(), nullable=False, unique=True, index=True),
        Column("title", String(), nullable=False),
        Column("premise", String(), nullable=False),
        Column("story_mode", String(), nullable=False, server_default="hybrid"),
        Column("content_version", Integer(), nullable=False, server_default="1"),
        Column("current_scene", String(), nullable=False),
        Column("recommended_provider_id", String(), nullable=False, server_default="ollama"),
        Column("recommended_model_id", String(), nullable=False, server_default="qwen3:14b-q4_K_M"),
        Column("created_at", String(), nullable=False),
    )
    op.create_table(
        "characters",
        Column("id", String(), primary_key=True),
        Column("story_id", String(), ForeignKey("stories.id"), nullable=False, index=True),
        Column("name", String(), nullable=False),
        Column("age", Integer(), nullable=False),
        Column("personality", String(), nullable=False),
        Column("appearance", String(), nullable=False),
        Column("visual_profile_version", Integer(), nullable=False, server_default="1"),
    )
    _create_story_sessions()
    _create_turns()


def _migrate_legacy_schema(bind) -> None:
    with op.batch_alter_table("stories") as batch:
        batch.add_column(Column("slug", String(), nullable=True))
        batch.add_column(Column("story_mode", String(), nullable=False, server_default="hybrid"))
        batch.add_column(Column("content_version", Integer(), nullable=False, server_default="1"))
        batch.add_column(Column("recommended_provider_id", String(), nullable=False, server_default="ollama"))
        batch.add_column(Column("recommended_model_id", String(), nullable=False, server_default="qwen3:14b-q4_K_M"))
    bind.execute(text("UPDATE stories SET slug = id WHERE slug IS NULL"))
    with op.batch_alter_table("stories") as batch:
        batch.alter_column("slug", existing_type=String(), nullable=False)
        batch.create_unique_constraint("uq_stories_slug", ["slug"])

    _create_story_sessions()
    op.rename_table("turns", "turns_legacy")
    _create_turns()

    stories = bind.execute(text("SELECT id, state_version, current_scene, created_at FROM stories")).mappings()
    for story in stories:
        session_id = str(uuid5(NAMESPACE_URL, f"legacy-story-session:{story['id']}"))
        has_turn = bind.execute(
            text("SELECT 1 FROM turns_legacy WHERE story_id = :story_id LIMIT 1"), {"story_id": story["id"]}
        ).scalar()
        if not has_turn:
            continue
        bind.execute(
            text(
                """
                INSERT INTO story_sessions (
                    id, story_id, state_version, current_scene, provider_id, model_id, created_at, updated_at
                ) VALUES (
                    :id, :story_id, :state_version, :current_scene, :provider_id, :model_id, :created_at, :updated_at
                )
                """
            ),
            {
                "id": session_id,
                "story_id": story["id"],
                "state_version": story["state_version"],
                "current_scene": story["current_scene"],
                "provider_id": LEGACY_PROVIDER_ID,
                "model_id": LEGACY_MODEL_ID,
                "created_at": story["created_at"] or LEGACY_TIMESTAMP,
                "updated_at": story["created_at"] or LEGACY_TIMESTAMP,
            },
        )
        turns = bind.execute(
            text("SELECT id, request_id, state_version, action, narration, dialogue, choices, created_at FROM turns_legacy WHERE story_id = :story_id"),
            {"story_id": story["id"]},
        ).mappings()
        for turn in turns:
            bind.execute(
                text(
                    """
                    INSERT INTO turns (
                        id, session_id, request_id, state_version, action, narration, dialogue, choices,
                        visual_directive, raw_response, provider_id, model_id, prompt_version, created_at
                    ) VALUES (
                        :id, :session_id, :request_id, :state_version, :action, :narration, :dialogue, :choices,
                        :visual_directive, :raw_response, :provider_id, :model_id, :prompt_version, :created_at
                    )
                    """
                ),
                {
                    **turn,
                    "session_id": session_id,
                    "visual_directive": LEGACY_VISUAL_DIRECTIVE,
                    "raw_response": "",
                    "provider_id": LEGACY_PROVIDER_ID,
                    "model_id": LEGACY_MODEL_ID,
                    "prompt_version": LEGACY_PROMPT_VERSION,
                    "created_at": turn["created_at"] or LEGACY_TIMESTAMP,
                },
            )
    op.drop_table("turns_legacy")


def upgrade() -> None:
    bind = op.get_bind()
    table_names = set(inspect(bind).get_table_names())
    if "stories" not in table_names:
        _create_empty_schema()
    else:
        _migrate_legacy_schema(bind)


def downgrade() -> None:
    raise NotImplementedError("The playable-story migration preserves user data and is intentionally irreversible.")
