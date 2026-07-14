---
id: plan/assets_page
title: "Assets Page — Content Library of Project Assets"
status: draft
summary: "Rebuilds /assets from a placeholder count-tile grid into a SetupCard/SetupItemRow-style content library. Distinguishes Setup (infra every broadcast needs) from Assets (the actual video content a project produces and reuses). Cards render real item rows with a top-right edit affordance opening the relevant editor/dialog, and clickable rows. v1 ships six real, backed cards (Graphics, Global cues, Global actions, Icons, Caption/rundown files, Broadcasts) plus dashed placeholder cards for un-backed types (Stored videos, Thumbnails, Rundowns). Completed translations are folded into Caption files as a language badge, not a separate card. Broadcasts are now a first-class /broadcasts system, VODs are a future dedicated system that stays placeholder-only, and thumbnail generation is part of the graphics pipeline rather than a separate tracked asset."
related: plan/dashboard_console_redesign, plan/ai_roles_framework, plan/cues, plan/selfservice_config_backend
---

# Assets Page — Content Library of Project Assets

> **Superseded in part by `plan_broadcasts.md`:** that plan makes Broadcast a
> first-class entity. Its YouTube ids and identity live on the `broadcasts`
> table, not on `session_stats` — so this plan's `session_stats.youtube_video_ids`
> delta (below) is superseded once broadcasts land, and the Broadcasts card
> lists real broadcast records instead of raw session summaries. If this page
> ships first, implement the column as written and migrate the ids onto
> `broadcasts` later; if broadcasts ship first, the card reads `broadcasts`
> directly and the column is never added.

## Motivation

`/assets` (`packages/lcyt-web/src/components/AssetsPage.jsx`) is today a
placeholder: six count-tiles, most labelled "Not tracked yet", built on
`SetupCard` but with no item rows. This plan turns it into a real content
library that mirrors the `/setup` hub's card idiom but for **content** rather
than **infrastructure**.

### Setup vs. Assets

The page now exposes the new filter pills (`All`, `Reusable`, `Produced`) above the card groups so the content library can be browsed by asset type without losing the section labels for reusable/produced/not-tracked-yet assets.

The dividing line, stated by the project owner:

- **Setup** = anything infrastructural that every broadcast needs in a broadly
  similar form — cameras, mixers, encoders, bridges, egress/ingestion, STT,
  storage, AI models, connectors, caption targets, languages. Already built as
  `SetupHubPage` cards (`/setup`).
- **Assets** = the actual video **content** a project produces and reuses —
  graphics, cues, actions, caption files, translations, past broadcasts, and
  (future) stored videos/thumbnails.

Within Assets there is a secondary distinction worth carrying into the layout:

- **Reusable / global assets** — defined once, used across any broadcast:
  Graphics templates, **Global cues**, **Global actions**, Icons.
- **Produced / per-broadcast assets** — outputs a specific broadcast generated:
  Caption/rundown files, completed translations (which are just caption files
  with a `lang`), and the Broadcasts (session history) records themselves.

## UI pattern (reused, not new)

The Assets page reuses the exact primitives from `packages/lcyt-web/src/components/setup-hub/`:

- **`SetupCard`** — colored icon box, title + one-line description, an optional
  status pill, a **header action button in the top-right corner** (the "edit"/
  "add"/"manage" affordance the owner described), an always-visible body of item
  rows, and an optional footer link. Also supports a dashed `placeholder`
  variant for "no backend yet" cards.
- **`SetupItemRow`** — one asset per row: name + meta on the left, optional
  badge/status dot/toggle, and per-row settings (pencil) / delete icon buttons
  on the right. Rows are clickable to edit.

No new card component is needed. If any styling divergence from `/setup` is
wanted later (e.g. thumbnail previews for Icons/Graphics), it can be added to
`SetupItemRow` behind a prop without forking the component.

## Asset inventory (traced to backing store + editor)

| Card | Group | Backing store | List endpoint | Editor / target | Real data v1? |
|---|---|---|---|---|---|
| **Graphics** | Reusable | `dsk_templates` | `GET /dsk/:key/templates` | `/graphics/editor` | ✅ |
| **Global cues** | Reusable | `cue_rules` | `GET /cues/rules` | cue rule dialog | ✅ |
| **Global actions** | Reusable | `action_defs` | actions route | Named-actions dialog (already on page) | ✅ |
| **Icons** | Reusable | `icons` | icons route | `/setup/icons` | ✅ |
| **Caption / rundown files** | Produced | `caption_files` | `GET /file` | `/captions` | ✅ (a translation is a file with a `lang` badge — decision 2) |
| **Broadcasts** | Produced | `broadcasts` | `GET /broadcasts` | read-only + Watch-on-YouTube link | ✅ |
| **Stored videos** | Produced | `videos` table (recording pipeline) | `GET /videos` | HLS player | 🔜 backend in `plan_recording_vod.md` (dedicated VOD system) |
| **Thumbnails** | Reusable | `thumbnails` table (DSK render) | `GET /:key/thumbnails` | `/graphics/editor` | 🔜 backend in `plan_asset_backends.md` (thumbnail generation is now part of the graphics pipeline) |
| **Rundowns** | Produced | `caption_files` (`type='rundown'`) | `GET /file?type=rundown` | `/planner` | 🔜 backend in `plan_asset_backends.md` (folds into the Caption/rundown files card) |

> **Update:** the three "placeholder" cards below now have accepted backend
> plans — `plan_asset_backends.md` (Rundowns, Thumbnails) and
> `plan_recording_vod.md` (Stored videos). They ship as dashed placeholders in
> the Assets page v1 per decision 1a, and light up as those plans land. Rundowns
> fold into the existing "Caption / rundown files" card rather than being their
> own card.

Notes from tracing the code:

- **`translation_targets` is Setup, not Assets** — it configures *which*
  languages to translate to (lives in the Setup/Languages area). A *completed
  translation* is a produced `caption_files` row that has a `lang` set. Per
  decision 2 below, these are **not** a separate card; they surface as a
  language badge on rows in the Caption/rundown files card.
- **No VOD / stored-video backend exists.** Every `.mp4`/`.ts`/`.m4s` reference
  in `lcyt-rtmp` is a *live* fMP4/HLS segment; the worker-daemon's S3 upload is
  transient streaming output, not a persisted video library. "Stored videos" is
  therefore a placeholder until a VOD store is designed.
- **Rundowns have no backend store** (planner data is client-side). Placeholder
  for now; a future rundown store could reuse `caption_files.type`.

## Decisions (locked)

1. **Un-backed types → placeholder cards now (1a).** Ship the six real cards;
   render Stored videos, Thumbnails, Rundowns as dashed `placeholder` cards so
   the user knows they exist without fabricating data.
2. **Completed translations → folded into Caption files (2b).** One "Caption /
   rundown files" card; each row shows a language badge. No separate
   translations card and no new endpoint.
3. **Broadcasts → read-only history (3a)** with a **link out to YouTube** for
   the cast(s) the session produced.

## The one backend addition: YouTube link on Broadcasts

The watch link is **not derivable from what we store today.** `session_stats`
has no YouTube identifier; the broadcast's watch id
(`selectedBroadcast.id` → `https://www.youtube.com/watch?v=<id>`) currently
lives only client-side in `packages/lcyt-web/src/components/broadcast/YouTubeTab.jsx`
and is never persisted. Linking Broadcasts → YouTube therefore requires a small,
contained backend change (the only backend work in v1):

1. **Schema (additive migration, `packages/lcyt-backend/src/db/schema.js`):**
   add `youtube_video_ids TEXT` to `session_stats` — a JSON array, because in
   target-array mode a single session can drive multiple YouTube casts
   ("cast(s)").
2. **Capture:** the client already knows the selected broadcast id(s). Plumb
   them to the session-end write path (via the session `data` blob / the
   `POST /live` targets, or a dedicated field) so `writeSessionStats`
   (`packages/lcyt-backend/src/db/stats.js`) persists the JSON array. Follow the
   backend DB-access convention — the write/read helpers live in
   `src/db/stats.js`, not inline in the route.
3. **Read:** `getKeyStats` (`src/db/stats.js`) selects and JSON-parses
   `youtube_video_ids` into each session row returned by `GET /stats`.
4. **Render:** the Broadcasts card renders one "Watch on YouTube ▶" link per id
   (`https://www.youtube.com/watch?v=<id>`); rows with no id just omit the link
   (older sessions, non-YouTube broadcasts).

## Page layout

```
Assets
  [All] [Reusable] [Produced]
  Reusable
    [Graphics]         [Global cues]      [Global actions]   [Icons]
  Produced
    [Caption / rundown files]             [Broadcasts]
  Not tracked yet
    [Stored videos]    [Thumbnails]       [Rundowns]   (dashed placeholders)
```

Same `repeat(auto-fill, minmax(340px, 1fr))` grid as `/setup`. The filter pills
(`All`, `Reusable`, `Produced`) sit above the card groups and switch which cards
are shown; the group headings ("Reusable" / "Produced" / "Not tracked yet")
remain lightweight section labels above the visible cards.

## Implementation steps

1. **Backend (YouTube link only):** schema migration + `stats.js` write/read
   helpers + capture path (steps 1–3 above). Small.
2. **Frontend cards:** rewrite `AssetsPage.jsx` to render the card set above:
   - Graphics / Global cues / Global actions / Icons: reuse each type's existing
     manager component embedded in a `SetupCard` (same `embedded` + `ref`
     imperative-`openAdd` pattern as `CameraSection`), or a thin fetch → rows
     list where no manager exists yet.
   - Caption/rundown files: fetch `GET /file`, render rows with size + `lang`
     badge; row click → `/captions` (or download).
   - Broadcasts: fetch `GET /stats`, render read-only rows (date, duration,
     captions sent/failed) + per-id Watch-on-YouTube link.
   - Placeholder cards for Stored videos / Thumbnails / Rundowns.
3. **Keep** `NamedActionsManager` (now surfaced as the **Global actions** card).
4. **Tests:** component test for `AssetsPage` card rendering + the `stats.js`
   YouTube-ids round-trip (node:test), following existing patterns.

## Cross-plan alignment

`plan_ai_roles_framework.md` already anticipates this surface: it specs an
**Asset Control Assistant** (`asset_control_assistant`) scoped to the Assets
page with `asset.upload` / `asset.update` / `asset.delete` tools, driving the
same dialogs this page exposes. Building the cards here gives that assistant its
target UI. No dependency in the reverse direction — this page ships without the
assistant.

## Out of scope (v1)

- A VOD / stored-video store (Stored videos stays a placeholder).
- A rundown backend store (Rundowns stays a placeholder).
- Editing/renaming/tagging past broadcasts (read-only per decision 3a).
- The Asset Control Assistant chat panel (tracked in `plan_ai_roles_framework.md`).
