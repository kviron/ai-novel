# Sprite Contract v1

**Status:** accepted for implementation  
**Date:** 2026-09-26  
**Scope:** character catalog, story sessions, portable archives, preview UI, and future image generation

## Research basis

- Ren'Py names a character image by a stable tag plus attributes such as emotion and resolves that name to one displayable. This contract follows that model: `character + emotion + variant` resolves to one image, never to CSS coordinates inside a generated atlas. <https://www.renpy.org/doc/html/displaying_images.html>
- Ren'Py layered images keep mutually exclusive expression attributes in groups and allow pose/outfit layers to evolve independently. The v1 API therefore keeps emotion as an explicit key and leaves room for pose/outfit variants without encoding them into filenames or CSS. <https://www.renpy.org/doc/html/layeredimage.html>
- SillyTavern stores expression sprites as separately named files, supports a chosen fallback expression, flat ZIP packs, custom expressions, and multiple variants such as `joy-1.png`. The archive and fallback rules below adopt those proven conventions. <https://github.com/SillyTavern/SillyTavern-Docs/blob/main/extensions/Expression-Images.md>

## Decision

Generated sprite sheets are not a runtime format. Every emotion variant is a separate transparent PNG and a separate immutable character material. This removes frame bleed, fractional atlas coordinates, and coupling between generated composition and frontend CSS.

## Canonical emotions

The base set is `neutral`, `happy`, `sad`, `angry`, `surprised`, `determined`, `fear`, `villain`, and `lust`. `neutral` is required. Other lowercase ASCII identifiers matching `^[a-z][a-z0-9_-]{0,31}$` are allowed so stories can add expressions such as `fan` without changing the storage contract. `lust` means a fully clothed, non-explicit adult attraction pose; it never relaxes the project's content or costume constraints.

Fallback order is: exact emotion -> `neutral` -> no sprite/character placeholder. The story engine may normalize an unsupported narrative emotion to `neutral`, but the renderer must still apply the same fallback defensively.

## File contract

Each sprite file MUST satisfy all of the following:

- PNG with RGBA color mode and a real alpha channel; no painted checkerboard or solid background.
- Canvas: exactly 1024 x 1536 px, portrait ratio 2:3.
- One complete adult character only. No labels, panels, borders, duplicated body parts, neighboring frames, shadows cut by the canvas, or scenery.
- Placement anchor: bottom-center at `(512, 1504)` px. The lowest visible character pixel is at y 1456-1504; transparent space below is at most 80 px.
- Safe area: all visible pixels remain at least 24 px from the left, right, and top edges and at least 16 px from the bottom edge.
- Across a set, identity, outfit, accessory topology, camera angle, projection, render style, and character scale remain stable. Visible bounding-box height may differ from `neutral` by at most 5% unless a pose explicitly needs more vertical space.
- Emotion may change face, head tilt, torso lean, hands, arms, and gesture. A set SHOULD vary pose meaningfully while preserving the anchor and scale.
- Export uses straight alpha. RGB in fully transparent pixels is ignored by the client; edge pixels must not contain an obvious matte halo.
- Recommended filename: `<character-slug>--<emotion>--<variant>.png`, with `default` as the first variant.

The API validates the decodable PNG, dimensions, alpha presence, empty safety border, nonempty subject, and baseline. Artistic consistency remains a generation and review requirement.

## API model

A revision exposes:

```json
{
  "sprite_contract_version": 1,
  "sprites": {
    "neutral": [{ "variant": "default", "material": { "kind": "sprite:neutral:default" } }],
    "happy": [{ "variant": "default", "material": { "kind": "sprite:happy:default" } }]
  }
}
```

Material kinds use `sprite:<emotion>:<variant>`. Uploading one sprite creates a new immutable character revision and copies every other material forward. Runtime URLs remain content-addressed and immutable.

The old `sprite_sheet` field and `sprite_sheet` material kind are read only for migration; new clients do not render them. Built-in atlas assets are migrated to contract-compliant per-emotion PNGs.

## Portable archive v2

`manifest.json` stores `format_version: 2` and a flat `materials` list per revision. Sprite identity lives in material `kind`; blobs remain content-addressed under `assets/<sha256>.png`. Import accepts v1 for backward compatibility and writes v2 on the next export. Limits apply to total entries and uncompressed bytes, not only revision count.

## Rendering

The web client renders a normal `<img>` with `object-fit: contain` and `object-position: center bottom`. It never crops with background-position. All cast slots share a bottom baseline; responsive scaling changes the whole image uniformly.

The character detail sprite tab lists available emotions and variants from the API. Missing base emotions are shown as absent instead of pretending that atlas coordinates exist.

## Generation prompt contract

Every in-app sprite-generation system prompt MUST include the file contract verbatim in machine-checkable terms: 1024x1536 RGBA PNG, true transparent background, one full body, safe margins, bottom-center anchor, stable identity/outfit/scale, requested emotion and gesture, no text/panels/other figures. A set job uses the accepted `neutral` as the identity/composition reference for later emotions. Validation failures are retried or surfaced; an invalid image is never attached to a character revision.

## Acceptance criteria

- No runtime path uses CSS atlas slicing.
- Akane and Ashley have six separate compliant sprites; Mark has at least a compliant `neutral` sprite and uses the same fallback contract.
- Catalog, session snapshots, archive round-trips, upload endpoint, and UI tests cover the new map.
- Automated validation rejects wrong dimensions, missing transparency, touched safety borders, empty images, and implausible baselines.
- The future image-provider request and system prompt carry `sprite_contract_version: 1` and the complete constraints above.
