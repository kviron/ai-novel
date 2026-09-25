# Player Protagonist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A player can start a story as an author-fixed, catalog, or one-session draft hero; the model never receives that hero as an NPC.

**Architecture:** Persist one immutable hero snapshot per session and a versioned hero policy on each story. Resolve the snapshot atomically while starting a session, then expose it separately from the NPC list to prompt construction and proposal validation. A dedicated setup page gathers the permitted choice before calling the existing session endpoint.

**Tech Stack:** FastAPI, SQLModel, Alembic, SQLite, React, TypeScript, shadcn/ui, pytest, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-26-player-protagonist-design.md`

## Global Constraints

- Existing sessions and turns must survive migration; old sessions receive a neutral `legacy` hero.
- Draft heroes do not create catalog characters automatically.
- Catalog and fixed choices pin one exact character revision; later edits cannot change the hero.
- A hero chosen from the cast is omitted from the model-controlled NPC list only when the author explicitly marked that cast member playable.
- No provider response can commit a hero dialogue segment; invalid output receives at most one repair attempt.
- UI copy is Russian and uses existing shadcn primitives and routing conventions.

---

## File map

- `apps/api/app/db/models.py`, `apps/api/migrations/versions/20260926_12_session_protagonists.py`: durable story policy and session snapshot.
- `apps/api/app/modules/stories/protagonist.py`: resolve one choice, validate policy, create snapshot, exclude controlled cast member, promote draft to catalog.
- `apps/api/app/modules/stories/{schemas,service,router,repository}.py`: setup/start/detail API boundaries only.
- `apps/api/app/modules/story_engine/{rules,repository,prompt}.py`: detached hero context and model safety rules.
- `apps/web/src/pages/story-setup/ui/StorySetupPage.tsx`: start form and summary; no persistence logic outside the API client.
- `apps/web/src/shared/{api,config}` and `apps/web/src/pages/novel-library/ui/NovelLibraryPage.tsx`: typed contracts, route, library navigation.
- `apps/api/tests/{db,stories,story_engine}`, `apps/web/src/pages/story-setup/ui/StorySetupPage.test.tsx`, `apps/web/e2e/story-setup.spec.ts`: unit, contract, and E2E coverage.

### Task 1: Durable hero snapshot and migration

**Files:** Modify `apps/api/app/db/models.py`; create `apps/api/migrations/versions/20260926_12_session_protagonists.py`; test `apps/api/tests/db/test_migrations.py`.

**Interfaces:** `Story.hero_policy: str`, `Story.hero_policy_version: int`, `Story.fixed_hero_revision_id: str | None`, `Story.playable_character_ids: str`; `SessionProtagonist(session_id PK, source_kind, source_character_id?, source_revision_id?, policy_version, name, address, gender, appearance, biography, personality, age?)`; `ProtagonistExport(session_id PK, character_id)` for idempotent catalog promotion.

- [ ] Write a failing migration test: upgrade a copied/legacy database, assert one neutral protagonist per existing session and unchanged turn/session counts.
- [ ] Run `uv run --directory apps/api pytest tests/db/test_migrations.py -q -k protagonist`; expect a missing table/column failure.
- [ ] Add model and migration with story defaults `hero_policy='choice'`, `hero_policy_version=1`, `playable_character_ids='[]'`; backfill legacy snapshots with `source_kind='legacy'`, name/address `Игрок`, gender `unspecified`.

```python
class SessionProtagonist(SQLModel, table=True):
    __tablename__ = "session_protagonists"
    session_id: str = Field(foreign_key="story_sessions.id", primary_key=True)
    source_kind: str
    source_character_id: str | None = None
    source_revision_id: str | None = None
    policy_version: int
    name: str
    address: str
    gender: str = "unspecified"
    appearance: str = ""
    biography: str = ""
    personality: str = ""
    age: int | None = None
```
- [ ] Re-run the focused migration test; assert it passes. Commit only migration/model/test.

### Task 2: Policy resolution and atomic start API

**Files:** Create `apps/api/app/modules/stories/protagonist.py`; modify `apps/api/app/modules/stories/{schemas,service,router,repository,seed}.py`; test `apps/api/tests/stories/test_protagonist.py`.

**Interfaces:** `HeroChoice = FixedChoice | CatalogChoice | DraftChoice` discriminated by `source_kind`; `resolve_protagonist(session: Session, story: Story, choice: HeroChoice, session_id: str) -> SessionProtagonist`; `StorySetup` returns policy, allowed sources, playable IDs; `SessionDetail.protagonist: ProtagonistDetail`.

- [ ] Write failing API tests: valid fixed/catalog/draft starts, rejected disallowed source, rejected cast member without playable flag, pinned revision remains stable after catalog edit, invalid choice leaves no session/autosave.
- [ ] Run `uv run --directory apps/api pytest tests/stories/test_protagonist.py -q`; expect route/contract failures.
- [ ] Implement one policy resolver in `protagonist.py`; make `start_story_session` flush the session, resolve hero, pin NPCs excluding selected cast hero, update autosave, and commit once. Seed demo story with draft/catalog choice and keep author sessions explicitly compatible.

The resolver must not commit; `start_story_session` owns the transaction. For a catalog choice, load `CharacterRevision` by the supplied ID and verify its `character_id` matches the supplied character ID before copying fields. For a draft, validate `name.strip()` and copy only submitted fields.
- [ ] Add `GET /api/stories/{story_id}/setup`, extend `POST /api/stories/{story_id}/sessions`, and include protagonist in session detail. Test again and commit.

### Task 3: Save session draft to catalog

**Files:** Modify `apps/api/app/modules/stories/{protagonist,router}.py`; test `apps/api/tests/stories/test_protagonist.py`.

**Interfaces:** `POST /api/sessions/{session_id}/protagonist/save-to-catalog` accepts `age: int`, `personality: str`, `appearance: str`; it creates an independent character and returns `CharacterProfile`. Existing snapshot values take precedence over submitted duplicates.

- [ ] Write failing tests: draft remains absent from catalog until save; missing mandatory catalog fields return 422; save creates a new ID without mutating the session hero; repeated request uses an idempotency key to avoid duplicate characters.
- [ ] Run the focused tests and confirm the expected failures.
- [ ] Reuse `create_character` after constructing a complete `CharacterWrite` from the snapshot plus supplied missing fields. Insert `ProtagonistExport(session_id, character_id)` in the same transaction; if that row exists, return the previously created character instead of creating another.

The endpoint first checks `ProtagonistExport(session_id)`, then copies the snapshot into `CharacterWrite` with explicit completion fields, flushes the new character, writes the export mapping and commits. `create_character` currently commits internally, so refactor it to accept an uncommitted creation path before composing these operations.
- [ ] Run tests and commit.

### Task 4: Separate hero from NPCs in generation

**Files:** Modify `apps/api/app/modules/story_engine/{rules,repository,prompt}.py`; test `apps/api/tests/story_engine/test_protagonist_rules.py`.

**Interfaces:** `GenerationContext.protagonist: dict[str, Any]`; `GenerationContext.characters` contains NPCs only; `build_prompt` emits separate `protagonist` and `characters` JSON; `validate_proposal` rejects hero ID for dialogue/directives.

- [ ] Write failing rules/prompt tests: hero data appears once outside NPC list, hero dialogue ID is rejected, NPC dialogue succeeds, narration may describe an external effect but prompts forbid decisions/replies for the hero.
- [ ] Run `uv run --directory apps/api pytest tests/story_engine/test_protagonist_rules.py -q`; confirm failures.
- [ ] Update detached context, prompt and validation; preserve one existing repair attempt. Do not claim semantic detection of every free-text violation; add a conservative regression for explicit first-person hero decisions.

```python
if segment.kind == "dialogue" and segment.character_id == context.protagonist.get("source_character_id"):
    raise InvalidProposalError("protagonist_dialogue_forbidden")
```
- [ ] Run focused tests and existing story-engine tests; commit.

### Task 5: Story setup screen

**Files:** Create `apps/web/src/pages/story-setup/{index.ts,ui/StorySetupPage.tsx,ui/StorySetupPage.test.tsx}`; modify `apps/web/src/shared/api/{client,contracts}.ts`, `apps/web/src/shared/config/routes.ts`, `apps/web/src/app/router.tsx`, `apps/web/src/pages/novel-library/ui/NovelLibraryPage.tsx`.

**Interfaces:** `api.getStorySetup(storyId)`, typed `HeroChoice`, `api.startSession(storyId, {provider_id, kind, hero})`; route `/stories/:storyId/setup`.

- [ ] Write failing component tests for catalog selection, draft fields, summary/edit flow, fixed hero, policy error and disabled start while pending.
- [ ] Run `npm --prefix apps/web test -- StorySetupPage.test.tsx`; confirm expected failures.
- [ ] Compose with existing shadcn Card, Button, Input, Textarea, Select and Alert primitives; library Start opens setup, Continue still opens saved session.

```tsx
async function start(choice: HeroChoice) {
  const game = await api.startSession(storyId, { provider_id: story.recommended_provider_id, kind: 'player', hero: choice })
  navigate(routes.storyPlayer(game.id))
}
```
- [ ] Run tests, TypeScript typecheck and FSD lint; commit.

### Task 6: End-to-end verification and documentation

**Files:** Create `apps/web/e2e/story-setup.spec.ts`; update `docs/roadmap.md` and `README.md`.

- [ ] Add E2E for a draft and catalog hero using fake Ollama, including page reload and no hero dialogue from provider output; add fixed policy API scenario if UI author configuration is not yet exposed.
- [ ] Run `npm run check` and `npm run test:e2e` with isolated ports; fix only failures within this slice.
- [ ] Migrate a backed-up copy of the existing SQLite; verify story, session and turn counts before/after. Inspect `git diff --check` and the final diff.
- [ ] Update roadmap with the completed *hero identity slice*; do not mark all of stage 3 done until free/hybrid world setup and canon checks exist. Commit and push the branch.
