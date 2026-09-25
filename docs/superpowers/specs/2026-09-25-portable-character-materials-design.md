# Portable character materials and archive

Stage 2 extends immutable character revisions. An avatar or cover belongs to a revision, not to a mutable character record. Adding or replacing either creates a new revision with the same text fields; story and session pins keep their earlier revision. Text-only edits carry the current material references into the new revision.

The MVP accepts PNG, JPEG, and WebP avatars and covers up to 10 MiB each. Each material records SHA-256, MIME type, original filename, creator, license, and source. Blobs live in an app-owned content-addressed directory, never under user-provided paths. The archive is ZIP with a versioned JSON manifest and hash-addressed blobs. Import validates format, size, entries, and hashes before writing; each import creates an independent character identity while retaining the exported origin ID. No model/provider credentials are exported.

The catalog and detail pages display revision artwork and expose upload, export, and import. A session can fork its pinned character revision into an independent catalog entry; story-local role and color are not copied. Bundled portraits are registered with explicitly unspecified redistribution rights. Tests cover upload, pin stability, two-story reuse, extraction, round-trip and repeat import, and malformed archives. Generated images and manual save slots remain outside this stage.
