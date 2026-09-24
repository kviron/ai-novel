# Autosave and Rewind Branches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show one active autosave per novel and let players undo up to ten recent turns while preserving alternative branches.

**Architecture:** SQLite stores one autosave pointer per story and immutable parent-linked turns. A session stores its active turn, monotonic revision, and consecutive rewind count. The story engine owns ancestry traversal and atomic pointer movement; the React player consumes server-provided `can_rewind` and a session snapshot.

**Tech Stack:** FastAPI, SQLModel, Alembic, SQLite, React, TypeScript, shadcn/ui, pytest, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-24-autosave-rewind-branches-design.md`

## Global Constraints

- Preserve all existing sessions and turns; do not delete or merge user data.
- Maximum consecutive rewinds before a new turn: 10; older history remains in SQLite.
- Keep `StorySession.state_version` monotonic across both turns and rewinds.
- Historical links are reconstructed by old turn `state_version` within each session.
- Studio author sessions never become player autosaves.
- Test on alternate ports 5174, 8001, 11436; do not run E2E against the user's live SQLite database.
- Keep the established shadcn preset `b1D1mJdI` and FSD boundaries.

---

### Task 1: Persist autosave pointers and active history

**Files:**
- Create: `apps/api/migrations/versions/20260924_03_autosave_rewind.py`
- Modify: `apps/api/app/db/models.py`
- Test: `apps/api/tests/db/test_migrations.py`

**Interfaces:**
- Produces `Autosave(story_id: str, session_id: str)`, `StorySession.active_turn_id: str | None`, `StorySession.rewind_count: int`, `Turn.parent_turn_id: str | None`, `Turn.scene_after: str`.
- Migration revision `20260924_03`, parent `20260924_02`.

- [ ] **Step 1: Write failing migration tests.** Start from a v0.1 fixture with two sequential turns and two player sessions for one story. Assert the original rows survive, each turn links to its predecessor, `active_turn_id` identifies the last turn, and exactly one autosave pointer selects the latest session by `(updated_at, id)`. Assert author sessions never receive a pointer.
- [ ] **Step 2: Run `uv run --directory apps/api pytest tests/db/test_migrations.py -q -k autosave_rewind` and verify missing schema fails.**
- [ ] **Step 3: Add the migration and models.** Add nullable active/parent IDs and non-null `rewind_count`/`scene_after` with safe defaults. In migration Python, fetch `(session_id, turn_id, state_version)` ordered by session and version; update each turn's parent and session's active turn. Backfill `scene_after` from the owning session. Build `autosaves` with `story_id` primary key and `session_id` foreign key; select one player session per story ordered by `updated_at DESC, id DESC`. Example model shape:

```python
class Autosave(SQLModel, table=True):
    __tablename__ = "autosaves"
    story_id: str = Field(foreign_key="stories.id", primary_key=True)
    session_id: str = Field(foreign_key="story_sessions.id")

class StorySession(SQLModel, table=True):
    active_turn_id: str | None = None
    rewind_count: int = 0

class Turn(SQLModel, table=True):
    parent_turn_id: str | None = None
    scene_after: str = ""
```

- [ ] **Step 4: Run migration tests and full backend tests.** Use `uv run --directory apps/api pytest tests/db/test_migrations.py -q` then `uv run --directory apps/api pytest -q`; fix any model/migration mismatch.
- [ ] **Step 5: Commit migration, models, and tests.**

### Task 2: Make autosave selection server-owned

**Files:**
- Modify: `apps/api/app/modules/stories/repository.py`
- Modify: `apps/api/app/modules/stories/service.py`
- Modify: `apps/api/app/modules/stories/router.py`
- Modify: `apps/api/tests/stories/test_stories.py`

**Interfaces:**
- Produces `GET /api/autosaves -> list[SessionSummary]`, sorted by autosave session `updated_at DESC, id DESC`.
- `POST /api/stories/{id}/sessions` with `kind="player"` creates a session and updates the story's autosave pointer in the same transaction; `kind="author"` does not.
- Existing `GET /api/sessions/{id}` and filtered session list remain available.

- [ ] **Step 1: Write failing API tests.** Start two player sessions for the same story and assert `/api/autosaves` returns only the second; access/update the first by direct ID and verify pointer remains second. Start an author session and verify it does not change the pointer. Test the empty list before player start.
- [ ] **Step 2: Run `uv run --directory apps/api pytest tests/stories/test_stories.py -q -k autosave` and verify failures.**
- [ ] **Step 3: Implement repository and service operations.** Add `list_autosaves(session: Session) -> list[tuple[StorySession, Story]]` as a SQL join through `Autosave`. During player start, `session.add(story_session); session.flush(); session.merge(Autosave(story_id=story.id, session_id=story_session.id)); session.commit()` inside one transaction; author creation omits the merge. Add `/api/autosaves` and reuse the existing `SessionSummary` mapper.
- [ ] **Step 4: Run targeted and full backend tests; commit.**

### Task 3: Rewind through immutable turn ancestry

**Files:**
- Modify: `apps/api/app/modules/story_engine/repository.py`
- Modify: `apps/api/app/modules/story_engine/service.py`
- Modify: `apps/api/app/modules/story_engine/router.py`
- Modify: `apps/api/app/modules/stories/repository.py`
- Modify: `apps/api/app/modules/stories/service.py`
- Modify: `apps/api/app/modules/stories/schemas.py`
- Modify: `apps/api/app/modules/story_engine/contracts.py`
- Test: `apps/api/tests/story_engine/test_turns.py`

**Interfaces:**
- Produces `POST /api/sessions/{id}/rewind` with `{ "expected_state_version": number } -> SessionDetail`.
- Adds `can_rewind: bool` to `SessionDetail`; the server computes it from active turn and `rewind_count < 10`.
- Turn submission continues to use `expected_state_version` and `request_id`; new turns get `parent_turn_id = active_turn_id`, then become active.

- [ ] **Step 1: Write failing engine/API tests.** Cover one-step rewind to initial state, two turns then rewind to the first, a new choice after rewind preserving the old turn, restored visual state and `current_scene`, prompt context excluding abandoned descendants, 10 allowed rewinds and the 11th rejected, stale `expected_state_version` rejected without mutation, and a duplicate old turn request returning its original result without changing the active pointer.
- [ ] **Step 2: Run the targeted engine tests and verify failures.** `uv run --directory apps/api pytest tests/story_engine -q -k rewind`.
- [ ] **Step 3: Implement ancestry reads.** Replace `ORDER BY state_version DESC LIMIT 8` in `load_context()` with an ancestor walk from `active_turn_id` (at most eight accepted turns for prompt context). Replace global `get_latest_turn()` in session detail with lookup of `active_turn_id`. Keep historical turn rows and request IDs immutable.
- [ ] **Step 4: Implement atomic turn/rewind transitions.** In `commit_turn()`, set the new turn's `parent_turn_id` and `scene_after`, update `active_turn_id`, increment session revision, reset `rewind_count=0`, and preserve current idempotency/concurrency checks. Add a `RewindRequest` Pydantic model with `expected_state_version: int = Field(ge=1)`. `rewind_session()` acquires SQLite `BEGIN IMMEDIATE`, verifies revision and active turn, rejects `rewind_count >= 10`, selects the parent, restores scene, increments revision and rewind count, then commits. Route errors: 404 missing session, 409 conflict, 422 no earlier turn/limit reached.

```python
class RewindRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_state_version: int = Field(ge=1)

@router.post("/{session_id}/rewind", response_model=SessionDetail)
def post_rewind(session_id: str, payload: RewindRequest, session: SessionDep) -> SessionDetail:
    return rewind_session(session, session_id, payload.expected_state_version)
```

- [ ] **Step 5: Run targeted tests, full backend suite, and commit.**

### Task 4: One novel card and a rewind control

**Files:**
- Modify: `apps/web/src/shared/api/contracts.ts`
- Modify: `apps/web/src/shared/api/client.ts`
- Modify: `apps/web/src/test/api-server.ts`
- Modify: `apps/web/src/pages/novel-library/ui/NovelLibraryPage.tsx`
- Modify: `apps/web/src/pages/novel-library/ui/NovelLibraryPage.test.tsx`
- Modify: `apps/web/src/features/play-story/api/story-session.ts`
- Modify: `apps/web/src/features/play-story/model/useStoryPlayer.ts`
- Modify: `apps/web/src/features/play-story/ui/StoryScene.tsx`
- Test: `apps/web/src/pages/story-player/ui/StoryPlayerPage.test.tsx`

**Interfaces:**
- Produces `api.listAutosaves(signal?: AbortSignal): Promise<SessionSummary[]>` and `api.rewind(sessionId: string, expectedStateVersion: number, signal?: AbortSignal): Promise<StorySession>`.
- Consumes `StorySession.can_rewind`; the player hook exposes `rewind(): Promise<void>` and `rewinding: boolean`.

- [ ] **Step 1: Write failing UI/client tests.** Mock two historical sessions for one story but one `/api/autosaves` row; assert one card, count `(1)`, and correct continuation ID. Test arrow disabled at initial state, enabled after a turn, and click restores prior session snapshot without calling the LLM provider. Test 409 reload and normal error display.
- [ ] **Step 2: Run targeted Vitest tests and verify failures.** `npm --prefix apps/web test -- --run src/pages/novel-library/ui/NovelLibraryPage.test.tsx src/pages/story-player/ui/StoryPlayerPage.test.tsx`.
- [ ] **Step 3: Extend the browser API and fixture.** Add `can_rewind` to `StorySession`, `listAutosaves` and `rewind`; mock `/api/autosaves` and `/api/sessions/{id}/rewind`. Change the library fetch from `listSessions('player')` to `listAutosaves()`; preserve independent loading/retry states.
- [ ] **Step 4: Add the rewind action.** `useStoryPlayer.rewind()` guards busy state, POSTs the expected revision, applies returned `StorySession`, clears action and turn retry attempt, handles 409 by reloading, and never calls provider availability just to rewind. Place a shadcn `Button` with a `CornerUpLeft` icon and accessible label `Отменить ход` near the scene input; disable it when `!session.can_rewind` or the hook is busy. Do not introduce a custom button primitive.
- [ ] **Step 5: Run frontend tests, typecheck, build, and FSD lint; commit.**

### Task 5: End-to-end verification and documentation

**Files:**
- Modify: `apps/web/e2e/story-flow.spec.ts`
- Modify: `README.md`
- Modify: `docs/roadmap.md`

**Interfaces:**
- Exercises player start → turn → rewind → alternate turn → reload → continue from the same active branch.

- [ ] **Step 1: Extend the Playwright flow.** With the fake Ollama provider, submit one action, capture its dialogue, click `Отменить ход`, submit a different action, reload, and assert the new active action/response and one card in «Начатые». The backend branch test from Task 3 proves old path retention.
- [ ] **Step 2: Run E2E on isolated ports.** In PowerShell set `$env:E2E_WEB_PORT='5174'; $env:E2E_API_PORT='8001'; $env:E2E_FAKE_PORT='11436'`; then run `npm run test:e2e`.
- [ ] **Step 3: Document autosave pointer, 10-step rewind, preserved branches, and the absence of manual save UI in README/roadmap.**
- [ ] **Step 4: Run `npm run check`, `git diff --check`, inspect the isolated E2E page visually at desktop and mobile widths, and commit.**
- [ ] **Step 5: Before touching the user's live SQLite, create a verified SQLite backup in `apps/api/data/`; restart only the exact API process serving port 8000 so startup migrations apply, then check `/api/autosaves` and the live page. If the live server is not running, leave it stopped and explain how to launch it.**
- [ ] **Step 6: Fetch `origin/main`, verify it is an ancestor of `HEAD`, push `HEAD:main`, and compare `git ls-remote origin refs/heads/main` with `git rev-parse HEAD`.**
