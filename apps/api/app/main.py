from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .database import Database
from .providers import provider_health
from .schemas import StoryCreate, TurnCreate
from .store import ConflictError, Store


def create_app() -> FastAPI:
    settings = get_settings()
    database = Database(settings.database_path)
    store = Store(database)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        database.initialize()
        settings.asset_dir.mkdir(parents=True, exist_ok=True)
        yield

    app = FastAPI(title="AI Visual Novel API", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[value.strip() for value in settings.cors_origins.split(",")],
        allow_methods=["*"],
        allow_headers=["*"],
    )

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
            raise HTTPException(404, "Story not found")
        return story

    @app.get("/api/stories/{story_id}/jobs")
    def get_jobs(story_id: str):
        if not store.get_story(story_id):
            raise HTTPException(404, "Story not found")
        return store.list_jobs(story_id)

    @app.post("/api/stories/{story_id}/turns", status_code=201)
    def create_turn(story_id: str, payload: TurnCreate, response: Response):
        try:
            turn, created = store.create_turn(story_id, payload)
        except KeyError:
            raise HTTPException(404, "Story not found") from None
        except ConflictError as error:
            raise HTTPException(409, str(error)) from None
        if not created:
            response.status_code = 200
        return turn

    return app


app = create_app()
