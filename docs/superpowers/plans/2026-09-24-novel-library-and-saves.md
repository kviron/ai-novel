# Novel Library and Saved Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show illustrated, descriptive novel cards and let players resume SQLite-backed sessions from a separate library tab.

**Architecture:** Extend persisted story metadata and session kind through an Alembic migration. Expose a filtered lightweight session list, then compose both library tabs inside the existing `pages/novel-library` slice. Keep the cover at a stable Vite public URL; keep author sessions out of player saves.

**Tech Stack:** FastAPI, SQLModel, Alembic, SQLite, React, TypeScript, shadcn/ui preset `b1D1mJdI`, Vitest, pytest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-24-novel-library-and-saves-design.md`

## Global Constraints

- Local single-user application; no accounts or cross-PC save sync in this change.
- Existing SQLite sessions survive migration and default to `kind="player"`.
- All save data comes from the API/SQLite, never browser storage.
- Test sessions created in Studio use `kind="author"` and are excluded from the player tab.
- No generated cover is fetched from a remote host at runtime.
- Run each task red-green-refactor and commit after verification; preserve the user's running app on ports 5173 and 8000.

---

### Task 1: Persist story metadata and session kind

**Files:**
- Create: `apps/api/migrations/versions/20260924_02_library_saves.py`
- Modify: `apps/api/app/db/models.py`
- Modify: `apps/api/app/modules/stories/seed.py`
- Test: `apps/api/tests/db/test_migrations.py`

**Interfaces:**
- Produces `Story.description: str`, `Story.cover_image_url: str | None`, `StorySession.kind: str`.
- Migration `revision = "20260924_02"`, `down_revision = "20260918_01"`.

- [ ] **Step 1: Write a migration test for an existing SQLite database.** Add a test using the existing migration fixture: insert an Akane story and a session at `20260918_01`, upgrade to head, and assert the same IDs still exist, session `kind` is `player`, story `description` is nonempty and `cover_image_url == "/covers/akane-neon-echo.webp"`.
- [ ] **Step 2: Run `uv run --directory apps/api pytest tests/db/test_migrations.py -q` and verify that the new assertions fail because the columns do not exist.**
- [ ] **Step 3: Add nullable `cover_image_url`, non-null `description` with empty default, and non-null `kind` with `player` default using Alembic batch operations. Backfill Akane by slug with its expanded synopsis and cover URL. Add matching SQLModel fields. Update `seed_akane_story()` so fresh databases receive the same metadata.**

```python
class StorySession(SQLModel, table=True):
    kind: str = Field(default="player")

# In migration upgrade():
op.execute("UPDATE story_sessions SET kind = 'player' WHERE kind IS NULL")
op.execute("UPDATE stories SET cover_image_url = '/covers/akane-neon-echo.webp' WHERE slug = 'akane-neon-echo'")
```

- [ ] **Step 4: Run migration tests, then `uv run --directory apps/api pytest -q`; verify all pass.**
- [ ] **Step 5: Commit migration, model, seed, and tests.**

### Task 2: Expose story metadata and filtered save summaries

**Files:**
- Modify: `apps/api/app/modules/stories/schemas.py`
- Modify: `apps/api/app/modules/stories/repository.py`
- Modify: `apps/api/app/modules/stories/service.py`
- Modify: `apps/api/app/modules/stories/router.py`
- Test: `apps/api/tests/stories/test_stories.py`

**Interfaces:**
- Produces `GET /api/sessions?kind=player|author` returning `list[SessionSummary]`.
- `SessionSummary` fields: `id`, `story: StorySummary`, `current_scene`, `state_version`, `created_at`, `updated_at`.
- `StartSessionRequest.kind: Literal["player", "author"] = "player"`.

- [ ] **Step 1: Add API tests:** story summary contains expanded description and cover URL; create one player and one author session and assert `GET /api/sessions?kind=player` returns only the player; create two player sessions, advance the older one, and assert descending `updated_at` then ID; assert a listed item has no `raw_response` or full turns.
- [ ] **Step 2: Run `uv run --directory apps/api pytest tests/stories/test_stories.py -q`; verify failures for missing fields and route.**
- [ ] **Step 3: Add `description` and `cover_image_url` to `StorySummary`; add `kind` to creation request; add `SessionSummary`. Query `StorySession` filtered by kind and ordered in SQL, then join each summary to its `Story` without loading turns. Route `/sessions` must appear before `/sessions/{session_id}`.**

```python
class SessionSummary(BaseModel):
    id: str
    story: StorySummary
    current_scene: str
    state_version: int
    created_at: str
    updated_at: str

@router.get("/sessions", response_model=list[SessionSummary])
def read_sessions(session: SessionDep, kind: Literal["player", "author"] = "player") -> list[SessionSummary]:
    return list_session_summaries(session, kind)
```

- [ ] **Step 4: Ensure `start_story_session()` stores `request.kind`; keep `GET /api/sessions/{id}` behavior unchanged. Run targeted tests and full backend suite.**
- [ ] **Step 5: Commit API and tests.**

### Task 3: Connect the browser API and mark Studio tests

**Files:**
- Modify: `apps/web/src/shared/api/contracts.ts`
- Modify: `apps/web/src/shared/api/index.ts`
- Modify: `apps/web/src/shared/api/client.ts`
- Modify: `apps/web/src/test/api-server.ts`
- Modify: `apps/web/src/pages/studio/ui/StudioPage.tsx`
- Test: `apps/web/src/shared/api/client.test.ts`, `apps/web/src/pages/studio/ui/StudioPage.test.tsx`

**Interfaces:**
- Produces `api.listSessions(kind: 'player' | 'author', signal?: AbortSignal): Promise<SessionSummary[]>`.
- Extends `StartSessionRequest` with optional `kind` while preserving existing callers.

- [ ] **Step 1: Add client test asserting GET `/api/sessions?kind=player` and abort signal; update Studio test to assert its POST body includes `kind: 'author'`.**
- [ ] **Step 2: Run `npm --prefix apps/web test -- --run src/shared/api/client.test.ts src/pages/studio/ui/StudioPage.test.tsx`; verify expected failures.**
- [ ] **Step 3: Extend transport types and API client. Teach the test API server to return player/author session summaries and record creation kind. Pass `kind: 'author'` only from Studio; library explicitly uses `kind: 'player'`.**

```ts
export type SessionSummary = {
  id: string
  story: StorySummary
  current_scene: string
  state_version: number
  created_at: string
  updated_at: string
}

listSessions(kind: 'player' | 'author', signal?: AbortSignal) {
  return request<SessionSummary[]>(`/api/sessions?kind=${kind}`, { baseUrl, signal })
}
```

- [ ] **Step 4: Run targeted tests, then frontend typecheck.**
- [ ] **Step 5: Commit client, Studio, fixture, and tests.**

### Task 4: Illustrated library with two tabs

**Files:**
- Create: `apps/web/public/covers/akane-neon-echo.webp`
- Add via shadcn CLI: `apps/web/src/shared/ui/tabs.tsx`
- Modify: `apps/web/src/pages/novel-library/ui/NovelLibraryPage.tsx`
- Modify: `apps/web/src/pages/novel-library/ui/NovelLibraryPage.test.tsx`
- Modify: `apps/web/src/styles.css` only if responsive layout cannot be expressed with existing utility classes.

**Interfaces:**
- Consumes `StorySummary.description`, `StorySummary.cover_image_url`, `api.listSessions('player')`, `SessionSummary`, `routes.storyPlayer(id)`.
- No new shared feature or entity slice; page owns its tab state and cards.

- [ ] **Step 1: Add page tests:** the catalog shows cover and description, starts a player session; the started tab shows each save and `Продолжить` navigates to its existing ID without a new POST; empty and retry states work; an image load failure uses the placeholder.
- [ ] **Step 2: Run `npm --prefix apps/web test -- --run src/pages/novel-library/ui/NovelLibraryPage.test.tsx`; verify failures for missing tabs and save list.**
- [ ] **Step 3: Use the imagegen skill to create a 3:4 portrait cover: rainy neon city, memory mystery, cinematic illustrated novel art, warm amber accent, no text/logos, no direct copy of an existing game's art. Place the final WebP at the fixed URL above. Add the shadcn Tabs component via `npx shadcn@latest add tabs --yes`, inspect generated files, then compose responsive Card + Tabs + Button UI.**
- [ ] **Step 4: Fetch stories and player sessions independently with abort signals; expose a retry action for the failed list. Format `updated_at` with `Intl.DateTimeFormat('ru-RU')`. Use an accessible image alt and a visible fallback for absent/broken covers.**

```tsx
<Tabs defaultValue="all">
  <TabsList><TabsTrigger value="all">Все новеллы</TabsTrigger><TabsTrigger value="started">Начатые</TabsTrigger></TabsList>
  <TabsContent value="all">{stories.map((story) => <Card key={story.id}><CardHeader><CardTitle>{story.title}</CardTitle><CardDescription>{story.description}</CardDescription></CardHeader><CardContent><Button onClick={() => startStory(story)}>Начать новую игру</Button></CardContent></Card>)}</TabsContent>
  <TabsContent value="started">{sessions.map((session) => <Card key={session.id}><CardHeader><CardTitle>{session.story.title}</CardTitle><CardDescription>{session.current_scene}</CardDescription></CardHeader><CardContent><Button asChild><Link to={routes.storyPlayer(session.id)}>Продолжить</Link></Button></CardContent></Card>)}</TabsContent>
</Tabs>
```

- [ ] **Step 5: Run page tests, frontend typecheck and build. Visually inspect desktop and 390 px mobile; fix clipping before committing.**
- [ ] **Step 6: Commit the page, generated UI component, cover, and tests.**

### Task 5: End-to-end save continuation and final verification

**Files:**
- Modify: `apps/web/e2e/story-flow.spec.ts`
- Modify: `README.md` to explain the two tabs and local SQLite saves.

**Interfaces:**
- Consumes implemented API and UI; no new production API.

- [ ] **Step 1: Extend Playwright flow:** start Akane from «Все новеллы», complete a turn, return to `/`, open «Начатые», click «Продолжить», assert the same session ID and latest dialogue after reload.**
- [ ] **Step 2: Run E2E on free alternate ports to avoid the user's live app:**

```powershell
$env:E2E_WEB_PORT='5174'
$env:E2E_API_PORT='8001'
$env:E2E_FAKE_PORT='11436'
npm run test:e2e
```

- [ ] **Step 3: Run `npm run check`, `git diff --check`, and inspect mobile/desktop screenshots. Update README and rerun checks if its instructions change.**
- [ ] **Step 4: Commit E2E and docs, inspect clean status, then push `HEAD:main` only if fast-forward and verify remote SHA equals local HEAD.**
