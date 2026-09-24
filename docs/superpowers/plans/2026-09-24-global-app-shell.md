# Global App Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one global, collapsible navigation shell across the application, contextual settings, a read-only character catalog, and clone-ready project documentation.

**Architecture:** A parent React Router route owns the shadcn Sidebar and an `Outlet`. A small app-level preference store persists the sidebar collapse style in `localStorage`. Settings content is reused in a route page and a dialog opened over live story sessions; existing story/player state remains inside the mounted child route.

**Tech Stack:** React, TypeScript, React Router, shadcn/ui Mira preset `b1D1mJdI`, Tailwind CSS, Vitest, Testing Library, Playwright, FastAPI read-only endpoints.

**Spec:** `docs/superpowers/specs/2026-09-24-global-app-shell-design.md`

## Global Constraints

- Global sections: «Библиотека», «Персонажи», «Студия», «Настройки»; story/session facts stay inside their pages.
- Desktop story and Studio session routes start with sidebar collapsed; all other routes start expanded.
- Collapsed mode defaults to fully hidden; a local setting can retain the icon rail. Persist the preference in this browser only.
- Settings open in a dialog over `/play/:sessionId` and `/studio/:sessionId`, with no navigation or session unmount; elsewhere they use `/settings`.
- Use shadcn components from the existing preset; do not install the whole `dashboard-01` block or create replacement low-level primitives.
- Characters and provider diagnostics are read-only; do not imply CRUD or model switching exists.
- Preserve existing Russian UI, story theming, session URLs, responsive behavior, and keyboard access.
- Do not commit `.env`, SQLite user data, or Ollama model weights.

## File Map

- `apps/web/src/app/router.tsx`: nested route structure.
- `apps/web/src/app/ui/AppShell.tsx`: global Sidebar, active items, responsive trigger, contextual settings presentation, `Outlet`.
- `apps/web/src/app/model/sidebar-preference.tsx`: persisted boolean preference and safe `localStorage` fallback.
- `apps/web/src/shared/ui/sidebar.tsx`, `switch.tsx`, and registry dependencies: generated shadcn components only.
- `apps/web/src/shared/config/routes.ts`: character/settings paths.
- `apps/web/src/pages/characters/ui/CharactersPage.tsx`: cross-story, read-only catalog.
- `apps/web/src/pages/settings/ui/SettingsContent.tsx`, `SettingsPage.tsx`: one settings body shared by page and dialog.
- `apps/web/src/shared/api/contracts.ts`, `client.ts`, `index.ts`: `StoryDetail` and `getStory`.
- `apps/web/src/test/api-server.ts`: story-detail response support.
- `apps/web/src/styles.css`: only layout compatibility and compact library styles; keep story theme variables scoped.
- `README.md`, `AGENTS.md`, `docs/roadmap.md`: portable context and accurate status.

---

### Task 1: Persist the sidebar collapse preference

**Files:**
- Create: `apps/web/src/app/model/sidebar-preference.tsx`
- Create: `apps/web/src/app/model/sidebar-preference.test.tsx`

**Interfaces:**
- Produces: `SidebarPreferenceProvider({children})` and `useSidebarPreference(): { showIconsWhenCollapsed: boolean; setShowIconsWhenCollapsed(value: boolean): void }`.
- Storage key: `mnemosyne.sidebar.show-icons-when-collapsed`; malformed/missing/blocked storage means `false`.

- [ ] **Step 1: Write a failing test** for default false, persisted true after clicking a test consumer, and thrown `localStorage.getItem`/`setItem` without crashing. Use `render`, `screen`, `userEvent` and `vi.stubGlobal`/`vi.spyOn` in `sidebar-preference.test.tsx`:

```tsx
function Probe() {
  const { showIconsWhenCollapsed, setShowIconsWhenCollapsed } = useSidebarPreference()
  return <button onClick={() => setShowIconsWhenCollapsed(true)}>{String(showIconsWhenCollapsed)}</button>
}
test('defaults to full hide and persists icon preference', async () => {
  localStorage.clear()
  render(<SidebarPreferenceProvider><Probe /></SidebarPreferenceProvider>)
  expect(screen.getByRole('button', { name: 'false' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'false' }))
  expect(localStorage.getItem('mnemosyne.sidebar.show-icons-when-collapsed')).toBe('true')
})
```

- [ ] **Step 2: Run** `npm --prefix apps/web test -- src/app/model/sidebar-preference.test.tsx`; expect import failure.
- [ ] **Step 3: Implement** a focused context. Lazy-initialize state with `try { localStorage.getItem(key) === 'true' } catch { return false }`; setter updates React state first, then attempts `localStorage.setItem` in `try/catch`. Throw a clear error if hook is used outside provider.

```tsx
const storageKey = 'mnemosyne.sidebar.show-icons-when-collapsed'
function readPreference(): boolean {
  try { return localStorage.getItem(storageKey) === 'true' } catch { return false }
}
// Provider owns useState(readPreference); setter updates state and best-effort storage.
```
- [ ] **Step 4: Run** the targeted test and `npm --prefix apps/web run typecheck`; expect PASS.
- [ ] **Step 5: Commit** `apps/web/src/app/model` with `feat: persist sidebar collapse preference`.

### Task 2: Add the global shell and nested routes

**Files:**
- Create: `apps/web/src/app/ui/AppShell.tsx`, `AppShell.test.tsx`
- Modify: `apps/web/src/app/router.tsx`, `router.test.tsx`
- Modify: `apps/web/src/shared/config/routes.ts`
- Modify: `apps/web/src/pages/story-player/ui/StoryPlayerPage.tsx`
- Modify: `apps/web/src/pages/studio/ui/StudioPage.tsx`
- Modify: `apps/web/src/styles.css`
- Generate: `apps/web/src/shared/ui/sidebar.tsx`, `switch.tsx` and their shadcn dependencies

**Interfaces:**
- Consumes: `useSidebarPreference()` from Task 1.
- Produces: `AppShell` parent route around the four existing routes. Task 3 adds `routes.characters = '/characters'`; Task 4 adds `routes.settings = '/settings'` and the contextual dialog.

- [ ] **Step 1: Write failing route/shell tests.** Update `router.test.tsx` to assert one parent route at `/` with `children` containing index, `play/:sessionId`, `studio`, `studio/:sessionId`. In `AppShell.test.tsx`, render `TestRouter` at `/play/session-1`, stub a session, and assert that the sidebar can be opened while `story-player-route` remains mounted and has the same `data-session-id`.

```tsx
expect(routeObjects).toHaveLength(1)
expect(routeObjects[0].children?.map(({ path, index }) => index ? '(index)' : path))
  .toEqual(['(index)', 'play/:sessionId', 'studio', 'studio/:sessionId'])
```

- [ ] **Step 2: Run** `npm --prefix apps/web test -- src/app/router.test.tsx src/app/ui/AppShell.test.tsx`; expect FAIL.
- [ ] **Step 3: Run** `npx shadcn@latest docs sidebar` and `npx shadcn@latest add sidebar switch` from `apps/web`; inspect generated changes and keep registry components only. Do not add `dashboard-01`.
- [ ] **Step 4: Implement** the parent route with `<SidebarPreferenceProvider><AppShell /></SidebarPreferenceProvider>` and an `Outlet` inside `AppShell`. Use shadcn `SidebarProvider`, `Sidebar`, `SidebarContent`, `SidebarMenu`, `SidebarMenuButton`, `SidebarTrigger`, `SidebarInset`. Add working Library and Studio items now; Tasks 3 and 4 add Characters and Settings when those destinations exist. Bind `collapsible` to `showIconsWhenCollapsed ? 'icon' : 'offcanvas'`.

```tsx
export const routeObjects: RouteObject[] = [{
  path: '/',
  element: <SidebarPreferenceProvider><AppShell /></SidebarPreferenceProvider>,
  children: [
    { index: true, element: <NovelLibraryPage /> },
    { path: 'play/:sessionId', element: <StoryPlayerRoute /> },
    { path: 'studio', element: <StudioRoute /> },
    { path: 'studio/:sessionId', element: <StudioRoute /> },
  ],
}]
```
- [ ] **Step 5: In `AppShell`, derive `isSessionView` from `/play/` or `/studio/:sessionId`; initialize/reset desktop open state to `!isSessionView` on route entry. Keep an always visible, keyboard-focusable `SidebarTrigger` in `SidebarInset` when offcanvas is collapsed. Use the generated Sidebar mobile behavior. Keep the shadcn sidebar outside `data-story-theme`; adjust `.game-shell`, `.studio-shell`, `.stage`, and shell sizing so a collapsed sidebar leaves the game full width.
- [ ] **Step 6: Move only the duplicated global navigation links out of player/Studio headers; retain their story title, mode link, and inspector.** Keep the library card start flow intact, but reduce oversized heading/card spacing in `NovelLibraryPage.tsx` and `styles.css` where necessary.
- [ ] **Step 7: Run** targeted tests, `npm --prefix apps/web run lint:fsd`, typecheck, and build; expect PASS. Commit with `feat: add global navigation shell`.

### Task 3: Add the aggregate characters page

**Files:**
- Modify: `apps/web/src/shared/api/contracts.ts`, `client.ts`, `index.ts`, `client.test.ts`
- Modify: `apps/web/src/test/api-server.ts`
- Create: `apps/web/src/pages/characters/index.ts`, `ui/CharactersPage.tsx`, `ui/CharactersPage.test.tsx`
- Modify: `apps/web/src/app/router.tsx`

**Interfaces:**
- Produces: `type StoryDetail = StorySummary & { current_scene: string; characters: Character[] }` and `api.getStory(storyId: string, signal?: AbortSignal): Promise<StoryDetail>`.
- Page reads `listStories()` then `Promise.allSettled(stories.map(story => api.getStory(story.id, signal)))`. It labels each character with the parent story title, retains fulfilled stories on partial failure, and shows retry.

- [ ] **Step 1: Write failing API and page tests.** Test URL encoding for `getStory('a/b')`; add `apiServer.storyDetail(id, detail)` and tests for populated catalog, empty catalog, one failed detail with successful items preserved, and total load failure with a retry button. Extend the route test to include `characters`.

```tsx
const storyA = { id: 'a', slug: 'a', title: 'История А', premise: 'Описание', story_mode: 'hybrid' as const, recommended_provider_id: 'ollama', recommended_model_id: 'local' }
const storyB = { ...storyA, id: 'b', slug: 'b', title: 'История Б' }
const akane = { id: 'c', name: 'Аканэ', age: 24, personality: 'Смелая', appearance: 'Красное платье', visual_profile_version: 1 }
apiServer.listStories([storyA, storyB])
apiServer.storyDetail(storyA.id, { ...storyA, current_scene: 'Начало', characters: [akane] })
apiServer.storyDetail(storyB.id, { ...storyB, current_scene: 'Начало', characters: [] })
render(<TestRouter initialEntries={['/characters']} />)
expect(await screen.findByText(akane.name)).toBeInTheDocument()
expect(screen.getByText(storyA.title)).toBeInTheDocument()
```

- [ ] **Step 2: Run** targeted API/page tests; expect FAIL.
- [ ] **Step 3: Add `StoryDetail` and `getStory` to the client, implement the test server's `GET /api/stories/{id}` map, and implement the page. Register `/characters` and its global menu link. Use existing `Card`, `Alert`, and `Button`; do not add edit/create actions.** Abort outstanding requests on unmount; on retry, issue fresh requests and clear prior warning.

```ts
export type StoryDetail = StorySummary & { current_scene: string; characters: Character[] }
getStory(storyId: string, signal?: AbortSignal) {
  return request<StoryDetail>(`/api/stories/${encodeURIComponent(storyId)}`, { baseUrl, signal })
}
```
- [ ] **Step 4: Run** targeted tests, lint, typecheck; expect PASS. Commit with `feat: add cross-story character catalog`.

### Task 4: Build one settings body with contextual presentation

**Files:**
- Create: `apps/web/src/pages/settings/index.ts`, `ui/SettingsContent.tsx`, `ui/SettingsPage.tsx`, `ui/SettingsContent.test.tsx`
- Modify: `apps/web/src/app/ui/AppShell.tsx`, `AppShell.test.tsx`
- Modify: `apps/web/src/app/router.tsx`

**Interfaces:**
- Consumes: `useSidebarPreference()` and `api.providers(signal)`.
- Produces: `SettingsContent` with one working switch and provider diagnostics; `SettingsPage` wraps it for `/settings`. `AppShell` renders the same content inside shadcn `Dialog` over session routes.

- [ ] **Step 1: Write failing tests** for (a) opening settings over `/play/session-1` preserves URL and `story-player-route`, (b) closing returns focus to trigger, (c) clicking Settings from `/characters` navigates to `/settings`, (d) switch changes persisted preference immediately, and (e) provider unavailable/error state plus retry. Extend route test to include `settings`.

```tsx
await userEvent.click(screen.getByRole('button', { name: 'Настройки' }))
expect(screen.getByRole('dialog', { name: 'Настройки' })).toBeInTheDocument()
expect(screen.getByTestId('story-player-route')).toHaveAttribute('data-session-id', 'session-1')
await userEvent.keyboard('{Escape}')
expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
```

- [ ] **Step 2: Run** targeted settings and shell tests; expect FAIL.
- [ ] **Step 3: Implement** `SettingsContent` with shadcn `Switch`, `Label`, `Card`, `Alert`, and `Button`. Fetch provider statuses in an effect with `AbortController`; use a retry counter or callback to refetch. Show provider/model data without editable controls. Catch provider failures and display an actionable Russian message.

```tsx
const { showIconsWhenCollapsed, setShowIconsWhenCollapsed } = useSidebarPreference()
<Label htmlFor="sidebar-icons">Показывать иконки при сворачивании</Label>
<Switch id="sidebar-icons" checked={showIconsWhenCollapsed} onCheckedChange={setShowIconsWhenCollapsed} />
// Provider diagnostics call api.providers(controller.signal) on mount and retry.
```
- [ ] **Step 4: Register `/settings`, add its global menu item, and render `SettingsContent` on the page and inside a shadcn `Dialog` in `AppShell` only on live session routes.** The menu item uses a button on session routes and a `Link` elsewhere. Closing via Escape, close control or outside click leaves the route and session mounted. Do not create a game turn.
- [ ] **Step 5: Run** targeted tests, `npm --prefix apps/web run lint:fsd`, typecheck, build; expect PASS. Commit with `feat: add contextual settings`.

### Task 5: Verify browser behavior and make the repo portable

**Files:**
- Modify: `apps/web/e2e/story-flow.spec.ts` or create `apps/web/e2e/global-navigation.spec.ts`
- Create: `AGENTS.md`
- Modify: `README.md`, `docs/roadmap.md`

**Interfaces:**
- Browser expectations: desktop full hide by default in play; icon rail after setting; modal over player and Studio session; settings page elsewhere; mobile menu open/close; character catalog and original story-start flow.
- Documentation expectation: `git clone https://github.com/kviron/ai-novel.git`, `cd ai-novel`, `npm run setup`, copy `.env.example` to `.env`, install matching Ollama model, then separate `npm run dev:api` / `npm run dev:web`.

- [ ] **Step 1: Write Playwright tests** that visit the existing seeded story flow, verify the accessible menu trigger while sidebar is fully hidden, open Settings without URL change, toggle «Показывать иконки при сворачивании», reload, and verify the rail; navigate to Characters and then Settings as a page. Add a mobile viewport test for opening/closing the sidebar and keyboard focus. Use the existing fake-Ollama E2E setup; do not depend on the developer's local model.
- [ ] **Step 2: Run** `npm run test:e2e`; expect new tests to identify any layout/focus regressions. Fix only observed failures, then rerun.
- [ ] **Step 3: Write `AGENTS.md`** with verified repo topology (`apps/web`, `apps/api`, `docs/roadmap.md`), canonical SQLite/FastAPI story state rule, current implemented slice, limits of read-only catalog/settings, test commands, and link to this spec. Update README's Windows setup to start with the clone commands above and explain that `.env`, local SQLite sessions and Ollama weights do not sync through Git. Update roadmap with a concise completed infrastructure note; keep stage 2 and stage 10 `planned`.
- [ ] **Step 4: Run** `npm run check` and `npm run test:e2e`; expect both exit code 0. Inspect `git diff --check`, `git status --short`, and `git diff --stat`; confirm no `.env`, SQLite or generated cache in the commit.
- [ ] **Step 5: Commit** with `docs: record portable setup and global shell status`. Push to the configured remote only after the final verification and review; report the branch and remote commit SHA to the user.
