# Plan: caption text in the database (draft, not started)

Status: draft. Decided 2026-10-12 not to start yet; written down so it can be picked up later.

## Why

Caption files are appended by the instance serving a session (`packages/plugins/lcyt-files/src/caption-files.js`). With several instances (see `plan_multi_instance.md`) that means one file part per instance, an S3 multipart upload that stays open if an instance crashes, and a file layout that depends on which instance served the session. Storing the caption text as rows removes all of that: any instance can write, and files are built when someone asks for them.

## Idea

Each caption becomes a row; the file is a view of the rows. The write stays fire and forget, as the file write is today (`caption-file-writer.js` does not await it and swallows errors).

## Data model

New table `caption_lines` (both Prisma schemas, PostgreSQL and SQLite):

| Column | Notes |
|---|---|
| `id` | autoincrement |
| `api_key` | project |
| `session_id` | session |
| `sequence` | the number reserved by `SessionStore.reserveSequence()`; unique per session, so rows from different instances sort correctly |
| `lang` | `original` or a translation language |
| `text` | caption text |
| `caption_time` | ISO time of the caption (no trailing Z, as elsewhere) |
| `created_at` | insert time |

Unique `(session_id, lang, sequence)` makes a retried insert harmless. Index `(api_key, session_id, lang, sequence)`.

`caption_files` stays as the list of "files" users see, but a row now describes a view (session, lang, format) and has no `filename` of its own for new data; `size_bytes` is computed or cached on read. Rows written by the old path keep working, so the two can coexist during the change.

## Writing

- `writeSessionCaptionFiles` pushes `{session, lang, sequence, text, time}` into an in-memory buffer.
- The buffer is flushed with one multi-row insert about once a second, or at N rows, and on session end and graceful shutdown.
- Errors are logged and the batch is dropped (fire and forget). A crash can lose up to about a second of captions. If a project needs a guarantee, an `await` mode (insert before the send returns) can be a per-project setting, at the cost of send latency.
- Single instance on SQLite uses the same code; the batch just goes to SQLite.

## Reading

- `GET /api/v1/file/:id`: build the file from the rows for the file's session and lang. Formats: plain text, `youtube` and VTT (cue times relative to the session start, as `buildVttCue` does now), SRT if wanted. `?offsetMs=` keeps working by applying the shift while building.
- Stream large sessions (cursor over `sequence`) instead of loading everything.
- `GET /api/v1/file` and `/library`: list the view rows; size comes from `sum(length(text))` or a cached column.
- `DELETE`: delete the rows (and the `caption_files` row).

## Migration

1. Add the table and the writer behind a setting (`CAPTION_STORE=db|file|both`, default `file`).
2. `both` for one release: write files and rows, so the output can be compared.
3. Switch the default to `db`. Old file rows keep being served from storage.
4. Optional tool to import old files into rows (`npm run files:migrate`-style), not required.

## Retention and size

- Rows are tiny, but a long stream can have thousands of lines. Add a retention setting (days) and a cleanup chore under the existing `chore:<name>` lease.
- Deleting a project permanently removes its rows with the other project data.

## Tests

- Unit: buffer flush on size, time, session end and shutdown; dropped batch on DB error does not throw into the send path.
- Two instances serving one session: rows interleave, the built file is in `sequence` order, no duplicates after a retried insert.
- Built VTT equals the old appended VTT for the same input (golden test).
- `?offsetMs=` on built files.
- Run on SQLite and PostgreSQL (the CI matrix covers both).

## Docs

`docs/DEPLOY.md` (storage section: files no longer need `FILE_STORAGE=s3` for captions in multi-instance mode, only for other files), `packages/plugins/lcyt-files/CLAUDE.md`, `packages/lcyt-backend/CLAUDE.md`, `docs/PLANS.md`.

## Open questions

- Should raw text be stored once and formats built on demand (proposed), or should the format be stored per row? Proposed: once.
- Is a per-project guaranteed mode needed, or is the archive best effort for everyone?
- Which consumers read caption files directly from storage today (broadcast files, download links)? They need a check before the default changes.

## Rough size

Medium: schema and writer about a day, reading and the file routes about two days, migration switch and docs about a day, plus tests on both databases.
