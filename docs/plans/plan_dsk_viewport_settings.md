# DSK Viewport Display Settings — UI-Based Configuration + RTMP Colorkey

**Status:** pending
**Scope:** `packages/plugins/lcyt-dsk` (schema, routes, renderer), `packages/lcyt-web` (`DskPage`, `DskViewportsPage`), `packages/plugins/lcyt-rtmp` (`RtmpRelayManager`, `routes/dsk-rtmp` consumer side)

## Problem

Configuring a DSK display today means **URL building**: `/dsk/:key?server=…&bg=…&cc=1&viewport=…`. The choices an operator makes in `DskViewportsPage`'s "present" flow (background, transparency) are ephemeral query params — nothing is persisted, so every browser/OBS/HDMI endpoint needs a hand-crafted URL, and changing a setting means redistributing URLs to every display.

Decisions taken (2026-07-11, with the project owner):
1. Display settings **bind to the viewport entity** — the viewport already *is* the per-display concept and `DskPage` already fetches `/dsk/:key/viewports/public` when `?viewport=` is set. No new entity.
2. Persisted settings: **background**, **CC burn-in + styling**, **renderer/stream binding**. (Per-viewport default animations: not now.)
3. The **ffmpeg colorkey** option for the RTMP DSK composite is part of this plan as its own phase — it makes external RTMP pushes and the renderer→RTMP path work as *keyed* overlays instead of full-frame takeover (today the composite is a plain `overlay=0:0:shortest=1`; no chroma-key exists anywhere in the codebase).

## Phase 1 — Schema + API

**`dsk_viewports` additive migration** (`src/db/viewports.js`):
- `display_settings_json TEXT` — one JSON column (mirrors the images `settings_json` pattern):
  ```jsonc
  {
    "background": "#00B140",        // CSS color | "transparent"; default #00B140
    "ccMode": false,                 // caption burn-in
    "ccStyle": {                     // optional; only when ccMode
      "fontSize": 32, "position": "bottom", "color": "#fff", "background": "rgba(0,0,0,0.6)"
    },
    "chromaKey": {                   // Phase 5 consumer (RTMP composite keying)
      "enabled": false, "color": "#00B140", "similarity": 0.3, "blend": 0.1
    }
  }
  ```
- `is_stream_source INTEGER NOT NULL DEFAULT 0` — own column (not JSON) so the invariant is enforceable: **at most one stream-source viewport per api_key**; setting it clears the flag on siblings in the same transaction.
- `upsertViewport()` accepts `displaySettings` + `isStreamSource`; `listViewports`/`getViewport` return them parsed.

**Routes** (`routes/dsk-viewports.js`, `routes/dsk.js`):
- Authed CRUD passes both fields through.
- `GET /dsk/:key/viewports/public` adds `displaySettings` to each row (public — it only contains presentation values). `isStreamSource` stays authed-only.
- Cache: the public endpoint currently serves `Cache-Control: public, max-age=3600`. Settings edits must reach displays without an hour's wait → drop to `max-age=60, stale-while-revalidate=300`. (Displays re-fetch on the SSE `reload` event too; the templates router's broadcast of `reload` on viewport save is a cheap addition — include it.)

**Tests:** db helpers (upsert round-trip, sibling-clear invariant), public route shape, cache header.

## Phase 2 — `DskPage` consumes persisted settings

When `?viewport=` is present, apply the fetched `displaySettings` with **URL params as explicit overrides**:

| Setting | Precedence |
|---|---|
| Background | `?bg=` param → `displaySettings.background` → `#00B140` |
| CC burn-in | `?cc=1` forces on, `?cc=0` forces off → `displaySettings.ccMode` → off |
| CC styling | `displaySettings.ccStyle` (no URL equivalent today; none added) |

The Display URL for a configured viewport collapses to `/dsk/:key?viewport=name` (plus `?server=` only when the page is served from a different origin than the backend — the existing auto-resolution already covers app.lcyt.fi→api.lcyt.fi and same-origin deployments).

**Tests:** Vitest — precedence matrix (param beats persisted beats default, `cc=0` force-off), ccStyle application.

## Phase 3 — `DskViewportsPage` UI

Per-viewport settings section (server-persisted via the existing authed viewport CRUD):
- Background: chroma-green preset / transparent / custom hex swatch.
- CC burn-in toggle; when on, the basic styling fields (font size, position top/bottom, text/background color).
- "Use as stream source" toggle (radio-like across viewports — reflects the Phase 1 invariant).
- Display URL block simplified to the short form; the existing "present" overrides stay for one-off cases.
- i18n: en/fi/sv keys.

**Tests:** component-level where cheap; the page is currently untested — do not block the phase on building a full harness, but cover the settings→PUT payload mapping.

## Phase 4 — Renderer/stream binding

Today `POST /dsk/:key/renderer/start` captures the active template at a hard-coded 1920×1080 (`_getOrCreatePage` → `setViewportSize`). With a stream-source viewport bound:
- `renderer/start` resolves the key's `is_stream_source` viewport and uses its `width`/`height` for `setViewportSize` and as the template-dimension fallback; no bound viewport → current behavior (1920×1080).
- `getStatus(apiKey)` reports the bound viewport name; the control UI (`DskControlPage`/viewports page) shows which viewport feeds the stream.
- When the bound viewport's `background` is set and the template itself has none, the renderer substitutes it — with one twist for Phase 5: if the background is `transparent` **and** chroma-keying is enabled, the renderer renders against the configured key color instead (transparency does not survive h264; the key color is what the relay then keys out).

**Deferred design note (logged, not built):** the deeper unification is for the renderer to capture the actual `/dsk/:key?viewport=X` page instead of `renderTemplateToHtml` — server stream output would then be pixel-identical to what browser displays show (images + text layers + animations, not just template layers). It requires the SPA to be reachable from the renderer (STATIC_DIR or a bundled page) and is a separate plan if wanted.

## Phase 5 — Colorkey for the RTMP DSK composite

`RtmpRelayManager.start()`'s DSK-RTMP branch gains optional keying:
- `setDskRtmpSource(apiKey, rtmpUrl, { chromaKey })` — when `chromaKey.enabled`, the filter becomes
  `[1:v]colorkey=<color>:<similarity>:<blend>[keyed];[0:v][keyed]overlay=0:0:shortest=1[ovout]`
  (re-encode via `libx264` is already the case in this mode; no new cost).
- Config source: the stream-source viewport's `displaySettings.chromaKey` (single source of truth for both our renderer's pushes and external OBS pushes to `rtmp://server/dsk/<key>`). `routes/dsk-rtmp.js`'s `on_publish` loads it and passes it through; no chromaKey config → exact current behavior (opaque full-frame).
- Static-image overlay path is untouched (PNG alpha already works there).

**Tests:** rtmp-manager arg-construction tests for keyed vs unkeyed composite; dsk-rtmp route test that the viewport config reaches `setDskRtmpSource`.

## Compatibility

Everything is additive: existing display URLs with explicit params behave exactly as before (params win); viewports without settings render with today's defaults; relays without chromaKey config composite exactly as today; the renderer without a bound viewport keeps 1920×1080.

## Out of scope

- Per-viewport default animations (deliberately dropped).
- Per-device settings via production device roles (possible phase 2 of the display story).
- Renderer capturing the real DskPage (deferred design note in Phase 4).
- A `url`/iframe template layer type ("web page as DSK input") — separate feature, not planned here.
