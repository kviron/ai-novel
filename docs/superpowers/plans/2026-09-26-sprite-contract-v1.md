# Sprite Contract v1 Implementation Plan

> **Spec:** `docs/superpowers/specs/2026-09-26-sprite-contract-v1.md`

**Goal:** replace generated sprite atlases with validated per-emotion assets throughout storage, archives, sessions, UI, bundled characters, and future generation prompts.

**Architecture:** immutable `sprite:<emotion>:<variant>` materials are grouped into a typed sprite map at the service boundary. The renderer selects a URL by semantic emotion and falls back to neutral. A single validator and prompt builder own the normative sprite geometry so upload and generation cannot drift.

- [x] Add API tests for sprite kind parsing, PNG geometry/alpha validation, sprite maps, revision copying, and archive v2 round-trip/v1 import.
- [x] Implement the sprite domain contract, validator, typed schemas, service mapping, upload boundary, and portable archive v2.
- [x] Add web tests for semantic sprite selection, neutral fallback, normal `<img>` rendering, and the character sprite gallery.
- [x] Replace atlas rendering and API types with the sprite map.
- [x] Define the future image-generation request/prompt builder and tests using the exact contract constraints.
- [x] Produce contract-compliant per-emotion assets for Ashley and Akane and a neutral Mark asset; register bundled assets without replacing user revisions.
- [x] Run API/web unit tests, linters, typecheck, production build, asset validation, and a browser smoke test of the running project.
