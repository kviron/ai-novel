# Portable Characters Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce one global character identity with immutable profile revisions, pin a revision in each story and session, and show the global catalog without changing existing saves.

**Architecture:** Add canonical character/revision/link tables and migrate all old rows. A focused `characters` backend module owns profile writes and catalog reads; `stories` resolves links for API responses, while `story_engine` loads only session-pinned revisions. The frontend keeps its existing card UI but fetches the global catalog.

**Tech Stack:** SQLite, Alembic, SQLModel, FastAPI/Pydantic, React/TypeScript, shadcn/ui, Vitest, pytest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-24-portable-characters-design.md`

## Global Constraints

- Preserve global IDs `akane` and `mark`, all existing story/session/turn IDs and their data.
- Character profiles are adult-only for new writes; never silently rewrite old records.
- A story and a session reference a precise immutable revision; catalog edits do not alter either link.
- Keep public API errors Russian and safe; no secrets or model responses in catalog exports.
- Use Alembic for every SQLite schema change; use existing shadcn primitives and FSD boundaries.

---

### Task 1: Add canonical tables and migrate existing profiles

**Files:**
- Create: `apps/api/migrations/versions/20260924_05_portable_characters.py`
- Modify: `apps/api/app/db/models.py`
- Test: `apps/api/tests/db/test_migrations.py`

**Interfaces:**
- Produces `CharacterRevision(id, character_id, revision_number, name, gender, age, personality, appearance, biography, speech, role, created_at)`, `StoryCharacter(story_id, character_id, revision_id, role)`, and `SessionCharacter(session_id, character_id, revision_id)` SQLModel tables. Adds `characters.current_revision_id` (nullable only during backfill, then populated for migrated rows).
- Retains the old `characters` columns temporarily so the existing runtime passes during migration.

- [ ] **Step 1: Write failing migration tests** for fresh DB and pre-upgrade SQLite: insert an old character and session, run migrations, assert one revision and both story/session links point to it, then run migrations again and assert no duplicates. Include a legacy record with an unknown ID so migration is not demo-only.
- [ ] **Step 2: Run** `uv run --directory apps/api pytest -q tests/db/test_migrations.py` and confirm a failure from missing canonical tables.
- [ ] **Step 3: Implement the migration.** Create tables with foreign keys and unique `(character_id, revision_number)` plus `(story_id, character_id)` and `(session_id, character_id)`. Copy every old profile into revision 1, create story links, and create session links from each session's story. Add model classes matching table names; avoid mutating turns.
- [ ] **Step 4: Run** `uv run --directory apps/api pytest -q tests/db/test_migrations.py`; expect green. Commit with `feat: migrate character profiles to pinned revisions`.

### Task 2: Provide a focused global catalog API

**Files:**
- Create: `apps/api/app/modules/characters/{schemas,repository,service,router}.py`
- Modify: `apps/api/app/main.py`
- Test: `apps/api/tests/characters/test_characters.py`

**Interfaces:**
- `list_characters(session) -> list[CharacterProfile]`
- `get_character(session, character_id) -> CharacterHistory`
- `create_character(session, payload: CharacterWrite) -> CharacterProfile`
- `revise_character(session, character_id, payload: CharacterWrite) -> CharacterProfile`
- `attach_character(session, story_id, character_id, revision_id, role) -> StoryCharacterProfile`

- [ ] **Step 1: Write API tests** for `GET /api/characters`, `GET /api/characters/{id}`, `POST /api/characters`, `POST /api/characters/{id}/revisions`, and `POST /api/stories/{id}/characters`: include a 17-year-old rejection, an unrelated revision rejection, and duplicate link conflict.
- [ ] **Step 2: Run** `uv run --directory apps/api pytest -q tests/characters/test_characters.py`; confirm 404/validation failures for the new routes.
- [ ] **Step 3: Add strict Pydantic request/response schemas and repository queries.** Keep transactions inside service operations. Creating a character inserts identity and revision 1 atomically; revising inserts the next revision and advances only `characters.current_revision_id`; attaching checks ownership and inserts/updates only `story_characters`. Map domain failures to `ApiError` in the router.
- [ ] **Step 4: Run** the API tests and the whole backend suite. Commit with `feat: add versioned character catalog API`.

### Task 3: Read pinned revisions throughout the story runtime

**Files:**
- Modify: `apps/api/app/modules/stories/{repository,service,seed}.py`
- Modify: `apps/api/app/modules/story_engine/repository.py`
- Modify: `apps/api/app/db/models.py`
- Create: `apps/api/migrations/versions/20260924_06_remove_legacy_character_profile.py`
- Test: `apps/api/tests/stories/test_stories.py`, `apps/api/tests/story_engine/test_turns.py`, `apps/api/tests/db/test_migrations.py`

**Interfaces:**
- `stories.repository.list_story_characters(session, story_id)` returns profiles for story-pinned revisions.
- `stories.repository.list_session_characters(session, session_id)` returns profiles for session-pinned revisions.
- Current `StoryDetail.characters` and `SessionDetail.characters` transport shape remains unchanged.

- [ ] **Step 1: Write regression tests:** create a session on revision 1, create revision 2 and attach it to the story, then assert old session/detail and the next generated turn still use revision 1; a new session uses revision 2. Confirm seed restarts do not reset links.
- [ ] **Step 2: Run** targeted tests and observe the old runtime returning the wrong live profile or missing new character.
- [ ] **Step 3: Resolve profiles through links.** At session start copy each story link into `session_characters` in the same transaction. `get_story` reads story links; `get_session_detail` and `story_engine.load_context` read session links. Seed built-ins only when absent and never advance existing links. Once no runtime code reads profile columns from `characters`, migrate away those legacy columns.
- [ ] **Step 4: Run** `uv run --directory apps/api pytest -q` and migration tests; expect green. Commit with `feat: pin character revisions in story sessions`.

### Task 4: Switch the catalog UI to global profiles

**Files:**
- Modify: `apps/web/src/shared/api/{client,contracts}.ts`
- Modify: `apps/web/src/pages/characters/ui/{CharactersPage,CharacterDetailPage,CharacterArtwork}.tsx`
- Modify: `apps/web/src/pages/characters/ui/CharactersPage.test.tsx`
- Modify: `apps/web/src/app/router.tsx`, `apps/web/src/shared/config/routes.ts`

**Interfaces:**
- `api.listCharacters(signal?)` and `api.getCharacter(id, signal?)` consume canonical API shapes.
- `/characters/:characterId` is the canonical profile route; old `/characters/:storyId/:characterId` redirects to it for existing links.

- [ ] **Step 1: Write component tests:** catalog fetches once, gender filter works across stories, card opens canonical profile, profile shows revision metadata, unknown ID offers return, and old deep link redirects.
- [ ] **Step 2: Run** `npm --prefix apps/web test -- CharactersPage.test.tsx`; confirm failures from missing client methods/route.
- [ ] **Step 3: Implement the API client and UI.** Keep cards and fallback images; map the two bundled portraits by character ID. No speculative editor controls. Profile displays a list of linked stories when present.
- [ ] **Step 4: Run** frontend tests, typecheck, and Steiger. Commit with `feat: display the global character catalog`.

### Task 5: Verify complete first slice and update status

**Files:**
- Modify: `docs/roadmap.md`, `README.md`, `AGENTS.md`
- Test: `apps/web/e2e/global-navigation.spec.ts` or a dedicated catalog E2E spec

**Interfaces:** No new runtime interface. Documentation must call this a partial stage-2 slice, not a finished stage.

- [ ] **Step 1: Add an E2E scenario** that sees both demo characters, filters male/female, opens Mark's profile, and follows the canonical route.
- [ ] **Step 2: Run** `npm run check` and isolated E2E with `E2E_WEB_PORT=5174`, `E2E_API_PORT=8001`, `E2E_FAKE_PORT=11436`; confirm no failures.
- [ ] **Step 3: Update documentation** with the implemented scope and explicit remaining work (materials, import/export, graphical editing).
- [ ] **Step 4: Inspect** `git diff --check` and staged file names, then commit `docs: record portable character foundation`.

## Self-review

The plan covers identity/revisions, migration, story/session pinning, API, catalog UI and regression tests. Asset provenance/import/export and the graphical editor are explicitly outside this first slice and remain required before stage 2 is `done`. No task changes existing save IDs or asks the frontend to infer revision semantics.
