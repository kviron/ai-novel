# Task 5 report — pinned runtime story definitions

## Outcome

- Added `RuntimeStoryDefinition` and `load_runtime_story_definition(session, game)` as the single boundary for both published player versions and frozen author snapshots.
- Player sessions now pin `Story.current_published_version_id` before hero/cast snapshotting and read identity, opening scene, mode, policy, and cast from that pinned source.
- Author test sessions now use the same runtime loader and protagonist resolver; the duplicate snapshot JSON and hero-policy implementation was removed.
- Player catalog queries hide stories without a published version, and starting one returns structured `422 story_not_published` without inserting a session.
- `StorySummary` exposes `current_published_version_id` and canonical `freeform` / `hybrid` mode values.
- Legacy mutable `StoryCharacter` rows are no longer a runtime source.

## TDD evidence

RED command:

`uv run --directory apps/api pytest tests/stories/test_stories.py tests/stories/test_protagonist.py -q`

Observed three expected failures: missing version identity, old sessions reading the mutable story projection, and unpublished start reaching the database check constraint instead of returning a domain error.

GREEN commands:

- `uv run --directory apps/api pytest tests/stories/test_stories.py tests/stories/test_protagonist.py -q` — 31 passed.
- `uv run --directory apps/api pytest tests/stories tests/story_authoring -q` — 124 passed.
- `uv run --directory apps/api ruff check app/modules/story_authoring/runtime.py app/modules/story_authoring/sessions.py app/modules/stories/protagonist.py app/modules/stories/repository.py app/modules/stories/router.py app/modules/stories/service.py tests/stories/test_stories.py tests/stories/test_protagonist.py` — passed.

## Broader-suite concern

The complete API suite still contains legacy character/archive tests that add or mutate `StoryCharacter` after publication and expect those mutable rows to appear in player sessions. The first observed failure is `tests/characters/test_character_archives.py::test_avatar_creates_revision_without_moving_story_or_session_pin`. That expectation conflicts with the approved immutable published-version contract: catalog changes must flow through a new draft and publication. Those tests and legacy story-character editing endpoints need migration in a later compatibility task; Task 5 intentionally does not reintroduce mutable runtime reads.

## Preservation note

Pre-existing sprite/player UI work and concurrent story-engine work were left untouched and are not included in the Task 5 commit. Pre-existing sprite hunks in `stories/schemas.py`, `stories/service.py`, and `test_protagonist.py` remain in the working tree and are excluded from staging.

## Fix round 1

Review identified two truthful-boundary gaps.

1. Legacy cast attach/batch/update/delete endpoints returned success for versioned stories even though runtime ignored `StoryCharacter`. All four now return structured `409 story_versioned` before mutation. Truly pre-version stories without any `StoryVersion` retain their legacy behavior. Regression tests assert the response code and unchanged rows; obsolete character tests now either assert this contract or publish cast changes through a cloned draft.
2. Runtime covers no longer read mutable `Story.cover_image_url` when a version/snapshot pins `identity.cover_material_id`. The loader validates the immutable `StoryMaterial`, exposes `/api/story-materials/{id}`, and the retrieval route serves its content-addressed blob with immutable caching. A regression covers an author snapshot, published v1, published v2, and a later mutation of the legacy story projection.

The three fixed-hero story-engine fixtures now modify the pinned `StoryVersion` policy rather than the unused story projection. The newly-added-character engine test and affected archive/catalog tests now use draft cloning and publication.

Verification after the fix:

- Focused authoring/stories/characters/story-engine selection: 133 passed.
- Complete API suite: 262 passed, 17 existing dependency/migration warnings.
- Ruff on every touched production and test file: passed.

## Fix round 2

The remaining mutable-cover fallback was removed completely. A pinned version or author snapshot whose
`identity.cover_material_id` is null now exposes no runtime cover instead of consulting
`Story.cover_image_url`. The migrated built-in Akane v1 expectation was updated accordingly because that
version predates immutable `StoryMaterial` ownership. A regression creates both author and player pins,
mutates the legacy story projection, and proves both remain unchanged at null.

The retained legacy path now has an explicit invariant regression: a genuinely pre-version story can still
attach through `StoryCharacter`, but deleting its sole cast member returns `409 conflict` and preserves the
row. This distinguishes truthful legacy compatibility from the versioned-story deprecation response.

Verification after fix round 2:

- Focused null-cover and legacy last-cast regressions: 2 passed.
- Complete API suite: 264 passed, 17 existing dependency/migration warnings.
- Ruff check and format check on all round-2 production and test files: passed.
