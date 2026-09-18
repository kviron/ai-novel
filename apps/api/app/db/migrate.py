from pathlib import Path

from alembic import command
from alembic.config import Config


def run_migrations(database_path: Path) -> None:
    """Idempotently upgrade a SQLite database file to the current Alembic head."""
    app_root = Path(__file__).resolve().parents[2]
    resolved_path = database_path if database_path.is_absolute() else app_root / database_path
    resolved_path = resolved_path.resolve()
    resolved_path.parent.mkdir(parents=True, exist_ok=True)
    config = Config(str(app_root / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{resolved_path.as_posix()}")
    command.upgrade(config, "head")
