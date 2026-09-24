# Scene Dialogue and Cast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve ordered multi-speaker scene output and let authors manage a story-specific cast, revision, role, and color.

**Architecture:** Ollama returns typed segments; the story engine validates and stores canonical segments while exposing legacy fields for old readers. Story-character links own colors and pin them into sessions. The web app renders segments from API data and edits cast links through small, focused dialogs.

**Tech Stack:** FastAPI, SQLModel, Alembic, Pydantic, React, TypeScript, shadcn/ui, pytest, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-25-scene-dialogue-and-cast-design.md`

## Global Constraints

- Keep existing saves and branch history readable without rewriting literary text.
- One generation request per turn, with at most one repair request.
- Color belongs to the story link, is normalized as `#RRGGBB`, and is pinned into new sessions.
- Existing sessions do not change when the cast is edited or a member removed.
- Do not parse speaker names from prose; use character IDs.

---

### Task 1: Multi-speaker generation and persistence

**Files:** `apps/api/app/modules/providers/contracts.py`, `apps/api/app/modules/story_engine/contracts.py`, `apps/api/app/modules/story_engine/rules.py`, `apps/api/app/modules/story_engine/prompt.py`, `apps/api/app/modules/story_engine/repository.py`, `apps/api/app/modules/stories/schemas.py`, `apps/api/app/modules/stories/service.py`, `apps/api/app/db/models.py`, `apps/api/migrations/versions/20260925_09_scene_segments_and_color.py`, `apps/api/tests/story_engine/test_turns.py`, `apps/api/tests/db/test_migrations.py`.

**Interfaces:** `TurnProposal.segments: list[SceneSegment]` where `SceneSegment` contains `kind`, `text`, and `character_id` only for dialogue. `AcceptedTurn.segments` and both public turn responses carry the same canonical sequence.

- [x] Write failing tests: an interleaved A/B response is returned in order, unknown speaker and repeated dialogue are repaired once, old turn rows expose compatible segments.
- [x] Run targeted tests and confirm failures are about missing segment support.
- [x] Implement segment contract, prompt example, rule validation, migration, persistence, and legacy read adapter.
- [x] Run story-engine tests and migration tests; fix regressions without changing historical turn content.
- [x] Integrate with the feature commit after cross-layer verification.

### Task 2: Cast API and session color snapshots

**Files:** `apps/api/app/modules/characters/schemas.py`, `apps/api/app/modules/characters/repository.py`, `apps/api/app/modules/characters/service.py`, `apps/api/app/modules/characters/router.py`, `apps/api/app/modules/stories/repository.py`, `apps/api/app/modules/stories/service.py`, `apps/api/app/modules/stories/schemas.py`, `apps/api/tests/characters/test_story_role.py`, `apps/api/tests/characters/test_characters.py`.

**Interfaces:** `GET /api/characters?exclude_story_id=…`; `POST /api/stories/{id}/characters/batch` with character IDs; `PUT /api/stories/{id}/characters/{id}` with revision, role, and color; `DELETE /api/stories/{id}/characters/{id}` prevents removal of the last cast member.

- [x] Write failing API tests for filtering, atomic batch attach, normalized colors, pinned session color, removal semantics and last-member guard.
- [x] Run targeted character tests and confirm expected failures.
- [x] Implement focused repository/service/router logic and extend the migration from Task 1 with story/session color columns.
- [x] Run targeted tests and full API suite; integrate with the feature commit.

### Task 3: Scene and history rendering

**Files:** `apps/web/src/shared/api/contracts.ts`, `apps/web/src/features/play-story/ui/StoryScene.tsx`, `apps/web/src/features/play-story/ui/DialogueHistory.tsx`, `apps/web/src/features/play-story/ui/SceneSegments.tsx`, `apps/web/src/pages/story-player/ui/StoryPlayerPage.test.tsx`.

**Interfaces:** `SceneSegments` receives ordered segments and session character snapshots; it renders narration, short first-word speaker labels, and story-specific colors without parsing speech text.

- [x] Add failing component tests for interleaved two-speaker display and legacy fallback.
- [x] Run targeted Vitest and observe missing segment rendering.
- [x] Implement shared scene-fragment presentation in both stage and dialogue history.
- [x] Run frontend tests and typecheck; integrate with the feature commit.

### Task 4: Cast editor

**Files:** `apps/web/src/shared/api/contracts.ts`, `apps/web/src/shared/api/client.ts`, `apps/web/src/pages/story-cast/ui/StoryCastPage.tsx`, `apps/web/src/pages/story-cast/ui/StoryCastPage.test.tsx` and focused cast child components beside the page.

**Interfaces:** Story cast table owns no data parsing; add dialog fetches server-filtered catalog; edit dialog updates role, revision and color; remove action deletes only the story link.

- [x] Add failing UI tests for add modal filtering/selection, edit color, deletion and mobile-accessible actions.
- [x] Run targeted Vitest and confirm the UI lacks the requested behavior.
- [x] Compose existing UI primitives with responsive cast rows and focused dialogs; implement API client calls.
- [x] Run UI tests, typecheck, API tests and build; inspect the desktop and narrow flows via browser E2E.
- [x] Integrate cast editor and final fixes in the feature commit.
