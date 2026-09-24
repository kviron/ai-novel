"""Add catalog metadata and distinguish player saves from author tests."""

from alembic import op
from sqlalchemy import Column, String, text


revision = "20260924_02"
down_revision = "20260918_01"
branch_labels = None
depends_on = None

AKANE_DESCRIPTION = (
    "Ночной город хранит воспоминания, которые лучше было бы забыть. "
    "Вместе с Аканэ Куроха вы отправитесь по следу странного сигнала, "
    "расспросите свидетелей и решите, каким воспоминаниям можно доверять. "
    "Каждый ответ меняет ваш разговор и путь через неоновый дождь."
)


def upgrade() -> None:
    op.add_column("stories", Column("description", String(), nullable=False, server_default=""))
    op.add_column("stories", Column("cover_image_url", String(), nullable=True))
    op.add_column("story_sessions", Column("kind", String(), nullable=False, server_default="player"))
    op.execute("UPDATE stories SET description = premise")
    op.get_bind().execute(
        text("UPDATE stories SET description = :description, cover_image_url = :cover WHERE slug = :slug"),
        {"description": AKANE_DESCRIPTION, "cover": "/covers/akane-neon-echo.webp", "slug": "akane-neon-echo"},
    )


def downgrade() -> None:
    op.drop_column("story_sessions", "kind")
    op.drop_column("stories", "cover_image_url")
    op.drop_column("stories", "description")
