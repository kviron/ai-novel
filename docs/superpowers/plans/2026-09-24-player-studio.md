# Compact Player and Author Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver editable Figma screens and a compact React player plus working author Studio for the current “Эхо неона” story.

**Architecture:** Keep FastAPI session contracts unchanged. Move the existing turn state machine into `features/play-story` so player and Studio pages consume one implementation. Studio creates an ordinary new session and renders a read-only inspector of the same confirmed session state; it does not offer scene jumps or rewinds.

**Tech Stack:** React, TypeScript, React Router, Tailwind/shadcn primitives, Vitest/Testing Library, Playwright, FastAPI API, Figma MCP.

**Spec:** `docs/superpowers/specs/2026-09-24-player-studio-design.md`

## Global Constraints

- Preserve the active user session; create a separate test session.
- Use existing CSS tokens `--background`, `--card`, `--primary`, etc. and current button/input primitives.
- Player dialogue is 17–18 px desktop and 16 px mobile; general body 14–16 px.
- No auth/roles, scene jump, rewind, graph editor, prompt editor, or new API endpoint.
- Keep the backend authoritative for turns and state, and preserve idempotent `request_id` and `expected_state_version` behavior.

---

## File map

- Figma file `g8sdzZgjy7vRA6wq2x2kF6`: player desktop/mobile and Studio desktop frames; shared visual tokens.
- `apps/web/src/features/play-story/model/useStoryPlayer.ts`: existing session/turn state machine, moved intact.
- `apps/web/src/features/play-story/api/story-session.ts`: session API adapter, moved intact.
- `apps/web/src/features/play-story/ui/StoryScene.tsx`: shared scene, dialogue, choice and free-action controls.
- `apps/web/src/features/play-story/index.ts`: public API for both page slices.
- `apps/web/src/pages/story-player/ui/StoryPlayerPage.tsx`: compact player composition and mode link.
- `apps/web/src/pages/studio/ui/StudioPage.tsx`: catalog/new-test-session and current-session composition.
- `apps/web/src/pages/studio/ui/SessionInspector.tsx`: read-only confirmed session metadata.
- `apps/web/src/shared/config/routes.ts`, `apps/web/src/app/router.tsx`: routes.
- `apps/web/src/styles.css`: screen layout and token-aligned visual refinements.
- Existing player tests plus new Studio tests: interactions, errors, responsive smoke.

### Task 1: Figma design source of truth

**Files:** Figma file `g8sdzZgjy7vRA6wq2x2kF6`; design IDs recorded in this plan after creation.

**Interfaces:** Consumes the approved spec and current app screenshot/assets; produces player desktop/mobile and Studio desktop frames used by Task 3.

- [ ] **Step 1:** Load the Figma-use, generate-design, generate-library (if creating components), and design-to-code skill instructions. Read current file metadata, search any design system, inspect current UI and sprite.
- [ ] **Step 2:** Create palette/type/spacing foundations matching `apps/web/src/styles.css`, then the three editable frames with realistic “Эхо неона” copy, states, and shared component treatment. Preserve the user's existing blank page.
- [ ] **Step 3:** Inspect Figma screenshots and design context for each frame. Fix overflow, alignment, contrast, copy, and hierarchy in Figma; record frame IDs and links in the implementation report.

### Task 2: Shared turn logic and scene

**Files:** Move `apps/web/src/pages/story-player/model/story-player.ts` and `api/story-session.ts` to the feature slice; create `apps/web/src/features/play-story/ui/StoryScene.tsx` and `index.ts`; modify player page and its tests.

**Interfaces:** `useStoryPlayer(sessionId: string)` returns the existing state/actions; `StoryScene({ player }: { player: ReturnType<typeof useStoryPlayer> })` renders scene and controls. The page owns only navigation/header chrome.

- [ ] **Step 1: Add failing characterization test.** In the player test, render a session and assert the existing choice and free action still submit through one hook: `expect(screen.getByRole('button', { name: 'Спросить о веере' })).toBeEnabled(); await userEvent.type(screen.getByRole('textbox', { name: 'Ваше действие' }), 'Осмотреть крышу'); await userEvent.click(screen.getByRole('button', { name: 'Отправить' })); expect(JSON.parse(vi.mocked(fetch).mock.calls.at(-1)![1]!.body as string).action).toBe('Осмотреть крышу')`.
- [ ] **Step 2: Run focused test.** `npm --workspace apps/web run test -- StoryPlayerPage.test.tsx`; expect red only for any newly introduced assertion.
- [ ] **Step 3: Extract without behavior change.** Move the two modules, update imports through the feature public API, and render `StoryScene` from `StoryPlayerPage`. Preserve abort, retry, conflict, and idempotency paths verbatim.
- [ ] **Step 4: Run focused tests.** Same command; expect all player tests green. Run `npm --workspace apps/web run lint:fsd` and resolve only new boundary violations.
- [ ] **Step 5: Commit.** `git add apps/web/src && git commit -m "refactor: share story play logic across modes"`.

### Task 3: Compact player from Figma

**Files:** Modify `apps/web/src/pages/story-player/ui/StoryPlayerPage.tsx`, `apps/web/src/features/play-story/ui/StoryScene.tsx`, `apps/web/src/styles.css`, and player tests.

**Interfaces:** Consumes the Figma player frame context and shared scene; preserves `StoryPlayerPage({sessionId})` and all turn semantics.

- [ ] **Step 1: Write failing UI tests.** Assert a `Студия` link targets `/studio/${session.id}` and that the player no longer exposes provider/model as prominent header text. Retain keyboard, error, status, and reduced-motion coverage.
- [ ] **Step 2: Run focused tests.** `npm --workspace apps/web run test -- StoryPlayerPage.test.tsx`; expect the new navigation assertions to fail.
- [ ] **Step 3: Implement Figma layout.** Use scene/reader/control regions; CSS `font-size: 1.125rem` desktop and `1rem` in the mobile media query for `.line`, with viewport-aware sizing and scroll behavior. Keep focus outlines and semantic labels.
- [ ] **Step 4: Verify.** Run focused tests, `npm --workspace apps/web run typecheck`, and build. Compare browser desktop/mobile screenshots against Figma and adjust CSS.
- [ ] **Step 5: Commit.** `git add apps/web/src && git commit -m "feat: compact player screen"`.

### Task 4: Working Studio for current story

**Files:** Create `apps/web/src/pages/studio/ui/StudioPage.tsx`, `SessionInspector.tsx`, tests and `index.ts`; modify routes, router, CSS.

**Interfaces:** `routes.studio = '/studio'`; `routes.studioSession(id: string) => '/studio/' + encodeURIComponent(id)`. Studio entry uses `api.listStories()` and `api.startSession(story.id, { provider_id: story.recommended_provider_id })`; current session uses `useStoryPlayer(sessionId)` and `StoryScene`.

- [ ] **Step 1: Write failing route and Studio tests.** Assert `/studio` shows a `Новая тестовая сессия` button for “Эхо неона”; clicking starts a session and navigates to `/studio/session-1`; `/studio/session-1` shows `Крыша`, `v1`, `ollama`, model, `Аканэ`, and an `Открыть как игрок` link to `/play/session-1`. After a turn, assert `v2`, prompt version `v1`, and last action appear. Assert failed creation displays an alert and preserves a retry action.
- [ ] **Step 2: Run focused tests.** `npm --workspace apps/web run test -- StudioPage.test.tsx`; expect missing component/route failure.
- [ ] **Step 3: Implement entry/current-session pages.** Use `useNavigate`, `api.listStories`, `api.startSession`, and shared play feature. Inspector reads only confirmed `StorySession` and `latest_turn`; copy session ID via `navigator.clipboard.writeText` with accessible feedback. An existing-session form accepts ID or `/play/` or `/studio/` URL and navigates after validation; malformed input shows a local error. Never overwrite a running player session.
- [ ] **Step 4: Verify.** Run Studio and player unit tests, FSD lint, typecheck and build. Use Playwright/browser smoke to start a separate Studio session, submit a turn, inspect state, and open that session as player.
- [ ] **Step 5: Commit.** `git add apps/web/src && git commit -m "feat: add working author studio"`.

### Task 5: Research record and final verification

**Files:** Create `docs/research/sillytavern-comparison.md`; modify `README.md` only if navigation instructions need updating.

**Interfaces:** Documents exact upstream code links and which ideas were adopted/deferred, without copying source code.

- [ ] **Step 1:** Document commit-pinned links for prompt assembly/token budget, lore budget, branch snapshot, and atomic chat persistence, alongside our backend-authoritative design and explicit follow-ups.
- [ ] **Step 2:** Run `npm run check` from repository root; run end-to-end tests only on non-conflicting ports or a separate test server. Verify git diff and a working Studio turn in browser.
- [ ] **Step 3:** Request code review, fix confirmed findings, rerun affected checks, and commit the research/README changes.

## Self-review

The tasks cover both views, Figma-first design, working current-story test flow, inspector, failure states, accessibility, and SillyTavern comparison. No new backend or graph editing is implied. The shared hook and scene are consumed through one feature public API; page slices do not import one another.
