---
id: plan/asset_backends
title: "Asset Backends — Server-Side Rundowns + Graphics-Editor Thumbnails"
status: implemented
summary: "Gives real backends to two of the Assets page's placeholder cards. (1) Rundowns are caption files: stored in caption_files with type='rundown' (same serialized format the planner produces and the player reads via file-include), backed by a new user-facing file authoring/edit API since caption files are currently created only as a session side-effect. The planner gains Save/Open-from-project; editing is overwrite-in-place. (2) Thumbnails are created and edited in the graphics editor: a thumbnail is a still-PNG render of a DSK template (reusing renderTemplateToHtml + Playwright screenshot), stored in a new thumbnails table that keeps both the source template reference (so it stays re-editable) and the cached PNG. The third placeholder, Stored videos, is a full recording pipeline specced separately in plan_recording_vod.md."
related: plan/assets_page, plan/broadcasts, plan/recording_vod
---

# Asset Backends — Server-Side Rundowns + Graphics-Editor Thumbnails

Backs two of the three placeholder cards from `plan_assets_page.md`. The third
(Stored videos) is a recording pipeline and lives in `plan_recording_vod.md`.

## Part A — Rundowns are caption files

**Decision: rundowns are caption files.** A rundown is the same document the
planner already serializes (`serializePlan` in
`packages/lcyt-web/src/lib/metacode-planner.js`) — captions as plain lines, `#`
headings, metacodes as HTML comments — which is exactly the format the playback
engine consumes via `file-include`. So a rundown is a `caption_files` row with
`type='rundown'`, not a new store. This keeps:

- The Assets page's single **"Caption / rundown files"** card (plan_assets_page
  decision 2b).
- The Broadcasts plan's reserved `rundown_file_id` FK **into `caption_files`**
  (`type='rundown'`) — unchanged.

### The gap: no user-facing file write path

Today `caption_files` rows are created **only as a side-effect of a live caption
session** (`writeToBackendFile`, streamed append). There is no endpoint to
author or edit a file directly — confirmed by inspection (the `lcyt-files`
router only has `GET /file`, `GET /file/:id`, `DELETE /file/:id`, and
`storage-config`). Server-side rundowns therefore need a **new authoring API**,
which also benefits ordinary caption files (you can now pre-write one).

New routes in `packages/plugins/lcyt-files/src/routes/files.js`:

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/file` | Create a file: `{ type?, lang?, format?, filename, content }` → write full content via the resolved storage adapter, insert a `caption_files` row. `type` defaults `'captions'`; rundowns pass `type='rundown'`. |
| `PUT` | `/file/:id` | Replace content + metadata (overwrite-in-place). |

- **Full-content write:** the storage-adapter interface today is append-oriented
  (`openAppend` → `write`/`close`). Add a `writeFull(apiKey, filename, content)`
  helper (or overwrite = open fresh `storedKey`, write all, close, delete old)
  to each adapter (`local`/`s3`/`webdav`), keeping `storedKey` semantics intact.
  Data-access/write helpers follow the repo convention (in the plugin's own
  `db.js`/`caption-files.js`, routes stay thin).
- **Per-key storage** is respected via the existing `resolveStorage(apiKey)`.
- **S3 fallback: already handled — no work needed.** `createStorageAdapter()`
  defaults to the **local** adapter (`FILES_DIR`) unless `FILE_STORAGE=s3` is
  explicitly set (which errors loudly if `S3_BUCKET` is missing rather than
  silently breaking). So rundowns and caption files authored via this API write
  to local disk with no S3 configured, and light up S3/WebDAV only when the
  operator opts in. The recording pipeline mirrors this default in
  `plan_recording_vod.md`.

### Planner wiring

`PlannerPage.jsx` gains, alongside the existing localStorage draft + `.md`
download:

- **Save to project** → `POST`/`PUT /file` with `type='rundown'`,
  `content = serializePlan(blocks)`, a chosen `filename`.
- **Open from project** → `GET /file?type=rundown`, load a row's content →
  `deserializePlan` into the editor.

localStorage remains the unsaved-autosave draft; server save is explicit.

### Assets card behaviour

The "Caption / rundown files" card lists both kinds with a **type badge**;
rundown rows open in the planner (`/planner?file=:id`), caption rows in
`/captions`.

### Locked / small-open

- **Editing model:** overwrite-in-place, **no version history** (matches the
  planner's single-draft model; versioning is out of scope).
- **Filename uniqueness (decided):** rows are **id-keyed**; `filename` is a
  display label and **duplicates are allowed** — no `(api_key, filename)`
  constraint. Matches how session-produced files already behave; "Open from
  project" lists by id, showing the name as a label.

## Part B — Thumbnails from the graphics editor

**Decision: thumbnails are created and edited in the graphics editor**, and
stored as **template-ref + rendered PNG**. A thumbnail is a still-PNG render of a
DSK template; keeping the template reference is what makes it re-editable.

### Reuse the existing renderer

`packages/plugins/lcyt-dsk/src/renderer.js` already has
`renderTemplateToHtml(templateJson, opts)` (line 122) and renders frames via
Playwright `page.screenshot({ type: 'png' })` (lines 510/658). Thumbnails add a
**one-shot** render (load the template HTML into a Playwright page, take one
screenshot) — reusing this code rather than the continuous screenshot→ffmpeg
loop used for live overlays. The containerised `docker/lcyt-dsk-renderer` image
covers the same path for isolated rendering.

### Schema — new `dsk_thumbnails` table

> **As implemented** (`packages/plugins/lcyt-dsk/src/db.js`, `src/db/thumbnails.js`) — the table
> is named `dsk_thumbnails` (not `thumbnails`), the PNG path column is `storage_path` (not
> `disk_filename`), and there is **no `broadcast_id` column** — the "cover thumbnail" linkage
> described below in "Assets card + editor flow" and in "Cross-plan alignment" was not built.
> Verified in code 2026-07-20; SQL below is the original design sketch, kept for context.

```sql
CREATE TABLE IF NOT EXISTS thumbnails (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  api_key       TEXT    NOT NULL,
  template_id   INTEGER,                 -- FK dsk_templates.id (source, keeps it editable); nullable if template deleted
  name          TEXT    NOT NULL DEFAULT '',
  disk_filename TEXT    NOT NULL,        -- stored PNG (storage adapter, icons-style)
  width         INTEGER NOT NULL DEFAULT 1280,
  height        INTEGER NOT NULL DEFAULT 720,
  size_bytes    INTEGER NOT NULL DEFAULT 0,
  broadcast_id  TEXT,                    -- optional: a broadcast's cover thumbnail
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_thumbnails_api_key ON thumbnails(api_key);
```

Stored under the DSK plugin's ownership (migrations alongside `dsk_templates`).
The rendered PNG lives in storage (the same image-storage path as `icons`); the
row caches metadata + the render. Both the template ref and the cached PNG are
kept: the PNG is served fast; the template ref lets "Edit" reopen the source.

### Routes (DSK plugin, `packages/plugins/lcyt-dsk/src/routes/`)

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/:apikey/thumbnails` | `{ template_id, name, width?, height? }` → render one PNG, store, insert row |
| `GET` | `/:apikey/thumbnails` | List (name + meta; optional `?broadcastId=`) |
| `GET` | `/:apikey/thumbnails/:id` | The PNG (or metadata + image URL) |
| `PUT` | `/:apikey/thumbnails/:id` | Rename and/or **re-render** from the (possibly edited) template |
| `DELETE` | `/:apikey/thumbnails/:id` | Delete row + stored PNG |

### Assets card + editor flow

The **Thumbnails** card lists rows with a small preview; **Create thumbnail**
picks a template and renders; **Edit** opens the source template in the graphics
editor (`/graphics/editor?template=:template_id`) and offers "re-render this
thumbnail" on save. **Not implemented:** the `broadcast_id`-as-cover-thumbnail
idea below was never built — `dsk_thumbnails` has no `broadcast_id` column, so
a broadcast cannot carry a thumbnail as its cover image today (verified in code
2026-07-20).

## Cross-plan alignment

- **`plan_assets_page.md`** — flips the Rundowns and Thumbnails placeholder
  cards to real, backed cards (Rundowns folded into the Caption/rundown files
  card; Thumbnails its own card).
- **`plan_broadcasts.md`** — `rundown_file_id` FK confirmed (caption_files,
  `type='rundown'`); the optional `broadcast_id` on thumbnails for a cover image
  was **not implemented** (see Part B note above).
- **`plan_recording_vod.md`** — the remaining placeholder (Stored videos).

## Out of scope

- Rundown version history (overwrite-in-place only).
- Enforced unique filenames (unless chosen in the small-open above).
- Animated/multi-frame thumbnails (single still PNG).
- The recording/VOD pipeline (separate plan).
