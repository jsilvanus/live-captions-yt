# DSK Viewports v2 â€” Slug URLs, UI-Based Display Settings, Multi-Renderer Streaming, RTMP Colorkey

**Status:** implemented (Phases 1â€“5) â€” project slugs (`api_keys.public_slug`, `project_slug_policy`),
viewport display settings (`display_settings_json`), per-viewport multi-renderer streams
(`renderer.js`'s `startViewportStream`/`stopViewportStream`/`listViewportStreams`), and RTMP
colorkey compositing (`buildDskCompositeFilter` in `lcyt-rtmp/src/rtmp-manager.js`) are all present
in code, verified 2026-07-20. Phase 4/5's live browser+ffmpeg capture path was flagged in-plan as
needing manual validation beyond the unit-tested pure helpers â€” that caveat is unchanged, but all
five phases' code is shipped, so "in-progress (Phases 1â€“3)" was stale against this file's own
per-phase âœ… headings below.
**Scope:** `packages/lcyt-backend` (api_keys slug, org slug policy, routes), `packages/plugins/lcyt-dsk` (schema, routes, renderer), `packages/lcyt-web` (`DskPage`, `DskViewportsPage`, `ProjectSettingsPage`), `packages/plugins/lcyt-rtmp` (`RtmpRelayManager` colorkey)

## Problem

Three intertwined issues with the DSK display story:

1. **URL building**: configuring a display means hand-crafting `/api/v1/dsk/api/v1/:apikey?server=â€¦&bg=â€¦&cc=1&viewport=â€¦`. Settings are ephemeral query params; changing one means redistributing URLs to every endpoint.
2. **apiKey in user-facing URLs**: the raw API key appears in every public DSK URL (and is pasted into OBS configs, sent to volunteers' browsers, shown on screen when debugging). The project owner wants apiKey transitioned to an internal credential, replaced user-facing by user-defined slugs.
3. **Single renderer**: the server-side renderer is one page per API key at hard-coded 1920Ã—1080 â€” you cannot broadcast a vertical and a landscape output simultaneously with separately scoped graphics.

Decisions taken (2026-07-11, with the project owner):
- Display settings bind to the **viewport entity** (no new profile/device entity).
- Persisted settings: **background**, **CC burn-in + styling**, **stream binding** (not per-viewport default animations).
- Public URL shape: **`/api/v1/dsk/api/v1/:projectSlug/api/v1/:viewport`** (two segments; viewport names are already user-chosen and unique per project).
- Slug infrastructure is **project-level and global** (on `api_keys`), with project-settings UI ("check availability" + set); **org/api/v1/team prefix rules** enforceable by admins. Only DSK surfaces migrate in this plan; `/api/v1/video`, `/api/v1/radio`, `/api/v1/preview`, `/api/v1/stream-hls` follow in a later plan.
- Multiple renderers: per-viewport streams, one may **composite** onto the main program relay, others are **standalone**, and each streaming viewport can configure its **own outbound RTMP push targets**.
- ffmpeg **colorkey** for the RTMP DSK composite is included as its own phase.

## Phase 1 â€” Project public slug + org slug policy âœ… (implemented 2026-07-11)

**Schema (`lcyt-backend`):**
- `api_keys.public_slug TEXT UNIQUE` (nullable â€” unset means "slug URLs not yet enabled for this project").
- Validation: `^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$` (3â€“40 chars, lowercase, no leading/trailing/double dash), plus a reserved-word blocklist (`events`, `images`, `viewports`, `templates`, `template`, `broadcast`, `renderer`, `public`, `admin`, `api` â€¦) so slugs can never collide with route segments.
- **Org prefix policy** (the "team1-" rule): organizations already have a unique `slug` column â€” reuse it as the team namespace rather than inventing a separate team-slug concept. New org column `project_slug_policy TEXT NOT NULL DEFAULT 'none'` (`'none' | 'prefix'`). When `'prefix'`, any project belonging to that org must have `public_slug` starting with `<org.slug>-`. Set via the existing `PATCH /orgs/:id` (owner/admin); site admin (`X-Admin-Key`) can set any slug on any project regardless of policy.

**Routes (`lcyt-backend`, thin handlers + `src/db/keys.js` helpers per repo convention):**
- `GET  /keys/:key/slug` â€” current slug + the policy-derived required prefix, if any (user Bearer).
- `PUT  /keys/:key/slug { slug }` â€” validate + enforce org policy + uniqueness (user Bearer, project owner/admin).
- `GET  /slugs/check?slug=â€¦` â€” `{ available, reason? }` availability probe for the UI (user Bearer; also validates format/reserved/prefix so the UI shows *why* not just *no*).

**UI (`ProjectSettingsPage` Summary tab):** slug field with live availability check, required-prefix hint when org policy applies, and a URL preview (`/api/v1/dsk/api/v1/<slug>/api/v1/<viewport>`).

**Tests:** validation matrix (format, reserved, prefix policy, uniqueness), route auth, admin bypass.

## Phase 2 â€” DSK public surfaces on slugs âœ… (implemented 2026-07-11)

- Backend DSK public routes gain slug resolution: `/api/v1/dsk/api/v1/:slugOrKey/api/v1/events`, `/api/v1/dsk/api/v1/:slugOrKey/api/v1/images`, `/api/v1/dsk/api/v1/:slugOrKey/api/v1/viewports/api/v1/public` resolve `public_slug` **first**, then fall back to treating the segment as an apiKey (deprecated but working â€” nothing breaks). One shared `resolveDskKey(db, segment)` helper in `lcyt-dsk`.
- SPA display route becomes path-shaped: `/api/v1/dsk/api/v1/:slugOrKey/api/v1/:viewport` (wouter route added alongside the legacy `/api/v1/dsk/api/v1/:apikey?viewport=` query form).
- `DskViewportsPage` URL builders emit the slug form when a slug is set; when unset, they show the apiKey form with a "set a project slug" nudge linking to project settings.
- Viewport-name validation gains the same reserved-word blocklist (a viewport literally named `events` would shadow the SSE route).

**Tests:** slug-first/key-fallback resolution, reserved viewport names rejected, SPA route param parsing.

## Phase 3 â€” Viewport display settings (schema â†’ page â†’ UI) âœ… (implemented 2026-07-11)

> Implemented: `dsk_viewports.display_settings_json` (background, ccMode, ccStyle â€” the `stream` sub-object is deferred to Phase 4/5 where the renderer consumes it, rather than adding an unread invariant now); `sanitizeDisplaySettings()` whitelist/clamp; POST/PUT `displaySettings` with coalescing (text-layers and display-settings edits don't clobber each other; `null` clears); public endpoint returns `displaySettings`; `DskPage` precedence (param â†’ persisted â†’ default) with `ccStyle` applied to burn-in; `DisplaySettingsEditor` UI in `DskViewportsPage`. Also registered `dsk-slug-routes.test.js` in the package's `test/index.js` (Phase 2's tests weren't being run by `npm test`).

**`dsk_viewports` additive migration:**
- `display_settings_json TEXT`:
  ```jsonc
  {
    "background": "#00B140",          // CSS color | "transparent"
    "ccMode": false,
    "ccStyle": { "fontSize": 32, "position": "bottom", "color": "#fff", "background": "rgba(0,0,0,0.6)" },
    "stream": {                        // Phase 4/5 consumer
      "enabled": false,
      "mode": "standalone",           // "composite" (program DSK) | "standalone"
      "pushUrls": [{ "url": "rtmp://â€¦", "enabled": true }],
      "chromaKey": { "enabled": false, "color": "#00B140", "similarity": 0.3, "blend": 0.1 }
    }
  }
  ```
- Invariant enforced on write: **at most one viewport per api_key with `stream.mode === 'composite'`** (transactionally clears siblings). This replaces the earlier single `is_stream_source` flag design â€” composite-ness is the exclusive bit; any number of standalone streaming viewports is fine.

**`DskPage` consumption** â€” with a viewport resolved, persisted settings apply with URL params as explicit overrides:

| Setting | Precedence |
|---|---|
| Background | `?bg=` â†’ `displaySettings.background` â†’ `#00B140` |
| CC burn-in | `?cc=1` forces on, `?cc=0` forces off â†’ `ccMode` â†’ off |
| CC styling | `ccStyle` (no URL equivalent) |

**Public viewports endpoint** returns `displaySettings` minus `stream.pushUrls` (outbound URLs may embed stream keys â€” never expose them publicly); cache drops from `max-age=3600` to `max-age=60, stale-while-revalidate=300`, and viewport saves broadcast the existing SSE `reload` event.

**`DskViewportsPage` UI:** per-viewport settings editor â€” background swatches (chroma green / transparent / custom hex), CC toggle + styling fields; Display URL block shows the short slug form. i18n en/fi/sv.

**Tests:** db round-trip + composite invariant, public shape (pushUrls stripped), DskPage precedence matrix (Vitest), cache header.

## Phase 4 â€” Multi-renderer: per-viewport streams with scoped graphics âœ… (implemented 2026-07-11; renderer capture needs live validation)

> **Done (testable backend core):** `stream` config in `display_settings_json` (`sanitizeStreamConfig`: enabled/mode/pushUrls/chromaKey, rtmp-only push URLs, clamped); the single-`composite` invariant (`demoteOtherCompositeViewports`); `publicDisplaySettings()` strips the whole `stream` object from `/viewports/public` (pushUrls carry secrets); the `<key>__<viewport>` RTMP naming convention (`src/stream-names.js`) with composite-exclusion in `routes/dsk-rtmp.js` (viewport streams never restart the program relay); `__` barred from viewport names.
> **Renderer increment implemented 2026-07-11 (pure helpers tested; Chromium/api/v1/ffmpeg wiring needs live validation):** `src/api/v1/renderer-helpers.js` â€” `viewportPageUrl`, `resolveCaptureDimensions`, `resolveCaptureBackground` (transparent + chromaKey â†’ key color; else black + warning), `buildViewportOutputs` (local `<key>__<viewport>` leg + enabled rtmp push targets â†’ ffmpeg tee), all unit-tested. `renderer.js` gains `startViewportStream`/api/v1/`stopViewportStream`/api/v1/`listViewportStreams` keyed by `<apiKey>::<viewport>` (own Chromium page capturing `/api/v1/dsk/api/v1/<slug>/api/v1/<viewport>` â†’ tee output), alongside the untouched legacy per-key template renderer; the Chromium-crash recovery replays viewport streams with their original opts. `renderer/api/v1/start|stop` accept `{ viewport? }`; `getStatus` reports `viewportStreams`. Viewports-page Streaming section gains Start/api/v1/Stop controls. The actual page-capture + ffmpeg spawn are integration-only and need a live browser + ffmpeg + RTMP + served SPA to confirm end-to-end.

Today `renderer.js` keys everything by apiKey (one Chromium page, template HTML, hard-coded 1920Ã—1080, one ffmpeg). To broadcast vertical + landscape simultaneously *with separately scoped graphics*, per-viewport streams render **the actual display page**, not template HTML â€” that is what makes the graphics scoping real, since `/api/v1/dsk/api/v1/:slug/api/v1/:viewport` already shows exactly that viewport's image set, text layers, and CC per its settings.

- **Renderer re-keyed** by `(apiKey, viewportName)`: `_keys` map key becomes `${apiKey}::${viewport}`; each streaming viewport gets its own page sized from the viewport's `width`/`height`, loading `${DSK_PAGE_BASE_URL}/dsk/<slug>/<viewport>` (new env `DSK_PAGE_BASE_URL`; defaults to `DSK_LOCAL_SERVER`, which works when the backend serves the SPA via `STATIC_DIR` â€” documented requirement).
- Background coherence: if the viewport background is `transparent` and chromaKey is enabled, the capture renders against the key color (alpha does not survive h264); plain `transparent` without keying renders black with a UI warning.
- **RTMP naming:** each viewport stream publishes to the `dsk` app as `<apiKey>__<viewportName>`. The composite trigger in `routes/dsk-rtmp.js` fires **only** for bare-key (or ingest-key) publishes â€” `__`-suffixed standalone streams never restart the program relay.
- **Push targets:** the capture ffmpeg uses the tee muxer (`_buildTeeTargets` pattern from `lcyt-rtmp`) â€” local `dsk` path plus each enabled `pushUrls` entry, so vertical can go straight to a TikTok/YouTube-vertical ingest without a relay slot. Per-target failures log; the local leg is authoritative.
- **Output dimensions:** a viewport stream may now carry `stream.outputDimensions` to override the streamed frame size separately from the viewport's input width/height (e.g. a 1920Ã—1080 canvas can be output as 1080Ã—1920 for an RTMP vertical clip). If omitted, the renderer uses the viewport's configured dimensions as before.
- **Legacy path preserved:** the per-key template renderer (`updateTemplate` â†’ template HTML â†’ composite) keeps working unchanged for existing users; the composite-mode viewport may use either the legacy template mode or page-capture mode (config flag), with template mode the default until page capture proves out.
- **Routes:** `POST /dsk/:apikey/renderer/start|stop` gain `{ viewport? }` (absent = legacy behavior); `GET /dsk/:apikey/renderer/status` returns all running `(viewport, rtmpUrl, pushTargets, uptime)` entries.
- **UI:** per-viewport Stream section in `DskViewportsPage` â€” enable, mode (composite radio-exclusive / standalone), push URL list, start/stop, live status.

**Tests:** renderer map keying + dimension resolution, `__` name parsing and composite-trigger exclusion in dsk-rtmp routes, tee target construction, status shape.

## Phase 5 â€” Colorkey for the RTMP DSK composite âœ… (implemented 2026-07-11)

> Implemented: `buildDskCompositeFilter(chromaKey)` (exported from `lcyt-rtmp/src/rtmp-manager.js`) â€” plain opaque overlay when disabled, `[1:v]colorkey=<color>:<sim>:<blend>[keyed];[0:v][keyed]overlay=â€¦` when enabled (hexâ†’`0x`, non-hex colors stripped to alnum so no filter-graph injection, sim/blend clamped 0â€“1). `setDskRtmpSource(apiKey, rtmpUrl, { chromaKey })` stores it; `routes/dsk-rtmp.js` `on_publish` reads the composite viewport's `stream.chromaKey` via `getCompositeChromaKey(db, apiKey)` and passes it through. No chromaKey â†’ today's exact opaque behavior. Config source is the one composite viewport (single-composite invariant from Phase 4). Static-image overlay path untouched. Live keyed-composite behavior needs a real ffmpeg+RTMP run to visually confirm; arg construction is unit-tested.

- `RtmpRelayManager.setDskRtmpSource(apiKey, rtmpUrl, { chromaKey })`: when enabled, the composite filter becomes `[1:v]colorkey=<color>:<similarity>:<blend>[keyed];[0:v][keyed]overlay=0:0:shortest=1[ovout]` (re-encode via libx264 is already the case; no new cost). No config â†’ today's exact opaque full-frame behavior.
- Config source: the composite viewport's `stream.chromaKey` â€” one source of truth for our renderer's pushes *and* external OBS pushes to `rtmp://server/dsk/<key>`; `routes/dsk-rtmp.js` `on_publish` loads it and passes it through.
- Static-image overlay path untouched (PNG alpha already works).

**Tests:** ffmpeg arg construction keyed vs unkeyed; on_publish passes viewport config through.

## Compatibility

Everything is additive. ApiKey-based DSK URLs keep working (slug resolution falls back); unset slugs change nothing; viewports without settings render today's defaults; the single-renderer template path is untouched until a viewport opts into streaming; relays without chromaKey composite exactly as today.

## Out of scope (follow-ups)

- Migrating `/api/v1/video`, `/api/v1/radio`, `/api/v1/preview`, `/api/v1/stream-hls`, viewer embeds, and Android TV deep links to project slugs â€” follow-up plan once the slug infra ships here.
- Per-device display settings via production device roles.
- Retiring the template-HTML renderer in favour of page capture for the composite path (revisit after Phase 4 proves page capture).
- A `url`/iframe template layer type ("web page as DSK input").

