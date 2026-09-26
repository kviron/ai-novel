"""Persist versioned story definitions while retaining legacy playthroughs."""

import json

from alembic import op
from sqlalchemy import Boolean, CheckConstraint, Column, ForeignKey, Integer, String, UniqueConstraint, text

revision = "20260927_13"
down_revision = "20260926_12"
branch_labels = None
depends_on = None


def _required_text(name: str, default: str | None = None) -> Column:
    return Column(name, String(), nullable=False, server_default=default)


def _canonical_string_list(value: str) -> str:
    items = json.loads(value)
    if not isinstance(items, list) or any(not isinstance(item, str) for item in items):
        raise ValueError("legacy story theme_labels must be a JSON string list")
    return json.dumps(items, ensure_ascii=False, separators=(",", ":"))


def upgrade() -> None:
    op.create_table(
        "story_materials",
        Column("id", String(), primary_key=True),
        Column("story_id", String(), ForeignKey("stories.id"), nullable=False),
        _required_text("sha256"),
        _required_text("mime_type"),
        _required_text("filename"),
        _required_text("creator"),
        _required_text("license"),
        _required_text("source"),
        _required_text("asset_path"),
        _required_text("created_at"),
    )
    op.create_index("ix_story_materials_story_id", "story_materials", ["story_id"])

    op.create_table(
        "story_versions",
        Column("id", String(), primary_key=True),
        Column("story_id", String(), ForeignKey("stories.id"), nullable=False),
        Column("version_number", Integer(), nullable=False),
        _required_text("status", "draft"),
        Column("draft_revision", Integer(), nullable=False, server_default="1"),
        Column("based_on_version_id", String(), ForeignKey("story_versions.id"), nullable=True),
        _required_text("mode"),
        _required_text("title"),
        _required_text("slug"),
        _required_text("short_description", ""),
        _required_text("premise", ""),
        Column("cover_material_id", String(), ForeignKey("story_materials.id"), nullable=True),
        _required_text("genres", "[]"),
        _required_text("tone", "[]"),
        _required_text("setting", ""),
        _required_text("opening_situation", ""),
        _required_text("content_rating", "adult_18_plus"),
        _required_text("themes_allowed", "[]"),
        _required_text("themes_blocked", "[]"),
        _required_text("creative_goals", ""),
        _required_text("ending_policy", "open_ended"),
        _required_text("hero_policy", "choice"),
        _required_text("hero_allowed_sources", '["catalog", "draft"]'),
        Column("fixed_hero_revision_id", String(), ForeignKey("character_revisions.id"), nullable=True),
        _required_text("recommended_provider_id", "ollama"),
        _required_text("recommended_model_id", "qwen3:14b-q4_K_M"),
        _required_text("narration_perspective", "second_person"),
        _required_text("prose_density", "balanced"),
        _required_text("choice_policy", "choices_and_free_input"),
        Column("min_choices", Integer(), nullable=False, server_default="2"),
        Column("max_choices", Integer(), nullable=False, server_default="4"),
        Column("allow_romance", Boolean(), nullable=False, server_default="1"),
        Column("allow_violence", Boolean(), nullable=False, server_default="1"),
        Column("allow_horror", Boolean(), nullable=False, server_default="1"),
        Column("allow_sexual_themes", Boolean(), nullable=False, server_default="0"),
        _required_text("desired_themes", ""),
        _required_text("forbidden_outcomes", ""),
        Column("rules_version", Integer(), nullable=False, server_default="1"),
        _required_text("created_at"),
        Column("published_at", String(), nullable=True),
        UniqueConstraint("story_id", "version_number", name="uq_story_versions_number"),
        CheckConstraint("mode IN ('freeform', 'hybrid')", name="ck_story_versions_mode"),
    )
    op.create_index("ix_story_versions_story_id", "story_versions", ["story_id"])
    op.create_index(
        "uq_story_versions_one_draft", "story_versions", ["story_id"], unique=True,
        sqlite_where=text("status = 'draft'"),
    )

    op.create_table(
        "story_version_characters",
        Column("id", String(), primary_key=True),
        Column("version_id", String(), ForeignKey("story_versions.id"), nullable=False),
        Column("character_id", String(), ForeignKey("characters.id"), nullable=False),
        Column("revision_id", String(), ForeignKey("character_revisions.id"), nullable=False),
        Column("order_index", Integer(), nullable=False),
        _required_text("role", "cast"),
        _required_text("color", "#D9A75F"),
        Column("playable", Boolean(), nullable=False, server_default="0"),
        UniqueConstraint("version_id", "character_id", name="uq_story_version_character"),
        UniqueConstraint("version_id", "order_index", name="uq_story_version_character_order"),
    )
    op.create_index("ix_story_version_characters_version_id", "story_version_characters", ["version_id"])
    op.create_table(
        "canon_facts",
        Column("id", String(), primary_key=True),
        Column("version_id", String(), ForeignKey("story_versions.id"), nullable=False),
        Column("order_index", Integer(), nullable=False),
        _required_text("title"),
        _required_text("statement"),
        _required_text("severity", "hard"),
        _required_text("scope", "world"),
        _required_text("referenced_character_ids", "[]"),
        UniqueConstraint("version_id", "order_index", name="uq_canon_fact_order"),
    )
    op.create_index("ix_canon_facts_version_id", "canon_facts", ["version_id"])
    op.create_table(
        "story_beats",
        Column("id", String(), primary_key=True),
        Column("version_id", String(), ForeignKey("story_versions.id"), nullable=False),
        Column("order_index", Integer(), nullable=False),
        _required_text("title"),
        _required_text("description"),
        _required_text("activation_condition", '{"type":"always"}'),
        _required_text("completion_evidence", ""),
        Column("required", Boolean(), nullable=False, server_default="1"),
        Column("ending_gate", Boolean(), nullable=False, server_default="0"),
        UniqueConstraint("version_id", "order_index", name="uq_story_beat_order"),
    )
    op.create_index("ix_story_beats_version_id", "story_beats", ["version_id"])
    op.create_table(
        "story_draft_snapshots",
        Column("id", String(), primary_key=True),
        Column("version_id", String(), ForeignKey("story_versions.id"), nullable=False),
        _required_text("payload"),
        _required_text("sha256"),
        Column("source_draft_revision", Integer(), nullable=False),
        _required_text("created_at"),
    )
    op.create_index("ix_story_draft_snapshots_version_id", "story_draft_snapshots", ["version_id"])

    bind = op.get_bind()
    stories = list(bind.execute(text(
        "SELECT id, slug, title, description, premise, theme_labels, story_mode, current_scene, "
        "hero_policy, hero_allowed_sources, fixed_hero_revision_id, playable_character_ids, "
        "recommended_provider_id, recommended_model_id, created_at FROM stories ORDER BY id"
    )).mappings())
    for story in stories:
        version_id = f"{story['id']}:v1"
        bind.execute(text(
            "INSERT INTO story_versions (id, story_id, version_number, status, draft_revision, mode, "
            "title, slug, short_description, premise, tone, opening_situation, hero_policy, "
            "hero_allowed_sources, fixed_hero_revision_id, recommended_provider_id, recommended_model_id, "
            "created_at, published_at) VALUES (:id, :story_id, 1, 'published', 1, :mode, :title, :slug, "
            ":short_description, :premise, :tone, :opening_situation, :hero_policy, "
            ":hero_allowed_sources, :fixed_hero_revision_id, :recommended_provider_id, :recommended_model_id, "
            ":created_at, :published_at)"
        ), {
            "id": version_id,
            "story_id": story["id"],
            "mode": "freeform" if story["story_mode"] == "free" else story["story_mode"],
            "title": story["title"],
            "slug": story["slug"],
            "short_description": story["description"],
            "premise": story["premise"],
            "tone": _canonical_string_list(story["theme_labels"]),
            "opening_situation": story["current_scene"],
            "hero_policy": story["hero_policy"],
            "hero_allowed_sources": _canonical_string_list(story["hero_allowed_sources"]),
            "fixed_hero_revision_id": story["fixed_hero_revision_id"],
            "recommended_provider_id": story["recommended_provider_id"],
            "recommended_model_id": story["recommended_model_id"],
            "created_at": story["created_at"],
            "published_at": story["created_at"],
        })
        playable_ids = set(json.loads(story["playable_character_ids"]))
        cast = bind.execute(text(
            "SELECT character_id, revision_id, role, color FROM story_characters "
            "WHERE story_id=:story_id ORDER BY character_id"
        ), {"story_id": story["id"]}).mappings()
        for order_index, character in enumerate(cast):
            bind.execute(text(
                "INSERT INTO story_version_characters "
                "(id, version_id, character_id, revision_id, order_index, role, color, playable) "
                "VALUES (:id, :version_id, :character_id, :revision_id, :order_index, :role, :color, :playable)"
            ), {
                "id": f"{version_id}:character:{character['character_id']}",
                "version_id": version_id,
                "character_id": character["character_id"],
                "revision_id": character["revision_id"],
                "order_index": order_index,
                "role": character["role"],
                "color": character["color"],
                "playable": character["character_id"] in playable_ids,
            })

    with op.batch_alter_table("stories") as batch:
        batch.add_column(Column(
            "current_published_version_id", String(),
            ForeignKey("story_versions.id", name="fk_stories_current_published_version"), nullable=True,
        ))
    bind.execute(text("UPDATE stories SET current_published_version_id = id || :suffix"), {"suffix": ":v1"})

    with op.batch_alter_table("story_sessions") as batch:
        batch.add_column(Column(
            "story_version_id", String(),
            ForeignKey("story_versions.id", name="fk_story_sessions_story_version"), nullable=True,
        ))
        batch.add_column(Column(
            "draft_snapshot_id", String(),
            ForeignKey("story_draft_snapshots.id", name="fk_story_sessions_draft_snapshot"), nullable=True,
        ))
    bind.execute(text("UPDATE story_sessions SET story_version_id = story_id || :suffix"), {"suffix": ":v1"})
    with op.batch_alter_table("story_sessions") as batch:
        batch.create_check_constraint(
            "ck_story_session_one_version_source",
            "(story_version_id IS NOT NULL AND draft_snapshot_id IS NULL) OR "
            "(story_version_id IS NULL AND draft_snapshot_id IS NOT NULL)",
        )

    op.create_table(
        "session_beats",
        Column("session_id", String(), ForeignKey("story_sessions.id"), primary_key=True),
        Column("beat_id", String(), ForeignKey("story_beats.id"), primary_key=True),
        _required_text("status", "locked"),
        Column("completed_turn_id", String(), ForeignKey("turns.id"), nullable=True),
    )


def downgrade() -> None:
    raise NotImplementedError("Story-version migration preserves user data and is intentionally irreversible.")
