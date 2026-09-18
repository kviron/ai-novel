from collections.abc import Generator

from fastapi import Request
from sqlalchemy import event
from sqlmodel import Session, create_engine

from app.core.config import Settings


def create_engine_from_settings(settings: Settings):
    """Create the SQLite engine used by the application and enforce foreign keys."""
    settings.database_path.parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(
        f"sqlite:///{settings.database_path.as_posix()}",
        connect_args={"check_same_thread": False},
    )

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(dbapi_connection, _connection_record) -> None:
        dbapi_connection.execute("PRAGMA foreign_keys=ON")

    return engine


def get_session(request: Request) -> Generator[Session, None, None]:
    """Yield one request-scoped SQLModel session and always close it afterwards."""
    with Session(request.app.state.engine) as session:
        yield session
