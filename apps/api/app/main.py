from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlmodel import Session

from .config import get_settings
from .core.config import Settings as PersistenceSettings
from .database import Database
from .db.engine import create_engine_from_settings
from .db.migrate import run_migrations
from .modules.stories.router import router as stories_router
from .modules.stories.seed import seed_akane_story
from .providers import provider_health
from .schemas import StoryCreate, TurnCreate
from .store import ConflictError, Store


def create_app() -> FastAPI:
    settings = get_settings()
    persistence_settings = PersistenceSettings(database_path=settings.database_path)
    database = Database(persistence_settings.database_path)
    store = Store(database)

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        run_migrations(persistence_settings.database_path)
        application.state.engine = create_engine_from_settings(persistence_settings)
        with Session(application.state.engine) as session:
            seed_akane_story(session)
            session.commit()
        database.initialize()
        settings.asset_dir.mkdir(parents=True, exist_ok=True)
        yield

    app = FastAPI(title="API нейровизуальной новеллы", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[value.strip() for value in settings.cors_origins.split(",")],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(stories_router)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_, error: RequestValidationError):
        has_age_error = any(item.get("loc", ())[-1:] == ("age",) for item in error.errors())
        detail = (
            "Возраст каждого персонажа должен быть не меньше 18 лет"
            if has_age_error
            else "Проверьте правильность заполнения обязательных полей"
        )
        return JSONResponse(status_code=422, content={"detail": detail})

    @app.get("/health")
    def health():
        with database.connect() as connection:
            connection.execute("SELECT 1")
        return {"status": "ok", "mode": settings.app_mode}

    @app.get("/health/providers")
    def providers():
        return {
            "ollama": provider_health("Ollama", f"{settings.ollama_base_url}/api/tags", settings.provider_timeout_seconds),
            "comfyui": provider_health("ComfyUI", f"{settings.comfyui_base_url}/system_stats", settings.provider_timeout_seconds),
        }

    @app.post("/api/stories", status_code=201)
    def create_story(payload: StoryCreate):
        return store.create_story(payload)

    @app.get("/api/stories/{story_id}")
    def get_story(story_id: str):
        story = store.get_story(story_id)
        if not story:
            raise HTTPException(404, "История не найдена")
        return story

    @app.get("/api/stories/{story_id}/jobs")
    def get_jobs(story_id: str):
        if not store.get_story(story_id):
            raise HTTPException(404, "История не найдена")
        return store.list_jobs(story_id)

    @app.post("/api/stories/{story_id}/turns", status_code=201)
    def create_turn(story_id: str, payload: TurnCreate, response: Response):
        try:
            turn, created = store.create_turn(story_id, payload)
        except KeyError:
            raise HTTPException(404, "История не найдена") from None
        except ConflictError as error:
            raise HTTPException(409, str(error)) from None
        if not created:
            response.status_code = 200
        return turn

    return app


app = create_app()
