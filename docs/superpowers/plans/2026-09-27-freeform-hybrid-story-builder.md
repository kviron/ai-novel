# Freeform and Hybrid Story Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a local author create, validate, test, publish, revise, and play immutable freeform or hybrid AI visual-novel versions through the Studio UI.

**Architecture:** Introduce a versioned story-authoring aggregate behind one `story_authoring` module. Mutable drafts and immutable published versions share typed child records; player sessions pin a published version, while author tests pin a hashed draft snapshot. The story engine consumes a provider-neutral `RuntimeStoryDefinition`, keeping database structure and author text out of provider adapters.

**Tech Stack:** Python 3.11, FastAPI, SQLModel, Alembic, Pydantic v2, SQLite, React, TypeScript, React Router, shadcn/ui, Vitest, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-27-freeform-hybrid-story-builder-design.md`

## Global Constraints

- Modes are exactly `freeform` and `hybrid`; keep the existing API value `free` only as a one-release read compatibility alias during migration.
- Player sessions require an immutable published `story_version_id`; author test sessions require an immutable `draft_snapshot_id`.
- Author rules are typed data. Never accept executable expressions, raw system prompts, HTML, filesystem paths, or provider secrets.
- Every referenced character revision must belong to an adult character whose age is at least 18.
- Published versions and draft snapshots are immutable.
- Existing story/session IDs, autosaves, turns, protagonist snapshots, and cast snapshots must survive migration.
- The server remains authoritative: provider output is proposed, validated, and committed atomically with at most one repair attempt.
- The visual node graph, arbitrary branching language, CG, ComfyUI, LoRA, and cloud collaboration are out of scope.
- All new user-facing text and recovery actions are Russian.

---

### Task 1: Persist versioned story definitions and migrate existing data

**Files:**
- Modify: `apps/api/app/db/models.py`
- Create: `apps/api/migrations/versions/20260927_13_story_versions.py`
- Modify: `apps/api/tests/db/test_migrations.py`
- Modify: `apps/api/tests/conftest.py`

**Interfaces:**
- Produces: `StoryVersion`, `StoryMaterial`, `StoryVersionCharacter`, `CanonFact`, `StoryBeat`, `StoryDraftSnapshot`, `SessionBeat`, and `Story.current_published_version_id`.
- Produces: nullable `StorySession.story_version_id` and `StorySession.draft_snapshot_id`, with a database check that exactly one is present for newly created sessions.
- Consumes: existing `Story`, `StoryCharacter`, `StorySession`, `CharacterRevision`, and `SessionCharacter` rows.

- [ ] **Step 1: Write failing migration tests**

Add tests that migrate a pre-13 database and assert:

```python
assert version == ("20260927_13",)
assert published == (
    "legacy-story:v1", "legacy-story", 1, "published", "hybrid", 1
)
assert session_story_version == "legacy-story:v1"
assert migrated_cast == [("legacy-story:v1", "legacy-hero", revision_id)]
```

Also assert that the existing turn, protagonist snapshot, autosave, and session cast still load, and that a unique partial index rejects a second draft for the same story.

- [ ] **Step 2: Run migration tests and verify failure**

Run: `uv run --directory apps/api pytest tests/db/test_migrations.py -q`

Expected: FAIL because revision `20260927_13` and the version tables do not exist.

- [ ] **Step 3: Add SQLModel tables**

Define focused table classes. Store ordered string lists as canonical JSON text in SQLite, matching existing project conventions:

```python
class StoryVersion(SQLModel, table=True):
    __tablename__ = "story_versions"
    __table_args__ = (UniqueConstraint("story_id", "version_number"),)
    id: str = Field(default_factory=new_public_id, primary_key=True)
    story_id: str = Field(foreign_key="stories.id", index=True)
    version_number: int
    status: str = "draft"
    draft_revision: int = 1
    based_on_version_id: str | None = Field(default=None, foreign_key="story_versions.id")
    mode: str
    title: str
    slug: str
    short_description: str = ""
    premise: str = ""
    cover_material_id: str | None = Field(default=None, foreign_key="story_materials.id")
    genres: str = "[]"
    tone: str = "[]"
    setting: str = ""
    opening_situation: str = ""
    content_rating: str = "adult_18_plus"
    themes_allowed: str = "[]"
    themes_blocked: str = "[]"
    creative_goals: str = ""
    ending_policy: str = "open_ended"
    hero_policy: str = "choice"
    hero_allowed_sources: str = '["catalog", "draft"]'
    fixed_hero_revision_id: str | None = Field(default=None, foreign_key="character_revisions.id")
    recommended_provider_id: str = "ollama"
    recommended_model_id: str = "qwen3:14b-q4_K_M"
    narration_perspective: str = "second_person"
    prose_density: str = "balanced"
    choice_policy: str = "choices_and_free_input"
    min_choices: int = 2
    max_choices: int = 4
    allow_romance: bool = True
    allow_violence: bool = True
    allow_horror: bool = True
    allow_sexual_themes: bool = False
    desired_themes: str = ""
    forbidden_outcomes: str = ""
    rules_version: int = 1
    created_at: str = Field(default_factory=utc_timestamp)
    published_at: str | None = None
```

Add child tables with foreign keys and uniqueness for `(version_id, order_index)`. Add `StoryMaterial(sha256, mime_type, filename, creator, license, source, asset_path)`, `StoryDraftSnapshot(payload, sha256, source_draft_revision)`, and `SessionBeat(session_id, beat_id, status, completed_turn_id)`.

- [ ] **Step 4: Implement forward-only Alembic migration**

Create all tables and indexes, backfill one published version per existing story using deterministic ID `f"{story_id}:v1"`, copy `story_characters`, and backfill every existing session. Add compatibility columns without dropping existing story columns. Use `batch_alter_table` for SQLite foreign-key columns.

- [ ] **Step 5: Run migration and model tests**

Run: `uv run --directory apps/api pytest tests/db/test_migrations.py -q`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add apps/api/app/db/models.py apps/api/migrations/versions/20260927_13_story_versions.py apps/api/tests/db/test_migrations.py apps/api/tests/conftest.py
git commit -m "feat: persist versioned story definitions"
```

---

### Task 2: Define strict authoring contracts and aggregate serialization

**Files:**
- Create: `apps/api/app/modules/story_authoring/__init__.py`
- Create: `apps/api/app/modules/story_authoring/schemas.py`
- Create: `apps/api/app/modules/story_authoring/definition.py`
- Create: `apps/api/tests/story_authoring/test_definition.py`

**Interfaces:**
- Produces: `StoryDraft`, `StoryIdentitySection`, `StoryModeSection`, `StoryHeroSection`, `StoryCastSection`, `StoryRulesSection`, `StoryCanonSection`, `DraftDiagnostic`, `DraftValidationResult`.
- Produces: `load_story_draft(session, story_id) -> StoryDraft` and `canonical_snapshot(draft) -> tuple[str, str]` returning canonical JSON and SHA-256.
- Consumes: Task 1 tables and character revision records.

- [ ] **Step 1: Write failing strict-schema tests**

Cover discriminated beat conditions and rejection of unknown fields:

```python
condition = BeatCondition.model_validate({"kind": "after_beat", "beat_id": "reveal"})
assert condition.beat_id == "reveal"
with pytest.raises(ValidationError):
    StoryModeSection.model_validate({"mode": "hybrid", "raw_prompt": "ignore rules"})
```

Verify canonical snapshots have identical JSON/hash regardless of database row retrieval order.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `uv run --directory apps/api pytest tests/story_authoring/test_definition.py -q`

Expected: FAIL because the authoring package does not exist.

- [ ] **Step 3: Implement typed contracts**

Use `ConfigDict(extra="forbid", str_strip_whitespace=True)` everywhere. Define:

```python
class DraftDiagnostic(BaseModel):
    code: str
    severity: Literal["error", "warning"]
    step: Literal["identity", "mode", "hero", "cast", "rules", "canon", "review"]
    field: str
    item_id: str | None = None
    message: str

class AfterBeatCondition(BaseModel):
    kind: Literal["after_beat"]
    beat_id: str = Field(min_length=1, max_length=120)

BeatCondition = Annotated[
    AlwaysCondition | AfterTurnCountCondition | AfterBeatCondition,
    Field(discriminator="kind"),
]
```

Set explicit limits: names/slugs 120 characters, short description 500, long prose fields 6000, lists 24 entries, fact/beat collections 100 entries, choices `0..6`.

- [ ] **Step 4: Implement aggregate loading and canonical snapshotting**

Keep JSON parsing and normalization inside `definition.py`; callers receive typed objects. Sort facts/beats/cast by their explicit order before `model_dump_json`, use UTF-8 canonical separators, and hash the exact serialized bytes.

- [ ] **Step 5: Run focused tests**

Run: `uv run --directory apps/api pytest tests/story_authoring/test_definition.py -q`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add apps/api/app/modules/story_authoring apps/api/tests/story_authoring/test_definition.py
git commit -m "feat: define story authoring aggregate"
```

---

### Task 3: Implement deterministic lint and draft lifecycle

**Files:**
- Create: `apps/api/app/modules/story_authoring/lint.py`
- Create: `apps/api/app/modules/story_authoring/repository.py`
- Create: `apps/api/app/modules/story_authoring/service.py`
- Create: `apps/api/tests/story_authoring/test_lint.py`
- Create: `apps/api/tests/story_authoring/test_drafts.py`

**Interfaces:**
- Produces: `validate_draft(draft, available_models) -> DraftValidationResult`.
- Produces: `create_story_draft`, `replace_draft_section`, `publish_draft`, `create_draft_from_version`, and domain errors `DraftConflictError`, `DraftInvalidError`, `ModeChangeConflictError`.
- Consumes: typed aggregate from Task 2.

- [ ] **Step 1: Write table-driven lint tests**

Parameterize every required code from the specification, including:

```python
@pytest.mark.parametrize("mutation, code", [
    (lambda draft: setattr(draft.identity, "title", ""), "identity_title_required"),
    (make_underage_cast, "cast_character_underage"),
    (make_theme_overlap, "theme_overlap"),
    (make_forward_beat_dependency, "beat_dependency_not_prior"),
    (make_beat_cycle, "beat_dependency_cycle"),
])
def test_lint_reports_stable_code(valid_hybrid_draft, mutation, code):
    mutation(valid_hybrid_draft)
    assert code in {item.code for item in validate_draft(valid_hybrid_draft, ["local:model"]).diagnostics}
```

- [ ] **Step 2: Write failing lifecycle tests**

Assert create defaults, idempotent section replacement, stale revision `409` semantics at the service boundary, explicit confirmation for destructive mode changes, immutable publication, version cloning, and rollback on failed publication.

- [ ] **Step 3: Run tests and verify failure**

Run: `uv run --directory apps/api pytest tests/story_authoring/test_lint.py tests/story_authoring/test_drafts.py -q`

Expected: FAIL because lint and lifecycle services do not exist.

- [ ] **Step 4: Implement lint as a pure module**

Return all diagnostics in stable step/field/item order. Use an iterative dependency walk for beat cycles. Do not query the database from `lint.py`; the fully resolved aggregate contains required ages/revision ownership.

- [ ] **Step 5: Implement transactional lifecycle operations**

`replace_draft_section` compares `expected_revision`, validates the section, replaces its owned child rows, increments once, and commits once. `publish_draft` reruns full lint inside the transaction, rejects errors, freezes status/timestamp, and updates `Story.current_published_version_id`. `create_draft_from_version` deep-copies child rows with new IDs and `based_on_*` provenance.

- [ ] **Step 6: Run focused tests**

Run: `uv run --directory apps/api pytest tests/story_authoring/test_lint.py tests/story_authoring/test_drafts.py -q`

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add apps/api/app/modules/story_authoring apps/api/tests/story_authoring
git commit -m "feat: validate and publish story drafts"
```

---

### Task 4: Expose the authoring API and frozen test sessions

**Files:**
- Create: `apps/api/app/modules/story_authoring/router.py`
- Modify: `apps/api/app/main.py`
- Modify: `apps/api/app/core/errors.py`
- Create: `apps/api/tests/story_authoring/test_api.py`
- Modify: `apps/api/tests/stories/test_stories.py`

**Interfaces:**
- Produces the `/api/author/stories` endpoints from the specification.
- Produces: `POST /api/author/stories/{story_id}/test-sessions` returning existing `SessionDetail`.
- Consumes: lifecycle services from Task 3 and existing provider registry/session creation policy.

- [ ] **Step 1: Write failing contract tests for every endpoint**

Exercise successful create/get/save/cover-upload/validate/publish/clone flows plus exact error codes. Cover tests accept PNG/JPEG/WebP, reject other MIME types and oversized files, verify SHA-256/provenance, and ensure author text cannot set an asset path. Also verify exact error codes:

```python
assert stale.status_code == 409
assert stale.json()["code"] == "draft_conflict"
assert invalid.status_code == 422
assert invalid.json()["code"] == "draft_invalid"
assert invalid.json()["diagnostics"][0]["field"] == "identity.title"
```

Test that extra request fields return 422 and failed publish does not move the current published pointer.

- [ ] **Step 2: Write a failing frozen-test-session test**

Create a valid draft, start an author test, save a different premise, then fetch the session and assert it still uses the snapshot premise/hash from test creation.

- [ ] **Step 3: Run API tests and verify failure**

Run: `uv run --directory apps/api pytest tests/story_authoring/test_api.py tests/stories/test_stories.py -q`

Expected: FAIL with 404 for the author routes.

- [ ] **Step 4: Implement the router and structured errors**

Register the router in `create_app`, add `DELETE` to CORS only if an implemented route needs it, map domain errors to Russian `ApiError` responses, and include structured diagnostics in a dedicated `DraftInvalidResponse` rather than embedding JSON in `detail`.

- [ ] **Step 5: Implement draft snapshots and author session creation**

Require publication-level validation, persist canonical payload/hash, create `StorySession(kind="author", draft_snapshot_id=snapshot.id)`, and snapshot protagonist/cast through the existing session snapshot functions. Do not create/update player autosaves.

- [ ] **Step 6: Run focused and OpenAPI tests**

Run: `uv run --directory apps/api pytest tests/story_authoring/test_api.py tests/stories/test_stories.py tests/test_api.py -q`

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add apps/api/app/main.py apps/api/app/core/errors.py apps/api/app/modules/story_authoring apps/api/tests/story_authoring apps/api/tests/stories/test_stories.py apps/api/tests/test_api.py
git commit -m "feat: expose story authoring API"
```

---

### Task 5: Pin player sessions to published versions and centralize runtime definitions

**Files:**
- Create: `apps/api/app/modules/story_authoring/runtime.py`
- Modify: `apps/api/app/modules/stories/repository.py`
- Modify: `apps/api/app/modules/stories/protagonist.py`
- Modify: `apps/api/app/modules/stories/service.py`
- Modify: `apps/api/app/modules/stories/schemas.py`
- Modify: `apps/api/tests/stories/test_stories.py`
- Modify: `apps/api/tests/stories/test_protagonist.py`

**Interfaces:**
- Produces: `RuntimeStoryDefinition` and `load_runtime_story_definition(session, game) -> RuntimeStoryDefinition`.
- Changes: `start_story_session` resolves `Story.current_published_version_id`, pins it, and snapshots version cast/hero policy.
- Changes: `StorySummary` adds `current_published_version_id` and returns canonical mode values.

- [ ] **Step 1: Write failing version-pinning tests**

Start a player session on version 1, publish version 2, and assert the old session still returns the v1 title/premise/cast while a new session uses v2. Assert a story without a published version returns `422 story_not_published`.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `uv run --directory apps/api pytest tests/stories/test_stories.py tests/stories/test_protagonist.py -q`

Expected: FAIL because sessions still read mutable `Story`/`StoryCharacter` rows.

- [ ] **Step 3: Implement the deep runtime loader**

Resolve either a published version or draft snapshot behind one function. Return plain typed data for story identity, mode, generation policy, facts, beats, hero policy, and pinned cast. Keep database/JSON parsing private to this module.

- [ ] **Step 4: Move session startup and reads to the loader**

Pin `story_version_id` before snapshotting hero/cast. Keep existing API shapes compatible while adding version identity. Remove direct runtime reads of mutable `StoryCharacter` from session creation.

- [ ] **Step 5: Run focused tests**

Run: `uv run --directory apps/api pytest tests/stories -q`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add apps/api/app/modules/story_authoring/runtime.py apps/api/app/modules/stories apps/api/tests/stories
git commit -m "feat: pin sessions to story versions"
```

---

### Task 6: Enforce freeform and hybrid rules in the story engine

**Files:**
- Modify: `apps/api/app/modules/providers/contracts.py`
- Modify: `apps/api/app/modules/story_engine/contracts.py`
- Modify: `apps/api/app/modules/story_engine/prompt.py`
- Modify: `apps/api/app/modules/story_engine/rules.py`
- Modify: `apps/api/app/modules/story_engine/repository.py`
- Modify: `apps/api/tests/story_engine/test_turns.py`
- Create: `apps/api/tests/story_engine/test_story_modes.py`

**Interfaces:**
- Changes `TurnProposal` to include `canon_assessments: list[CanonAssessment]`, `completed_beat_ids: list[str] = []`, and `requests_ending: bool = False`; `CanonAssessment` contains `fact_id`, `status: Literal["upheld", "violated"]`, and `evidence`.
- Changes `GenerationContext.story` from an unstructured dictionary to `RuntimeStoryDefinition`.
- Produces deterministic beat availability/completion validation and atomic `SessionBeat` writes.

- [ ] **Step 1: Write failing prompt tests**

Assert freeform prompts contain creative goals but no invented beat section. Assert hybrid prompts include hard facts, soft facts, available beats, completion evidence, and an instruction that IDs are recommendations subject to validation. Assert raw author text never occupies a system-role field.

- [ ] **Step 2: Write failing rules and atomicity tests**

Cover missing/duplicate/unknown hard-fact assessments, an assessment marked `violated`, unknown beat, locked beat, duplicate completion, early ending, valid completion, repair, and no mutation after two invalid proposals. Do not claim that the server can independently infer semantic contradiction from unrestricted prose; it deterministically enforces complete structured assessments and their reported status.

- [ ] **Step 3: Run story-engine tests and verify failure**

Run: `uv run --directory apps/api pytest tests/story_engine/test_story_modes.py tests/story_engine/test_turns.py -q`

Expected: FAIL because mode-specific contracts are absent.

- [ ] **Step 4: Implement provider-neutral prompt composition**

Increment `PROMPT_VERSION` to `v2`. Serialize `RuntimeStoryDefinition` as delimited JSON user context, keep immutable safety/response rules in the system instruction, and include only currently available stable IDs.

- [ ] **Step 5: Implement deterministic proposal validation**

Require exactly one assessment for every active hard fact, reject unknown IDs and every `violated` status, validate beat availability, and enforce the ending gate. Persist completed beats in the same transaction as the accepted turn and recompute newly available beats on the next context load.

- [ ] **Step 6: Run all story-engine tests**

Run: `uv run --directory apps/api pytest tests/story_engine -q`

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add apps/api/app/modules/providers/contracts.py apps/api/app/modules/story_engine apps/api/tests/story_engine
git commit -m "feat: enforce authored story modes"
```

---

### Task 7: Add browser contracts, API client, routes, and test server support

**Files:**
- Modify: `apps/web/src/shared/api/contracts.ts`
- Modify: `apps/web/src/shared/api/client.ts`
- Modify: `apps/web/src/shared/config/routes.ts`
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/test/api-server.ts`
- Create: `apps/web/src/pages/story-editor/index.ts`
- Create: `apps/web/src/pages/story-editor/ui/StoryEditorRoute.tsx`
- Create: `apps/web/src/pages/story-editor/ui/StoryEditorRoute.test.tsx`

**Interfaces:**
- Produces TypeScript equivalents of Task 2 DTOs.
- Produces `api.createStoryDraft`, `getStoryDraft`, `saveStoryDraftSection`, `uploadStoryCover`, `validateStoryDraft`, `startDraftTest`, `publishStoryDraft`, and `createDraftFromVersion`.
- Produces routes `/studio/stories/new` and `/studio/stories/:storyId/edit`.

- [ ] **Step 1: Write failing route and client tests**

Assert that new/edit URLs render the editor route, request the right draft endpoint, and preserve `DraftInvalidResponse.diagnostics`. Add mock-server request capture for `expected_revision`.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm --prefix apps/web test -- StoryEditorRoute.test.tsx`

Expected: FAIL because route, types, and methods do not exist.

- [ ] **Step 3: Add strict frontend contracts and client methods**

Use discriminated unions matching Pydantic exactly. Keep section request types separate so a component cannot send fields owned by another step.

- [ ] **Step 4: Register routes and extend the test server**

The route component creates a draft on `/new`, replaces history with the stable edit URL, and loads an existing draft by ID. Mock endpoints must emulate revision increments and `409 draft_conflict`.

- [ ] **Step 5: Run tests and typecheck**

Run: `npm --prefix apps/web test -- StoryEditorRoute.test.tsx && npm --prefix apps/web run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/src/shared apps/web/src/app/router.tsx apps/web/src/test/api-server.ts apps/web/src/pages/story-editor
git commit -m "feat: add story editor client boundary"
```

---

### Task 8: Build the guided editor for identity, mode, hero, and cast

**Files:**
- Create: `apps/web/src/features/edit-story/model/useStoryDraft.ts`
- Create: `apps/web/src/features/edit-story/ui/StoryEditorShell.tsx`
- Create: `apps/web/src/features/edit-story/ui/IdentityStep.tsx`
- Create: `apps/web/src/features/edit-story/ui/ModeStep.tsx`
- Create: `apps/web/src/features/edit-story/ui/HeroStep.tsx`
- Create: `apps/web/src/features/edit-story/ui/CastStep.tsx`
- Create: `apps/web/src/features/edit-story/index.ts`
- Create: `apps/web/src/features/edit-story/ui/StoryBasics.test.tsx`
- Modify: `apps/web/src/pages/story-editor/ui/StoryEditorRoute.tsx`
- Modify: `apps/web/src/pages/studio/ui/StudioPage.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Produces `useStoryDraft(storyId)` with `draft`, `phase`, `dirtyStep`, `saveSection`, `reloadAfterConflict`, and `diagnosticsFor(step)`.
- Consumes authoring client from Task 7 and existing catalog character APIs.

- [ ] **Step 1: Write failing interaction tests**

Cover creating from Studio, identity save, cover upload with provenance, persistent step navigation, freeform/hybrid explanation, hero policy, adding an exact character revision, removal, fixed-hero exclusion from NPC cast, unsaved-leave warning, loading/error states, and Russian recovery text.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm --prefix apps/web test -- StoryBasics.test.tsx StudioPage.test.tsx`

Expected: FAIL because the editor UI is absent.

- [ ] **Step 3: Implement one state hook with section ownership**

The hook keeps the server draft as the source of truth, a local copy only for the active step, and sends one idempotent complete-section write. On conflict it preserves the local copy and exposes `reloadAfterConflict`; it never auto-merges author prose.

- [ ] **Step 4: Implement accessible wizard shell and first four steps**

Use semantic form controls, labelled errors, keyboard-focusable step navigation, and existing shadcn components. Add `Создать новеллу` to Studio. Show revision pin and age for every cast member.

- [ ] **Step 5: Run tests, FSD lint, and typecheck**

Run: `npm --prefix apps/web test -- StoryBasics.test.tsx StudioPage.test.tsx && npm --prefix apps/web run lint:fsd && npm --prefix apps/web run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/src/features/edit-story apps/web/src/pages/story-editor apps/web/src/pages/studio apps/web/src/styles.css
git commit -m "feat: build story authoring wizard foundation"
```

---

### Task 9: Add generation rules, canon/beat editing, review, testing, and publication

**Files:**
- Create: `apps/web/src/features/edit-story/ui/RulesStep.tsx`
- Create: `apps/web/src/features/edit-story/ui/CanonStep.tsx`
- Create: `apps/web/src/features/edit-story/ui/ReviewStep.tsx`
- Create: `apps/web/src/features/edit-story/ui/StoryRules.test.tsx`
- Create: `apps/web/src/features/edit-story/ui/StoryPublication.test.tsx`
- Modify: `apps/web/src/features/edit-story/ui/StoryEditorShell.tsx`
- Modify: `apps/web/src/pages/studio/ui/StudioPage.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes remaining section DTOs and publish/test client methods.
- Produces reorderable fact/beat editors, diagnostic navigation, draft test launch, publication, and `Создать новую редакцию`.

- [ ] **Step 1: Write failing rules/canon tests**

Cover choice-policy count constraints, explicit content switches, allowed/blocked theme collision, freeform creative goals, hybrid facts, ordered beat conditions, keyboard reorder controls, and confirmation before destructive mode switching.

- [ ] **Step 2: Write failing review/publication tests**

Assert diagnostics focus their exact field, errors disable publish, warnings do not, test-session success navigates to `/studio/:sessionId`, publication updates the status, conflict retains local text, and unavailable Ollama blocks only testing rather than saving/publication.

- [ ] **Step 3: Run focused tests and verify failure**

Run: `npm --prefix apps/web test -- StoryRules.test.tsx StoryPublication.test.tsx`

Expected: FAIL because final steps do not exist.

- [ ] **Step 4: Implement rules and mode-specific authoring**

Use explicit add/remove/reorder controls; never infer list order from DOM position alone. For `after_beat`, offer only prior beat IDs. Clearing incompatible fields requires a dialog whose confirm action sends the mode section with `confirm_clear_incompatible=true`.

- [ ] **Step 5: Implement review and publication flow**

Render a readable complete summary, group diagnostics by step, focus by stable `field`/`item_id`, call server validation before test/publish, and expose a revision-clone action for published stories.

- [ ] **Step 6: Run all web unit checks**

Run: `npm --prefix apps/web test && npm --prefix apps/web run lint:fsd && npm --prefix apps/web run typecheck && npm --prefix apps/web run build`

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add apps/web/src/features/edit-story apps/web/src/pages/studio apps/web/src/styles.css
git commit -m "feat: complete story authoring and publication"
```

---

### Task 10: Verify end-to-end behavior and update the roadmap

**Files:**
- Create: `apps/web/e2e/story-authoring.spec.ts`
- Modify: `apps/web/e2e/story-flow.spec.ts`
- Modify: `docs/roadmap.md`
- Modify: `README.md`

**Interfaces:**
- Verifies the complete user-visible contract from the specification.
- Documents stage 3 as complete only after both mode scenarios pass.

- [ ] **Step 1: Write the freeform E2E scenario**

Create a story, fill identity/mode/hero/rules, publish, start a player session, submit one action, and assert the returned scene belongs to the new story and uses the pinned version ID.

- [ ] **Step 2: Write the hybrid/version-pinning E2E scenario**

Create a hard fact and required ending-gate beat, start an author test, publish version 1, create/edit version 2, and assert the original session still reports version 1. Use the fake provider to first propose an early ending and assert the server repair path preserves atomicity.

- [ ] **Step 3: Run E2E tests and fix only observed failures**

Run: `npm run test:e2e -- story-authoring.spec.ts story-flow.spec.ts`

Expected: PASS.

- [ ] **Step 4: Update roadmap and README**

Set stage 2 consistently to `done`; set stage 3 to `done` only if every acceptance criterion passes. Record that stage 10 still owns the visual graph and that stage 4 manual saves/timeline remains next. Document the Studio authoring entry and local start commands.

- [ ] **Step 5: Run the complete verification suite**

Run:

```powershell
npm run check
npm run test:e2e
git diff --check
```

Expected: lint, typecheck,  all API/web unit tests, production build, all E2E tests, and whitespace check pass.

- [ ] **Step 6: Browser smoke test**

At desktop and 390px mobile widths, verify Studio list, every wizard step, conflict/error recovery, freeform publication, hybrid publication, draft testing, and player launch. Save screenshots under `output/playwright/`; do not commit them.

- [ ] **Step 7: Commit**

```powershell
git add apps/web/e2e/story-authoring.spec.ts apps/web/e2e/story-flow.spec.ts docs/roadmap.md README.md
git commit -m "test: verify freeform and hybrid story authoring"
```
