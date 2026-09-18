# Первый игровой цикл с Ollama — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Превратить демонстрационный каркас в сохраняемую гибридную новеллу с Аканэ, где FastAPI получает структурированный ход от Ollama, проверяет его и только затем атомарно записывает в SQLite, а React показывает текст и подтверждённый спрайт.

**Architecture:** Backend становится модульным монолитом FastAPI с SQLModel/Alembic, отдельным контрактом `LLMProvider`, сервисом игрового хода и репозиториями. Frontend переносится на минимальный FSD (`app`, `pages`, `shared`), восстанавливает активное прохождение и блокирует действия при недоступности Ollama. Первый этап использует одну встроенную гибридную историю и существующие спрайты Аканэ; каталог, rollback, CG, LoRA, ComfyUI worker и переключение моделей остаются последующими этапами.

**Tech Stack:** Python 3.11+, FastAPI, Pydantic v2, SQLModel, Alembic, HTTPX, SQLite, pytest, React, TypeScript, Vite, React Router, shadcn/ui, Vitest, Testing Library, Playwright, Steiger.

**Spec:** `docs/superpowers/specs/2026-09-18-ai-visual-novel-platform-design.md`

## Global Constraints

- Интерфейс и пользовательские ошибки полностью на русском языке.
- SQLite и `story_engine` — источник истины; LLM не пишет в базу напрямую.
- Один принятый ход записывается одной транзакцией и увеличивает `state_version` ровно на один.
- Повторный `(session_id, request_id)` возвращает прежний ход; устаревшая версия даёт HTTP 409.
- Если Ollama недоступна или дважды возвращает непроверяемый ответ, состояние прохождения не меняется.
- Первый LLM-профиль использует конфигурируемую модель; значение по умолчанию — `qwen3:14b-q4_K_M`, контекст — 16384 токена.
- Использовать HTTPX, JSON Schema из Pydantic и синхронные `def`-обработчики для блокирующего локального I/O.
- Существующий sprite sheet Аканэ переиспользуется без растягивания пропорций.
- Не реализовывать в этом плане каталог персонажей, rollback/ветвление, OpenAI, CG, LoRA, обучение или ComfyUI worker.
- Каждый task выполняется через red-green-refactor и заканчивается отдельным коммитом.

---

## Карта файлов

### Backend

```text
apps/api/
  alembic.ini
  migrations/
    env.py
    versions/20260918_01_playable_story.py
  app/
    main.py                         # сборка FastAPI
    core/
      config.py                     # Settings
      errors.py                     # доменные ошибки
      lifespan.py                   # миграции/seed на запуске
    db/
      engine.py                     # engine и Session dependency
      migrate.py                    # programmatic Alembic upgrade
      models.py                     # SQLModel tables
    modules/
      providers/
        contracts.py                # LLMProvider и transport DTO
        ollama.py                   # HTTPX adapter
        service.py                  # registry/status/model selection
        router.py
      stories/
        schemas.py
        repository.py
        service.py                  # seed/list/get/start session
        router.py
      story_engine/
        contracts.py                # TurnProposal и visual directive
        prompt.py                   # provider-neutral prompt/context
        rules.py                    # canonical validation
        service.py                  # generate/repair/commit turn
        repository.py
        router.py
  tests/
    fakes.py
    providers/test_ollama.py
    stories/test_stories.py
    story_engine/test_turns.py
    test_api.py
    fake_ollama.py
```

Старые `app/database.py`, `app/providers.py`, `app/schemas.py` и `app/store.py` удаляются только после переноса их поведения и прохождения тестов.

### Frontend

```text
apps/web/src/
  main.tsx
  app/
    App.tsx
    router.tsx
  pages/
    novel-library/
      api/list-stories.ts
      ui/NovelLibraryPage.tsx
      ui/NovelLibraryPage.test.tsx
      index.ts
    story-player/
      api/story-session.ts
      model/story-player.ts
      ui/StoryPlayerPage.tsx
      ui/StoryPlayerPage.test.tsx
      ui/TypewriterText.tsx
      assets/akane-sprite-sheet-v1.png
      index.ts
  shared/
    api/client.ts
    api/contracts.ts
    config/routes.ts
    ui/...                         # текущие shadcn-компоненты
  test/
    api-server.ts                  # управляемый fetch stub
    TestRouter.tsx                 # router harness для page tests
  styles.css
  e2e/story-flow.spec.ts
```

---

### Task 1: Модульный FastAPI, SQLModel и миграция существующей базы

**Files:**
- Modify: `apps/api/pyproject.toml`
- Create: `apps/api/alembic.ini`
- Create: `apps/api/migrations/env.py`
- Create: `apps/api/migrations/versions/20260918_01_playable_story.py`
- Create: `apps/api/app/core/config.py`
- Create: `apps/api/app/core/errors.py`
- Create: `apps/api/app/db/engine.py`
- Create: `apps/api/app/db/migrate.py`
- Create: `apps/api/app/db/models.py`
- Modify: `apps/api/tests/conftest.py`
- Create: `apps/api/tests/db/test_migrations.py`

**Interfaces:**
- Produces: `Settings`, `create_engine_from_settings(settings)`, `get_session(request)`, `run_migrations(database_path)`, SQLModel tables `Story`, `Character`, `StorySession`, `Turn`.
- Preserves: данные таблиц `stories`, `characters`, `turns`; новая миграция добавляет новые таблицы/колонки без удаления пользовательских строк.

- [ ] **Step 1: Добавить зависимости и команды проверки**

В `pyproject.toml` добавить runtime-зависимости `sqlmodel>=0.0.24,<0.1`, `alembic>=1.14,<2` и test-зависимости `pytest-cov>=6,<7`, `ruff>=0.11,<1`. Добавить:

```toml
[tool.ruff]
line-length = 120
target-version = "py311"

[tool.ruff.lint]
select = ["E", "F", "I", "UP", "B"]
```

Run: `uv sync --directory apps/api --extra test`

- [ ] **Step 2: Написать failing migration test**

```python
def test_upgrade_creates_playable_story_tables(tmp_path, monkeypatch):
    database_path = tmp_path / "migration.db"
    monkeypatch.setenv("DATABASE_PATH", str(database_path))
    run_migrations(database_path)

    with sqlite3.connect(database_path) as db:
        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        columns = {row[1] for row in db.execute("PRAGMA table_info(turns)")}

    assert {"stories", "characters", "story_sessions", "turns"} <= tables
    assert {"session_id", "raw_response", "visual_directive", "provider_id", "model_id"} <= columns

def test_upgrade_preserves_legacy_story_and_turn(tmp_path):
    database_path = tmp_path / "legacy.db"
    create_v01_database(database_path, story_id="legacy-story", turn_id="legacy-turn")
    run_migrations(database_path)

    with sqlite3.connect(database_path) as db:
        story = db.execute("SELECT id FROM stories WHERE id='legacy-story'").fetchone()
        turn = db.execute("SELECT id, session_id FROM turns WHERE id='legacy-turn'").fetchone()
        session = db.execute("SELECT story_id, state_version FROM story_sessions WHERE id=?", (turn[1],)).fetchone()

    assert story == ("legacy-story",)
    assert session == ("legacy-story", 2)
```

Run: `uv run --directory apps/api pytest tests/db/test_migrations.py -v`  
Expected: FAIL because `run_migrations` and the migration do not exist.

- [ ] **Step 3: Создать модели и engine**

Определить таблицы с UUID-строками и UTC ISO timestamps. Минимальные поля:

```python
class Story(SQLModel, table=True):
    __tablename__ = "stories"
    id: str = Field(primary_key=True)
    slug: str = Field(index=True, unique=True)
    title: str
    premise: str
    story_mode: str = "hybrid"
    content_version: int = 1
    current_scene: str
    recommended_provider_id: str = "ollama"
    recommended_model_id: str = "qwen3:14b-q4_K_M"
    created_at: str

class StorySession(SQLModel, table=True):
    __tablename__ = "story_sessions"
    id: str = Field(primary_key=True)
    story_id: str = Field(foreign_key="stories.id", index=True)
    state_version: int = 1
    current_scene: str
    provider_id: str
    model_id: str
    created_at: str
    updated_at: str

class Turn(SQLModel, table=True):
    __tablename__ = "turns"
    __table_args__ = (UniqueConstraint("session_id", "request_id"),)
    id: str = Field(primary_key=True)
    session_id: str = Field(foreign_key="story_sessions.id", index=True)
    request_id: str
    state_version: int
    action: str
    narration: str
    dialogue: str
    choices: str
    visual_directive: str
    raw_response: str
    provider_id: str
    model_id: str
    prompt_version: str
    created_at: str
```

`Character` сохраняет `story_id`, `name`, `age`, `personality`, `appearance` и `visual_profile_version`. Не добавлять каталог/revisions на этом этапе.

- [ ] **Step 4: Реализовать Alembic migration**

Миграция должна определить наличие старой схемы через `inspect(bind)`. Для новой базы создать целевую схему. Для старой базы:

1. добавить недостающие колонки `slug`, `story_mode`, `content_version`, `recommended_provider_id`, `recommended_model_id` в `stories` через `batch_alter_table`;
2. создать `story_sessions`;
3. переименовать старую `turns` в `turns_legacy`;
4. создать новую `turns`;
5. для каждой старой истории с ходами создать legacy-сессию и скопировать ходы, используя JSON `{"mode":"sprite_scene","emotion":"neutral","pose":"default","outfit":"red_dress"}`;
6. удалить `turns_legacy` только после успешного копирования внутри транзакции.

`run_migrations(database_path: Path)` создаёт Alembic `Config`, задаёт `sqlalchemy.url` и вызывает `command.upgrade(config, "head")`.

`get_session` использует engine из app state и закрывает SQLModel session после ответа:

```python
def get_session(request: Request):
    with Session(request.app.state.engine) as session:
        yield session
```

- [ ] **Step 5: Запустить migration test и lint**

Run: `uv run --directory apps/api pytest tests/db/test_migrations.py -v`  
Expected: PASS.

Run: `uv run --directory apps/api ruff check app tests`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/pyproject.toml apps/api/uv.lock apps/api/alembic.ini apps/api/migrations apps/api/app/core apps/api/app/db apps/api/tests/conftest.py apps/api/tests/db
git commit -m "refactor: add migrated SQLModel persistence"
```

### Task 2: Встроенная гибридная история Аканэ и сохраняемые сессии

**Files:**
- Create: `apps/api/app/modules/stories/schemas.py`
- Create: `apps/api/app/modules/stories/repository.py`
- Create: `apps/api/app/modules/stories/service.py`
- Create: `apps/api/app/modules/stories/router.py`
- Create: `apps/api/app/modules/stories/seed.py`
- Create: `apps/api/tests/stories/test_stories.py`
- Modify: `apps/api/app/main.py`

**Interfaces:**
- Produces: `list_stories(session) -> list[StorySummary]`, `get_story(session, story_id) -> StoryDetail`, `start_story_session(session, story_id, request) -> SessionDetail`.
- HTTP: `GET /api/stories`, `GET /api/stories/{story_id}`, `POST /api/stories/{story_id}/sessions`, `GET /api/sessions/{session_id}`.

- [ ] **Step 1: Написать failing story/session tests**

```python
def test_seeded_akane_story_can_start_and_restore(client):
    stories = client.get("/api/stories").json()
    akane = next(item for item in stories if item["slug"] == "akane-neon-echo")
    assert akane["recommended_model_id"] == "qwen3:14b-q4_K_M"

    created = client.post(
        f'/api/stories/{akane["id"]}/sessions',
        json={"provider_id": "ollama", "model_id": "qwen3:14b-q4_K_M"},
    )
    assert created.status_code == 201
    game = created.json()
    assert game["state_version"] == 1
    assert game["characters"][0]["name"] == "Аканэ Куроха"
    assert game["latest_turn"] is None

    restored = client.get(f'/api/sessions/{game["id"]}')
    assert restored.status_code == 200
    assert restored.json()["id"] == game["id"]
```

Run: `uv run --directory apps/api pytest tests/stories/test_stories.py -v`  
Expected: FAIL with 404 for the new routes.

- [ ] **Step 2: Определить response/request schemas**

```python
class StartSessionRequest(BaseModel):
    provider_id: str = Field(default="ollama", min_length=1, max_length=40)
    model_id: str | None = Field(default=None, max_length=160)

class StorySummary(BaseModel):
    id: str
    slug: str
    title: str
    premise: str
    story_mode: Literal["hybrid", "free"]
    recommended_provider_id: str
    recommended_model_id: str

class VisualState(BaseModel):
    emotion: str = "neutral"
    pose: str = "default"
    outfit: str = "red_dress"
```

`SessionDetail` содержит session id, story, characters, `state_version`, `current_scene`, provider/model, `latest_turn` и начальный `visual_state`.

- [ ] **Step 3: Реализовать идемпотентный seed**

`seed_akane_story(session)` ищет `slug="akane-neon-echo"`; если запись есть, ничего не меняет. Иначе создаёт историю «Эхо неона» и совершеннолетнюю Аканэ со стабильным `id="akane"` из `assets/characters/akane/character-profile.json`. Для первого этапа разрешённые эмоции сохраняются как JSON:

```python
["neutral", "happy", "sad", "angry", "surprised", "fan"]
```

Seed вызывается из lifespan после миграций. На этом task `main.py` подключает stories router, чтобы tests проходили независимо; Task 5 заменит временную сборку окончательной factory.

- [ ] **Step 4: Реализовать repository/service/router**

Repository выполняет только SQLModel queries. Service выбирает рекомендованную модель, создаёт `StorySession` и собирает DTO. Router объявляет `prefix="/api"`, `tags=["Истории"]`, response return types и `Annotated[Session, Depends(get_session)]`.

- [ ] **Step 5: Запустить tests**

Run: `uv run --directory apps/api pytest tests/stories/test_stories.py -v`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/modules/stories apps/api/tests/stories
git commit -m "feat: add seeded Akane story sessions"
```

### Task 3: Контракт LLMProvider и адаптер Ollama

**Files:**
- Create: `apps/api/app/modules/providers/contracts.py`
- Create: `apps/api/app/modules/providers/ollama.py`
- Create: `apps/api/app/modules/providers/service.py`
- Create: `apps/api/app/modules/providers/router.py`
- Create: `apps/api/app/modules/story_engine/contracts.py`
- Create: `apps/api/tests/fakes.py`
- Create: `apps/api/tests/providers/test_ollama.py`
- Modify: `apps/api/app/core/config.py`
- Modify: `apps/api/app/main.py`

**Interfaces:**
- Produces: `TurnProposal`, `LLMProvider.health()`, `LLMProvider.list_models()`, `LLMProvider.generate_turn(request)`.
- Consumes: `TurnGenerationRequest` and `TurnProposal.model_json_schema()` from the contract created in this task.

- [ ] **Step 1: Написать failing adapter tests**

```python
VALID_TURN_JSON = json.dumps({
    "narration": "Дождь стихает.",
    "dialogue": {"character_id": "akane", "text": "Я ждала этого вопроса."},
    "visual_directive": {"mode": "sprite_scene", "emotion": "fan", "pose": "fan_open", "outfit": "red_dress"},
    "suggested_choices": ["Продолжить разговор", "Осмотреть веер"],
    "proposed_effects": [],
}, ensure_ascii=False)

def turn_request() -> TurnGenerationRequest:
    return TurnGenerationRequest(
        model_id="qwen3:14b-q4_K_M",
        system_prompt="Веди историю.",
        user_prompt="Игрок спрашивает о веере.",
        response_schema=TurnProposal.model_json_schema(),
        context_tokens=16384,
    )

def test_ollama_sends_schema_and_parses_turn():
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert body["model"] == "qwen3:14b-q4_K_M"
        assert body["stream"] is False
        assert body["format"]["required"] == [
            "narration", "dialogue", "visual_directive", "suggested_choices", "proposed_effects"
        ]
        return httpx.Response(200, json={"message": {"content": VALID_TURN_JSON}})

    provider = OllamaProvider(
        base_url="http://ollama.test",
        timeout_seconds=5,
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    proposal = provider.generate_turn(turn_request())
    assert proposal.dialogue.character_id == "akane"

def test_ollama_unavailable_raises_typed_error():
    transport = httpx.MockTransport(lambda _: (_ for _ in ()).throw(httpx.ConnectError("offline")))
    provider = OllamaProvider("http://ollama.test", 1, httpx.Client(transport=transport))
    with pytest.raises(ProviderUnavailableError):
        provider.health()
```

Run: `uv run --directory apps/api pytest tests/providers/test_ollama.py -v`  
Expected: FAIL because provider classes do not exist.

- [ ] **Step 2: Определить строгий TurnProposal**

```python
class DialogueProposal(BaseModel):
    character_id: str
    text: str = Field(min_length=1, max_length=4000)

class VisualDirective(BaseModel):
    mode: Literal["sprite_scene"] = "sprite_scene"
    emotion: str
    pose: str = "default"
    outfit: str = "red_dress"

class ProposedEffect(BaseModel):
    key: str
    value: str | int | float | bool

class TurnProposal(BaseModel):
    narration: str = Field(min_length=1, max_length=6000)
    dialogue: DialogueProposal
    visual_directive: VisualDirective
    suggested_choices: list[str] = Field(min_length=2, max_length=4)
    proposed_effects: list[ProposedEffect] = Field(default_factory=list, max_length=20)
```

- [ ] **Step 3: Определить provider DTO и Protocol**

```python
class ProviderStatus(BaseModel):
    provider_id: str
    available: bool
    detail: str
    models: list[str] = Field(default_factory=list)

class TurnGenerationRequest(BaseModel):
    model_id: str
    system_prompt: str
    user_prompt: str
    response_schema: dict[str, Any]
    context_tokens: int = 16384

class LLMProvider(Protocol):
    provider_id: str
    def health(self) -> ProviderStatus: ...
    def list_models(self) -> list[str]: ...
    def generate_turn(self, request: TurnGenerationRequest) -> "TurnProposal": ...
```

Добавить `ProviderUnavailableError` и `ProviderResponseError` в `core/errors.py`.

- [ ] **Step 4: Реализовать Ollama HTTP calls**

- `GET /api/tags` для health/model list;
- `POST /api/chat` с `stream=false`, Pydantic JSON Schema в `format`, `options={"num_ctx": request.context_tokens}`;
- `TurnProposal.model_validate_json(response["message"]["content"])`;
- HTTP/connect/timeout -> `ProviderUnavailableError`;
- malformed body/schema -> `ProviderResponseError` с исходным текстом в поле исключения, но без записи в обычный лог.

- [ ] **Step 5: Реализовать registry, test fake и status route**

`ProviderRegistry.get("ollama")` возвращает адаптер. `GET /api/providers` возвращает список статусов. Недоступность одного провайдера не превращает весь endpoint в 500. Подключить router во временной `main.py`.

В `tests/fakes.py` определить `FakeLLMProvider` с очередями `responses`/`errors`, `call_count`, стабильным `provider_id="ollama"` и методами того же Protocol. Он будет общей fixture для Task 4.

- [ ] **Step 6: Запустить provider tests**

Run: `uv run --directory apps/api pytest tests/providers/test_ollama.py -v`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/app/modules/providers apps/api/app/modules/story_engine/contracts.py apps/api/app/core apps/api/app/main.py apps/api/tests/fakes.py apps/api/tests/providers
git commit -m "feat: add Ollama provider contract"
```

### Task 4: Story engine, repair и атомарный ход

**Files:**
- Create: `apps/api/app/modules/story_engine/prompt.py`
- Create: `apps/api/app/modules/story_engine/rules.py`
- Create: `apps/api/app/modules/story_engine/repository.py`
- Create: `apps/api/app/modules/story_engine/service.py`
- Create: `apps/api/app/modules/story_engine/router.py`
- Create: `apps/api/tests/story_engine/test_turns.py`
- Modify: `apps/api/app/main.py`

**Interfaces:**
- Consumes: `ProviderRegistry`, `StorySession`, `Turn`, story/character repository.
- Produces: `POST /api/sessions/{session_id}/turns`, `TurnResult`, canonical visual directive.

Перед tests добавить fixtures в `tests/conftest.py`:

```python
@pytest.fixture()
def fake_provider() -> FakeLLMProvider:
    return FakeLLMProvider()

@pytest.fixture()
def client(tmp_path, fake_provider):
    settings = Settings(database_path=tmp_path / "test.db", provider_timeout_seconds=1)
    registry = ProviderRegistry({"ollama": fake_provider})
    with TestClient(create_app(settings, registry)) as test_client:
        yield test_client

@pytest.fixture()
def akane_session(client) -> SimpleNamespace:
    story = next(item for item in client.get("/api/stories").json() if item["slug"] == "akane-neon-echo")
    body = client.post(f'/api/stories/{story["id"]}/sessions', json={"provider_id": "ollama"}).json()
    return SimpleNamespace(**body)
```

- [ ] **Step 1: Написать failing happy-path/idempotency test**

```python
def test_valid_proposal_is_committed_once(client, fake_provider, akane_session):
    fake_provider.responses = [valid_akane_proposal(emotion="fan")]
    payload = {"request_id": "turn-1", "expected_state_version": 1, "action": "Спросить о веере"}

    first = client.post(f"/api/sessions/{akane_session.id}/turns", json=payload)
    duplicate = client.post(f"/api/sessions/{akane_session.id}/turns", json=payload)

    assert first.status_code == 201
    assert duplicate.status_code == 200
    assert duplicate.json()["id"] == first.json()["id"]
    assert first.json()["state_version"] == 2
    assert first.json()["visual_directive"]["emotion"] == "fan"
    assert fake_provider.call_count == 1
```

- [ ] **Step 2: Написать failing rollback-on-error tests**

```python
@pytest.mark.parametrize("error", [ProviderUnavailableError("offline"), ProviderResponseError("broken", "{")])
def test_provider_failure_does_not_advance_session(client, fake_provider, akane_session, error):
    fake_provider.errors = [error, error]
    response = client.post(
        f"/api/sessions/{akane_session.id}/turns",
        json={"request_id": "bad", "expected_state_version": 1, "action": "Продолжить"},
    )
    assert response.status_code == 503
    restored = client.get(f"/api/sessions/{akane_session.id}").json()
    assert restored["state_version"] == 1
    assert restored["latest_turn"] is None
```

Добавить отдельные tests: stale version -> 409; unknown character -> repair then reject; unavailable emotion -> canonical fallback to `neutral`; more than four choices -> reject.

Run: `uv run --directory apps/api pytest tests/story_engine/test_turns.py -v`  
Expected: FAIL because story engine does not exist.

- [ ] **Step 3: Добавить transport schemas и реализовать prompt builder**

`TurnCreate` содержит `request_id`, `expected_state_version` и `action`. `TurnResult` повторяет принятый контракт и добавляет id/version/provider/model/timestamps.

System prompt на русском явно задаёт:

- роль ведущего гибридной новеллы;
- неизменяемые факты истории и описание Аканэ;
- запрет придумывать неизвестные IDs;
- допустимые эмоции;
- необходимость продолжить действие игрока, а не повторить его;
- 2–4 содержательных выбора;
- JSON Schema передаётся также через поле `format` Ollama.

User prompt содержит текущее состояние, до 8 последних полных ходов и действие игрока. В первом этапе summary не реализуется.

- [ ] **Step 4: Реализовать rules и repair**

`validate_proposal(proposal, context) -> AcceptedTurn` проверяет character ID, непустые уникальные choices и допустимые effects. Неизвестную эмоцию заменяет по fallback на `neutral`, не запрашивая repair.

Если JSON/schema или доменные IDs повреждены, service делает ровно один второй вызов с repair prompt, включающим validation errors и исходный ответ. Второй сбой поднимает `TurnGenerationFailedError`.

- [ ] **Step 5: Реализовать атомарный commit**

Порядок внутри одной SQLModel session/transaction:

1. проверить существующий `(session_id, request_id)`;
2. перечитать `StorySession` и сравнить version;
3. вызвать provider **до начала write transaction**;
4. начать короткую write transaction;
5. повторно проверить version;
6. вставить `Turn` с raw/accepted JSON;
7. обновить session version/current scene;
8. commit.

Если второй version check не прошёл, вернуть 409 и не сохранять ответ модели.

- [ ] **Step 6: Реализовать HTTP mapping**

- provider unavailable -> 503, code `provider_unavailable`;
- invalid twice -> 502, code `invalid_model_response`;
- stale version -> 409, code `state_conflict`;
- missing session -> 404;
- success -> 201, duplicate -> 200.

Форма ошибки:

```json
{"code":"provider_unavailable","detail":"Ollama недоступна","retryable":true}
```

Подключить story engine router во временной `main.py`; окончательная factory появится в Task 5.

- [ ] **Step 7: Запустить story engine tests**

Run: `uv run --directory apps/api pytest tests/story_engine/test_turns.py -v`  
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/app/modules/story_engine apps/api/tests/story_engine
git commit -m "feat: generate and validate canonical story turns"
```

### Task 5: Собрать приложение и удалить демонстрационный Store

**Files:**
- Modify: `apps/api/app/main.py`
- Create: `apps/api/app/core/lifespan.py`
- Modify: `apps/api/tests/test_api.py`
- Delete: `apps/api/app/database.py`
- Delete: `apps/api/app/providers.py`
- Delete: `apps/api/app/schemas.py`
- Delete: `apps/api/app/store.py`
- Modify: `README.md`
- Modify: `.env.example`

**Interfaces:**
- Consumes: routers/tasks 1–4.
- Produces: deployable `create_app(settings_override=None, provider_registry_override=None)` for tests and `app` for Uvicorn.

- [ ] **Step 1: Переписать API smoke tests**

Проверить `/health`, `/api/providers`, `/api/stories`, session restore, русскую 404 и OpenAPI operation IDs. Удалить assertions демонстрационного fallback и очереди пяти фиксированных эмоций.

Run: `uv run --directory apps/api pytest tests/test_api.py -v`  
Expected: FAIL до новой сборки `main.py`.

- [ ] **Step 2: Собрать FastAPI factory**

```python
def create_app(
    settings_override: Settings | None = None,
    provider_registry_override: ProviderRegistry | None = None,
) -> FastAPI:
    settings = settings_override or get_settings()
    app = FastAPI(
        title="API нейровизуальной новеллы",
        version="0.2.0",
        lifespan=create_lifespan(settings),
    )
    app.state.settings = settings
    app.state.providers = provider_registry_override or create_provider_registry(settings)
    app.include_router(providers_router)
    app.include_router(stories_router)
    app.include_router(story_engine_router)
    return app
```

Добавить единый handler доменных ошибок и существующий русский handler request validation. CORS оставить конфигурируемым.

- [ ] **Step 3: Обновить env/docs**

```dotenv
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3:14b-q4_K_M
OLLAMA_CONTEXT_TOKENS=16384
PROVIDER_TIMEOUT_SECONDS=120
```

README должен объяснять `ollama pull qwen3:14b-q4_K_M`, запуск API/web и поведение при недоступности модели. ComfyUI пометить как последующий этап, не как обязательный активный провайдер.

- [ ] **Step 4: Удалить старые modules после проверки imports**

Run: `rg "app\.(database|providers|schemas|store)|from \.?(database|providers|schemas|store)" apps/api`  
Expected: no production imports.

Удалить четыре старых файла.

- [ ] **Step 5: Полная backend verification**

Run: `uv run --directory apps/api ruff check app tests`  
Expected: PASS.

Run: `uv run --directory apps/api pytest --cov=app --cov-report=term-missing -q`  
Expected: all tests pass; no new story-engine module below 80% line coverage.

- [ ] **Step 6: Commit**

```bash
git add apps/api README.md .env.example
git commit -m "refactor: assemble modular playable API"
```

### Task 6: Перенести frontend на минимальный FSD

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/package-lock.json`
- Modify: `apps/web/src/main.tsx`
- Create: `apps/web/src/app/App.tsx`
- Create: `apps/web/src/app/router.tsx`
- Create: `apps/web/src/shared/api/contracts.ts`
- Create: `apps/web/src/shared/api/client.ts`
- Create: `apps/web/src/shared/config/routes.ts`
- Create: `apps/web/src/test/api-server.ts`
- Create: `apps/web/src/test/TestRouter.tsx`
- Move: `apps/web/src/components/ui/*` -> `apps/web/src/shared/ui/*`
- Create: `apps/web/src/pages/novel-library/ui/NovelLibraryPage.tsx`
- Create: `apps/web/src/pages/novel-library/ui/NovelLibraryPage.test.tsx`
- Create: `apps/web/src/pages/novel-library/index.ts`
- Delete after migration: `apps/web/src/App.tsx`, `apps/web/src/api.ts`, `apps/web/src/App.test.tsx`

**Interfaces:**
- Produces routes `/` and `/play/:sessionId`; `api.listStories()`, `api.startSession()`, `api.getSession()`, `api.providers()`, `api.createTurn()`.
- Does not create `entities`, `features` or `widgets`.

- [ ] **Step 1: Добавить router и Steiger**

Добавить runtime `react-router-dom`, dev `@feature-sliced/steiger`; scripts:

```json
"lint:fsd": "steiger src",
"typecheck": "tsc -b --pretty false"
```

Run: `npm --prefix apps/web install`

- [ ] **Step 2: Написать failing library page test**

```tsx
test('показывает встроенную историю и запускает прохождение', async () => {
  server.listStories([{ id: 'story-1', slug: 'akane-neon-echo', title: 'Эхо неона', premise: '...' }])
  server.startSession({ id: 'session-1', state_version: 1 })
  render(<TestRouter initialEntries={['/']} />)

  expect(await screen.findByRole('heading', { name: 'Эхо неона' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Начать историю' }))
  expect(await screen.findByTestId('story-player-route')).toHaveAttribute('data-session-id', 'session-1')
})
```

`src/test/api-server.ts` экспортирует управляемый `apiServer` с методами `listStories`, `startSession`, `session`, `providerSequence`, `providersAvailable`, `turn` и `reset`; внутри это один `vi.stubGlobal('fetch', vi.fn(handler))`. Каждый test вызывает `apiServer.reset()` в `afterEach`. `TestRouter.tsx` создаёт `createMemoryRouter` с теми же route objects, что production router, и принимает `initialEntries`.

Run: `npm --prefix apps/web test -- NovelLibraryPage.test.tsx`  
Expected: FAIL because page/router do not exist.

- [ ] **Step 3: Создать transport contracts/client**

В `shared/api/contracts.ts` определить `StorySummary`, `Character`, `VisualDirective`, `TurnResult`, `StorySession`, `ProviderStatus`, `ApiError`. `request<T>` парсит typed API error и бросает:

```ts
export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryable: boolean,
  ) { super(message) }
}
```

- [ ] **Step 4: Перенести shadcn в shared/ui**

Переместить компоненты без изменения поведения. Обновить `components.json` aliases на `@/shared/ui` и все imports. Не создавать общий `shared/index.ts`; каждый компонент сохраняет текущий path вида `@/shared/ui/button`.

- [ ] **Step 5: Реализовать app/router/library**

`App` содержит `RouterProvider` и `Toaster`. Library page загружает `/api/stories`, показывает русские loading/error/empty states и начинает сессию с рекомендованными provider/model. После ответа выполняет `navigate(routes.storyPlayer(session.id))`.

- [ ] **Step 6: Запустить frontend tests/FSD/typecheck**

Run: `npm --prefix apps/web test -- NovelLibraryPage.test.tsx`  
Expected: PASS.

Run: `npm --prefix apps/web run lint:fsd`  
Expected: PASS.

Run: `npm --prefix apps/web run typecheck`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "refactor: migrate web shell to FSD"
```

### Task 7: Игровая страница, блокировка Ollama, typewriter и подтверждённый спрайт

**Files:**
- Create: `apps/web/src/pages/story-player/api/story-session.ts`
- Create: `apps/web/src/pages/story-player/model/story-player.ts`
- Create: `apps/web/src/pages/story-player/ui/TypewriterText.tsx`
- Create: `apps/web/src/pages/story-player/ui/StoryPlayerPage.tsx`
- Create: `apps/web/src/pages/story-player/ui/StoryPlayerPage.test.tsx`
- Create: `apps/web/src/pages/story-player/index.ts`
- Move: `apps/web/public/characters/akane/akane-sprite-sheet-v1.png` -> `apps/web/src/pages/story-player/assets/akane-sprite-sheet-v1.png`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: `StorySession`, `TurnResult`, `ApiRequestError`, `/api/providers`.
- Produces: working `/play/:sessionId` page; emotion is derived only from `turn.visual_directive.emotion`.

- [ ] **Step 1: Написать failing unavailable-provider test**

```tsx
test('блокирует действия, когда Ollama недоступна, и позволяет повторить проверку', async () => {
  server.session(sessionWithoutTurn)
  server.providerSequence([
    { provider_id: 'ollama', available: false, detail: 'Ollama недоступна', models: [] },
    { provider_id: 'ollama', available: true, detail: 'Подключено', models: ['qwen3:14b-q4_K_M'] },
  ])
  renderPlayer('/play/session-1')

  expect(await screen.findByText('Нейросеть недоступна')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Отправить' })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: 'Повторить проверку' }))
  expect(await screen.findByRole('button', { name: 'Отправить' })).toBeEnabled()
})
```

- [ ] **Step 2: Написать failing turn/render test**

```tsx
test('показывает ход постепенно и меняет спрайт только по ответу сервера', async () => {
  vi.useFakeTimers()
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  server.session(sessionWithoutTurn)
  server.providersAvailable()
  server.turn({ ...turnResult, visual_directive: { mode: 'sprite_scene', emotion: 'fan', pose: 'fan_open', outfit: 'red_dress' } })
  renderPlayer('/play/session-1')

  await user.click(await screen.findByRole('button', { name: 'Спросить о веере' }))
  expect(await screen.findByRole('img', { name: 'Аканэ: С веером' })).toHaveAttribute('data-expression', 'fan')
  expect(screen.queryByText(turnResult.dialogue.text)).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Показать полностью' }))
  expect(screen.getByText(turnResult.dialogue.text)).toBeInTheDocument()
  vi.useRealTimers()
})
```

Run: `npm --prefix apps/web test -- StoryPlayerPage.test.tsx`  
Expected: FAIL because player does not exist.

- [ ] **Step 3: Реализовать page model**

`useStoryPlayer(sessionId)` владеет состояниями `loading | ready | submitting | provider_unavailable | error`, загружает session/provider status, выполняет action и повторяет health check. Он не хранит отдельную пользовательскую эмоцию.

При `ApiRequestError.code === "provider_unavailable"` сохранить введённое действие, заблокировать controls и показать retry. При 409 перезагрузить session и объяснить, что состояние обновлено. Остальные ошибки показывать без потери последнего подтверждённого хода.

- [ ] **Step 4: Реализовать TypewriterText**

Props:

```ts
type TypewriterTextProps = {
  text: string
  charactersPerSecond?: number
  onComplete?: () => void
}
```

Компонент показывает текст через timer, очищает timer при смене текста/unmount, учитывает `prefers-reduced-motion` и имеет кнопку «Показать полностью». Кнопка отсутствует после завершения.

- [ ] **Step 5: Реализовать StoryPlayerPage**

Сохранить текущий визуальный стиль, но:

- удалить ручной `ToggleGroup` эмоций;
- вычислять CSS sprite position по server emotion;
- показывать narration/dialogue/choices из `TurnResult`;
- блокировать choices/free action во время запроса или offline;
- показывать provider/model в header;
- не показывать демонстрационную очередь ComfyUI;
- использовать `<img>`/background с `background-size` без изменения aspect ratio;
- добавить aria-live для статуса и ошибок.

- [ ] **Step 6: Запустить tests/typecheck/build**

Run: `npm --prefix apps/web test -- StoryPlayerPage.test.tsx`  
Expected: PASS.

Run: `npm --prefix apps/web run typecheck`  
Expected: PASS.

Run: `npm --prefix apps/web run build`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat: connect story player to canonical Ollama turns"
```

### Task 8: Сквозной тест, финальная документация и общий gate

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/package-lock.json`
- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/e2e/story-flow.spec.ts`
- Create: `apps/api/tests/fake_ollama.py`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- Consumes: весь вертикальный срез.
- Produces: воспроизводимая команда `npm run test:e2e` и общий `npm run check`.

- [ ] **Step 1: Добавить Playwright и scripts**

В web package добавить `@playwright/test` и `test:e2e`. В root package:

```json
"lint": "npm --prefix apps/web run lint:fsd && uv run --directory apps/api ruff check app tests",
"typecheck": "npm --prefix apps/web run typecheck",
"test:e2e": "npm --prefix apps/web run test:e2e",
"check": "npm run lint && npm run typecheck && npm test && npm run build"
```

- [ ] **Step 2: Создать deterministic fake Ollama**

`tests/fake_ollama.py` предоставляет `GET /api/tags` и `POST /api/chat`. Chat возвращает валидный JSON с `character_id="akane"`, эмоцией `fan`, русской репликой и тремя choices. Ответ зависит от action только текстово и никогда не обращается к сети.

- [ ] **Step 3: Настроить Playwright webServer**

Запустить три процесса:

1. `uv run --directory ../api uvicorn tests.fake_ollama:app --host 127.0.0.1 --port 11435`;
2. API с `DATABASE_PATH=.runlogs/e2e.db`, `OLLAMA_BASE_URL=http://127.0.0.1:11435` на 8000;
3. Vite на 5173.

Перед стартом теста использовать уникальный `DATABASE_PATH` внутри `.runlogs`, а не удалять пользовательскую базу.

- [ ] **Step 4: Написать end-to-end test**

```ts
test('игрок проходит один ход и восстанавливает его после перезагрузки', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Начать историю' }).click()
  await expect(page.getByRole('heading', { name: 'Эхо неона' })).toBeVisible()

  await page.getByRole('button', { name: 'Спросить о веере' }).click()
  await page.getByRole('button', { name: 'Показать полностью' }).click()
  await expect(page.getByText('Я ждала этого вопроса')).toBeVisible()
  await expect(page.getByRole('img', { name: 'Аканэ: С веером' })).toBeVisible()

  await page.reload()
  await expect(page.getByText('Я ждала этого вопроса')).toBeVisible()
  await expect(page.getByText('СОСТОЯНИЕ · v2')).toBeVisible()
})
```

Run: `npm run test:e2e`  
Expected: PASS.

- [ ] **Step 5: Обновить README acceptance flow**

Документировать установку Ollama/model, запуск, endpoint docs, расположение SQLite, поведение offline и команды:

```powershell
npm run setup
npm run check
npm run test:e2e
npm run dev:api
npm run dev:web
```

- [ ] **Step 6: Выполнить общий gate**

Run: `npm run check`  
Expected: frontend tests, backend tests, Ruff, Steiger, TypeScript и production build проходят без ошибок.

Run: `npm run test:e2e`  
Expected: один Playwright scenario проходит.

Run: `git diff --check`  
Expected: no whitespace errors.

- [ ] **Step 7: Commit**

```bash
git add package.json README.md apps/api/tests/fake_ollama.py apps/web/package.json apps/web/package-lock.json apps/web/playwright.config.ts apps/web/e2e
git commit -m "test: verify first playable Ollama story flow"
```

---

## Definition of Done

- В библиотеке видна встроенная история «Эхо неона» с Аканэ.
- Новое прохождение создаётся и восстанавливается по URL после перезагрузки.
- Ollama получает Pydantic JSON Schema и возвращает структурированный ход.
- Story engine принимает только разрешённых персонажей/состояния и атомарно сохраняет ход.
- Повтор запроса идемпотентен; конфликт версии не повреждает данные.
- Offline Ollama блокирует управление и предлагает повторную проверку.
- Текст показывается постепенно с возможностью мгновенно раскрыть его.
- Спрайт меняется по серверной визуальной директиве, а не локальной кнопке.
- Старые пользовательские SQLite-данные мигрируются без удаления.
- `npm run check` и `npm run test:e2e` проходят.

## Следующие отдельные планы

1. Каталог и ревизии персонажей.
2. Timeline rollback и ветвление прохождений.
3. Графический benchmark FLUX.2 Klein Base / Z-Image / SDXL.
4. ComfyUI jobs, CG и галерея.
5. LoRA training worker.
6. Свободная новелла.
7. OpenAI и переключение моделей между ходами.
