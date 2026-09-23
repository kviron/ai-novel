# Compact Player and Author Studio — Design

## Goal and scope

Redesign the first playable slice of “Эхо неона” as two clearly separated experiences: an immersive, compact player view and a working author Studio for testing the existing story. Produce editable desktop player, mobile player, and desktop Studio screens in the supplied Figma file first, then implement those screens in React using the application's existing tokens and UI primitives.

The Studio is a test cockpit, not a story-graph editor. The current API exposes one seeded story and a session's `current_scene`, but has no authored scene catalog or jump endpoint. The Studio must never pretend that arbitrary scene selection or rewinding exists.

## Research translated into decisions

SillyTavern offers independently useful ideas: ordered, configurable prompt composition; context/lore insertion under a budget; chat branching; and durable chat saves. For our constrained visual novel, keep the backend as the authority for turns and state. Do not copy SillyTavern's global client-side state or broad extension surface. Apply only practices that improve the current slice: show the provider/model/prompt version and state version in the Studio, keep test sessions distinct from a player's active session, and make future prompt-context budgeting and branch snapshots explicit follow-up work rather than silently adding them now.

Code references reviewed at SillyTavern commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`: `public/scripts/openai.js` prompt preparation and token-budget checks; `public/scripts/world-info.js` context-budget checks; `public/scripts/bookmarks.js` branch snapshot creation; `src/endpoints/chats.js` atomic file writing. These are design influences, not dependencies.

## Information architecture

- `/` remains the story library and start point for players.
- `/play/:sessionId` is the player view. It shows the story, character art, latest narration/dialogue, choices, and free-form action. Technical details move out of the main reading path.
- `/studio` is the author entry point. It loads the existing story catalog, offers “Новая тестовая сессия”, and accepts an existing session ID or link to inspect.
- `/studio/:sessionId` is the working test cockpit. It uses the same turn API as the player, with an inspector alongside the scene and an “Открыть как игрок” link. Creating a new test session leaves existing player sessions untouched.
- A low-emphasis “Студия” link in the player header and a “Игрок” link in the Studio keep mode switching discoverable. The player link does not grant a separate permission level; this is local author tooling, not authentication.

## Layout and visual system

Keep the current dark, warm-neon palette and Manrope foundation. Use the existing CSS token names (`--background`, `--card`, `--primary`, etc.) and existing button/input components; refine their application instead of adding a second design language. Use a restrained hierarchy: body 14–16 px, dialogue 17–18 px desktop and 16 px mobile, compact metadata 12–13 px. The visual scene should own the viewport, with a lower anchored translucent dialogue surface, a distinct speaker chip, short narration, dialogue, choices, and an action row. Long narration/dialogue must scroll inside the reading area or allow natural page scroll on small screens without obscuring controls. Character sprite remains legible; controls and text maintain contrast and keyboard focus visibility. Respect reduced-motion preference.

Desktop Studio has a scene/test column and an inspector column. The inspector shows session ID with copy affordance, story and current scene, state version, provider/model, current visual directive, prompt version (when a turn exists), latest action, and error/status. It must label data absent on the initial turn plainly. Mobile Studio stacks the inspector after the test scene. Figma screens should include realistic “Эхо неона” copy and states, with compact content density, not generic placeholder cards.

## Data and code boundaries

The existing server contracts remain unchanged for the first implementation. Session creation uses the story's recommended provider and server-selected model, as the library already does. The existing `useStoryPlayer` state machine handles load, provider availability, submission, conflict refresh, and retry; extract it from the page slice into a shared playing feature only when both routes consume it. The player and Studio pages each compose that feature, and the Studio inspector reads its returned session/turn state. No duplicate client-side source of truth and no new backend debug endpoint are required.

An author test session is an ordinary new session with its own ID. There is no hidden reset, scene jump, or mutation of another session. Opening an existing ID loads it through the existing API. Invalid ID, unavailable model, generation error, stale state, and network failures remain visible with a recovery action; a failed turn must not visually replace the last confirmed one.

## Verification and acceptance

Before implementation, inspect the generated Figma screens through design context and screenshots and adjust them until the visual hierarchy is coherent. In code, use test-driven changes for routes, session creation, inspector data, and player interactions. Run frontend type/lint/unit/build checks, backend tests when shared contracts change, and a browser smoke check for player and Studio at desktop and mobile widths. Do not disrupt the user's currently open player session; create a separate test session. Success means an author can start a new “Эхо неона” session in Studio, submit a turn, inspect the resulting confirmed state, and open the same session in player view, while the player screen is materially more compact than today.

## Explicit non-goals

No authentication/roles, story graph editor, arbitrary scene teleport, prompt editor, branching/replay UI, or SillyTavern plugin compatibility in this iteration. Those need separate backend semantics and design work.
