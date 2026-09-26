# Freeform and Hybrid Story Builder — Design

**Status:** approved for implementation

**Date:** 2026-09-27

**Roadmap:** stage 3, with graph editing explicitly deferred to stage 10

## Goal

Give a local author a guided way to create, validate, publish, test, and revise an AI visual novel without editing database rows or source files. The first release supports two explicit modes:

- `freeform`: the model develops the story inside authored thematic and safety boundaries;
- `hybrid`: the model may improvise, but must preserve authored canon and advance required story beats.

Publishing creates an immutable version. A game session pins that version, its protagonist policy, cast revisions, and generation rules so later author edits cannot change an existing playthrough.

## Research translated into decisions

The design borrows concepts, not file formats or runtimes:

- Ren'Py uses stable labels for control-flow destinations, explicit menu choices, initialized mutable variables, lint, and save/rollback boundaries. Stable IDs and version-pinned saves are therefore mandatory here. See [Labels & Control Flow](https://www.renpy.org/doc/html/label.html), [Saving, Loading, and Rollback](https://www.renpy.org/doc/html/save_load_rollback.html), and [Developer Tools](https://www.renpy.org/doc/html/developer_tools.html).
- Ink separates larger knots from smaller stitches and combines choices, conditions, variables, diverts, and rejoining flow. Our required beats use stable IDs and declarative conditions, but the first release does not expose an arbitrary graph or scripting language. See [Writing with Ink](https://github.com/inkle/inky/blob/master/app/resources/Documentation/WritingWithInk.md).
- Yarn Spinner separates nodes, lines, options, and engine-facing commands. Its runtime/presentation boundary motivates keeping authored narrative rules separate from visual directives and provider prompts. See [Nodes, Lines, and Options](https://docs.yarnspinner.dev/2.5/getting-started/writing-in-yarn/lines-nodes-and-options) and [Dialogue Runner](https://yarnspinner.dev/docs/godot/06-components/01-dialogue-runner/).
- Twine makes passage links visible and updates ordinary links when a passage is renamed. This supports stable internal IDs with editable display names. A visual story map is reserved for roadmap stage 10. See [Linking Passages](https://twinery.org/reference/en/editing-stories/linking-passages.html).

The product remains an AI-first visual novel platform. It does not import Ren'Py, Ink, Yarn, or Twine scripts in this slice.

## Scope

### Included

- creation of a local story draft;
- guided editing of identity, mode, themes, setting, protagonist policy, cast, generation boundaries, opening state, and ending policy;
- hybrid-only canon facts and ordered required beats;
- freeform-only creative goals;
- draft validation with stable diagnostic codes and field locations;
- preview and author test session from the current draft;
- immutable publication and later creation of a new draft from a published version;
- session pinning to one published version;
- prompt construction and server-side proposal checks driven by the pinned rules;
- migration of the existing seeded story into version 1 without invalidating current sessions.

### Explicitly excluded

- a visual node graph, arbitrary jumps, scripting language, loops, functions, or authored dialogue trees;
- collaborative or cloud editing, permissions, and remote publishing;
- runtime editing of a published version;
- importing other engines' project formats;
- CG generation, ComfyUI jobs, LoRA training, and provider-key management;
- automatic rewriting of author text by an LLM.

## Design principles

1. **One deep story-definition boundary.** The rest of the application asks for a validated `StoryVersion`; it does not assemble canon, protagonist policy, and prompt fragments independently.
2. **Drafts are mutable; published versions are immutable.** Starting a session requires a published version. Author tests may use a frozen draft snapshot so edits during a test do not mutate that session.
3. **IDs are permanent; labels are editable.** Story, version, fact, beat, and rule IDs never derive from display text.
4. **Rules are data, not executable author code.** Conditions use a small typed vocabulary owned by the server. No Python, JavaScript, template evaluation, or raw provider prompt is accepted.
5. **The server is authoritative.** The model proposes narrative output; deterministic validation rejects violations before persistence.
6. **Progressive disclosure.** The wizard starts with useful defaults and reveals hybrid-only constraints only when that mode is selected.

## Domain model

### Story identity

`Story` remains the stable catalog identity and owns `current_published_version_id`. Catalog fields needed for listing may be denormalized from the current published version, but a session never depends on those mutable projections.

### Story versions

Add `StoryVersion` with:

- `id`: UUID;
- `story_id`: stable story UUID;
- `version_number`: monotonically increasing per story;
- `status`: `draft` or `published`;
- `draft_revision`: monotonically increasing optimistic-concurrency token, frozen at publication;
- `based_on_version_id`: nullable provenance link;
- `mode`: `freeform` or `hybrid`;
- `title`, `slug`, `short_description`, `premise`, and nullable `cover_material_id`;
- `genres`: ordered normalized string list;
- `tone`: ordered normalized string list;
- `setting` and `opening_situation`;
- `content_rating`: initially `adult_18_plus` because the application requires adult characters;
- `themes_allowed` and `themes_blocked`;
- `creative_goals`: freeform-mode author guidance;
- `ending_policy`: `open_ended`, `model_may_end`, or `required_beats_then_end`;
- `hero_policy`, `hero_allowed_sources`, and optional `fixed_hero_revision_id`;
- `recommended_provider_id` and `recommended_model_id`;
- `rules_version`: initially `1`;
- `created_at` and nullable `published_at`.

The database enforces one mutable draft per story and unique `(story_id, version_number)`. Publishing is an atomic operation that validates the draft, changes it to `published`, and updates the story's current pointer. Editing a published version creates a new draft copy with new child IDs and provenance links to the copied items.

`StoryMaterial` stores the cover's SHA-256, MIME type, filename, creator, license, source, and immutable local asset location. Cover upload accepts PNG, JPEG, or WebP through a dedicated endpoint and returns a material ID; author input never sets a filesystem path or arbitrary URL. Cloned versions may reference the same immutable material.

### Draft test snapshots

`StoryDraftSnapshot` is an immutable, canonical JSON serialization of the fully resolved draft aggregate plus its SHA-256 hash and source `draft_revision`. It is created only after the draft passes publication-level validation. An author test session pins the snapshot ID; later draft saves cannot alter the test. Snapshots are internal runtime artifacts rather than catalog versions and cannot be started from the player library.

### Cast

`StoryVersionCharacter` pins `character_id`, `revision_id`, `role`, display color, and whether the character may be selected as protagonist. The existing mutable `StoryCharacter` relation becomes a compatibility projection during migration and is no longer the runtime source of truth.

### Canon facts

Hybrid versions contain ordered `CanonFact` records:

- stable ID;
- short author-facing title;
- canonical statement;
- severity: `hard` or `soft`;
- scope: `world`, `character`, `relationship`, or `plot`;
- optional referenced character IDs.

Hard facts are included in validation context and cannot be contradicted. Soft facts guide generation but do not by themselves reject a turn. Freeform versions cannot contain hard plot facts; shared setting and character constraints belong in the ordinary version fields and pinned character revisions.

### Required beats

Hybrid versions may contain an ordered list of `StoryBeat` records:

- stable ID and editable title;
- author description of the event;
- `order_index`;
- activation condition;
- completion evidence description;
- `required` flag;
- `ending_gate` flag.

The first condition vocabulary is deliberately small:

- `always`;
- `after_turn_count` with a non-negative integer;
- `after_beat` with another beat ID.

Conditions are combined only as a single selected condition in this slice. Boolean expression trees, arbitrary variables, optional branches, and graph edges belong to stage 10.

Runtime state stores beat status as `locked`, `available`, or `completed`. The model may recommend `completed_beat_ids` in a turn proposal, but the server accepts only currently available IDs and records completion atomically with the turn. Required beats cannot be silently skipped. `required_beats_then_end` permits an ending only after every required ending gate is complete.

### Generation policy

`GenerationPolicy` is part of `StoryVersion`, not a provider-specific prompt. It contains:

- narration perspective: `first_person`, `second_person`, or `third_person`;
- prose density: `concise`, `balanced`, or `detailed`;
- choice policy: `choices_and_free_input`, `choices_only`, or `free_input_only`;
- minimum and maximum suggested choices, constrained to `0..6` and consistent with choice policy;
- whether romance, violence, horror, and sexual themes are allowed, each as an explicit boolean;
- author notes for desired themes and forbidden outcomes, each length-limited plain text.

The prompt builder translates this provider-neutral policy into provider instructions. Authors cannot edit the system prompt.

## Author workflow and UI

The Studio entry gains `Создать новеллу`. Story authoring uses `/studio/stories/new` and `/studio/stories/:storyId/edit` with a persistent step navigation:

1. **Основа:** title, slug, short description, premise, cover, genres, tone, setting, and opening situation.
2. **Режим:** freeform or hybrid, with a plain-language explanation of their guarantees.
3. **Герой:** fixed, selected from catalog, or created by the player; allowed sources and playable cast.
4. **Персонажи:** add catalog revisions, assign roles/colors, and prevent the fixed protagonist from also being an AI-controlled NPC.
5. **Правила:** generation policy, allowed themes, blocked themes, and ending policy.
6. **Канон:** hybrid facts and ordered beats, or freeform creative goals. The inactive mode's incompatible fields are cleared only after explicit confirmation when changing modes.
7. **Проверка:** readable summary, diagnostics, test launch, and publish action.

Every step saves the complete section through an idempotent endpoint and returns the new draft revision counter. Navigation is allowed with incomplete data; publishing is not. Unsaved edits are signalled before leaving the page.

Diagnostics identify a stable code, severity, wizard step, and field/item ID. Selecting a diagnostic focuses the exact control. Warnings permit publication; errors do not.

## Validation

Validation runs on every section save and again transactionally at publication. Required error checks include:

- missing identity, premise, setting, or opening situation;
- duplicate slug;
- no protagonist source;
- fixed protagonist without a pinned revision;
- protagonist also configured as an AI-controlled cast member;
- missing or invalid character revisions;
- any referenced character younger than 18;
- hybrid mode without at least one hard canon fact or required beat;
- freeform mode with hybrid-only facts or beats;
- duplicate fact/beat IDs or beat order values;
- `after_beat` reference to a missing or later beat;
- cycle in beat dependencies;
- `required_beats_then_end` without a required ending gate;
- choice counts incompatible with choice policy;
- allowed and blocked theme overlap;
- unsupported provider/model identifiers.

Warnings include an empty cover, no optional cast, no soft guidance, and a recommended model that is currently unavailable. Availability is not a publication error because local installations may change.

## API boundary

Add an author-only local API namespace; “author-only” describes purpose, not authentication in this local release:

- `POST /api/author/stories` creates story identity plus draft;
- `GET /api/author/stories/{story_id}/draft` returns the complete editable draft and diagnostics;
- `POST /api/author/stories/{story_id}/draft/cover` validates and stores an immutable cover material;
- `PUT /api/author/stories/{story_id}/draft/{section}` replaces one typed section using `expected_revision`;
- `POST /api/author/stories/{story_id}/validate` returns diagnostics without mutation;
- `POST /api/author/stories/{story_id}/test-sessions` freezes the draft as a test snapshot and starts an author session;
- `POST /api/author/stories/{story_id}/publish` validates and atomically publishes;
- `POST /api/author/stories/{story_id}/draft-from/{version_id}` creates the next draft;
- `GET /api/stories/{story_id}/versions/{version_id}` returns a published read model.

Section writes use optimistic concurrency. A stale `expected_revision` returns `409 draft_conflict` with the latest revision; the client keeps local values and offers reload rather than overwriting silently.

## Runtime and prompt integration

`StorySession` gains `story_version_id` and optional `draft_snapshot_id` for author tests. Normal player sessions require a published `story_version_id`. Existing session character and protagonist snapshots remain, providing an additional stable audit trail.

The story engine receives one `RuntimeStoryDefinition` assembled server-side from the pinned version. It exposes only:

- mode and opening context;
- protagonist snapshot and NPC revision snapshots;
- generation policy;
- hard and soft canon facts;
- available/completed required beats;
- allowed stable visual-state IDs;
- recent active-branch history.

Freeform mode asks the model to advance coherently inside the creative policy without inventing a hidden authored graph. Hybrid mode additionally requires preservation of hard facts and controlled beat advancement. Provider output adds `canon_assessments` for every active hard fact, optional `completed_beat_ids`, and `requests_ending`; none is trusted until server validation. Each assessment contains the stable fact ID, `upheld` or `violated`, and short evidence tied to the proposed scene.

The server deterministically rejects missing/duplicate hard-fact assessments, any assessment marked `violated`, unknown beat IDs, unavailable beat completion, endings before an ending gate, protagonist speech/action violations, invalid cast IDs, and existing visual-contract violations. Semantic assessment of natural-language canon remains a model capability rather than something the server can prove from prose alone; the structural assessment and repair contract makes that limitation visible and testable. A rejected proposal follows the current single repair attempt and atomic no-mutation guarantee.

## Migration and compatibility

Create an Alembic migration that:

1. creates story version, version-cast, fact, beat, and draft-snapshot tables;
2. converts every existing `Story` row to published version 1;
3. copies existing story-character pins into version-character rows;
4. points every existing session to version 1;
5. preserves existing story IDs, session IDs, autosaves, and turns;
6. leaves compatibility columns in place for one release while all reads move to the version aggregate.

The seeded “Эхо неона” becomes hybrid version 1. Its existing premise, cast, hero policy, provider/model, and opening scene are preserved. Migration tests must prove that an existing session loads the same protagonist, cast revisions, current scene, and active turn after migration.

## Error and recovery model

- `404 story_not_found` or `version_not_found`: return to Studio list.
- `409 draft_conflict`: retain local values, show that another saved revision exists, and offer reload.
- `422 draft_invalid`: show structured diagnostics and focus the first error.
- `422 mode_change_conflict`: require confirmation before clearing incompatible mode-specific data.
- `503 model_unavailable`: allow saving/publishing but block test-session generation with the existing provider recovery UI.
- failed publication or failed session creation changes no persisted status or active pointer.

## Security and content rules

- All author text is untrusted plain text with server-side length limits.
- No field accepts HTML, executable expressions, filesystem paths, provider secrets, or raw prompt roles.
- Every character used by a published story must have an explicit age of at least 18.
- Content switches constrain prompts and validation; they are not inferred from prose.
- Export and diagnostics omit provider credentials and raw hidden prompts.

## Testing strategy

- Migration tests for existing stories and sessions.
- Domain tests for draft lifecycle, immutable publication, cloning, optimistic concurrency, and mode switching.
- Table-driven lint tests for every diagnostic code and beat dependency cycle.
- Contract tests for section DTOs and strict rejection of extra fields.
- Story-engine tests showing different freeform/hybrid prompts and deterministic rejection of canon/beat violations.
- React component tests for all wizard steps, autosave states, diagnostic focus, conflict recovery, and publication.
- Playwright scenarios:
  1. create and publish a freeform story, choose a hero, and start playing;
  2. create and publish a hybrid story with a hard fact and required ending beat, test it in Studio, and verify the pinned version survives a later edit.

## Acceptance criteria

The slice is complete when an author can create both modes entirely in the UI, attach pinned character revisions, receive precise validation, test a frozen draft, publish an immutable version, and start a player session from it. A hybrid proposal must explicitly assess every active hard fact; missing or reported violations are rejected, unavailable beats cannot be completed, and an ending cannot occur before its required ending gate. A freeform session remains bounded by its authored policy without pretending to follow a plot graph. Editing and republishing a story creates a new version while an older active session reproduces its original version.
