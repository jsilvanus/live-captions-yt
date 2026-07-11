# `packages/plugins/lcyt-dsk` — DSK Graphics Plugin (v0.1.0)

Playwright-based headless Chromium renderer for DSK (Downstream Key) graphics overlays. Manages template rendering, image upload, overlay broadcasting, and RTMP output. Imported by `lcyt-backend` as `lcyt-dsk`.

**Main entry:** `src/api.js`
**Usage in lcyt-backend:**
```js
import { initDskControl, createDskRouters } from 'lcyt-dsk';

const { captionProcessor, stop: stopDsk } = await initDskControl(db, store, relayManager);
const { dskRouter, dskTemplatesRouter, dskViewportsRouter, imagesRouter, dskRtmpRouter } =
  createDskRouters(db, store, auth, relayManager);
app.use('/dsk',      dskRouter);
app.use('/dsk',      dskTemplatesRouter);
app.use('/dsk',      dskViewportsRouter);
app.use('/images',   imagesRouter);
app.use('/dsk-rtmp', dskRtmpRouter);
// Pass backend metacode handoff + captionProcessor to createCaptionsRouter:
// backend metacode: packages/lcyt-backend/src/metacode.js
// DSK graphics processor (plugin): packages/plugins/lcyt-dsk/src/caption-processor.js
app.use('/captions', createCaptionsRouter(store, auth, db, relayManager, captionProcessor));
// In graceful shutdown:
await stopDsk();
```

**Source files (`src/`):**
- `api.js` — `initDskControl(db, store, relayManager)` + `createDskRouters(db, store, auth, relayManager)` → `{ dskRouter, dskTemplatesRouter, dskViewportsRouter, imagesRouter, dskRtmpRouter }`.
- `renderer.js` — `startRenderer()` / `stopRenderer()`. Manages a single persistent headless Chromium instance. Per-key (legacy template path): `updateTemplate()`, `broadcastData()`, `startRtmpStream()`, `stopRtmpStream()`, `getStatus()`. Uses ffmpeg to push frames to nginx-rtmp. **Per-viewport streams (Phase 4):** `startViewportStream()`/`stopViewportStream()`/`listViewportStreams()` keyed by `<apiKey>::<viewport>` — each gets its own Chromium page capturing the real display page `/dsk/<slug>/<viewport>` and encodes to `<key>__<viewport>` on the dsk app plus any push targets (ffmpeg tee), alongside the untouched legacy per-key renderer. Crash recovery replays viewport streams with their stored opts. Pure decision helpers live in `renderer-helpers.js` (tested); the page-capture + ffmpeg spawn are integration-only.
- `renderer-helpers.js` — pure, unit-tested seams of the multi-renderer refactor: `viewportPageUrl` (slug-preferred display-page URL; `DSK_PAGE_BASE_URL` env), `resolveCaptureDimensions`, `resolveCaptureBackground` (transparent+chromaKey → key color, else black+warning — alpha doesn't survive h264), `buildViewportOutputs` (local `<key>__<viewport>` + enabled rtmp push targets → ffmpeg `tee` string).
- `renderer-container.js` — Docker-based renderer: runs the Chromium DSK renderer inside a container (uses `docker/lcyt-dsk-renderer` image).
- `caption-processor.js` — `createDskCaptionProcessor()`. Extracts `<!-- graphics:... -->` and `<!-- graphics[viewport,...]:... -->` metacodes from caption text; emits DSK SSE events; updates RTMP relay overlay. Supports delta mode (`+name`, `-name`) and landscape aliases (`landscape`, `default`, `main`).
- `db.js` — Re-exports from `src/db/`. Migrations for `dsk_templates` table + image columns.
- `db/images.js` — Image CRUD; `deleteAllImages()` exported from main entry.
- `db/dsk-templates.js` — Template CRUD.
- `db/viewports.js` — Viewport CRUD.
- `routes/dsk.js` — Public endpoints: image list, public viewports, SSE events stream. The `:apikey` path segment resolves **public slug first, then raw api_key** (`resolveKey()`, `plan_dsk_viewport_settings` Phase 2) — legacy apiKey URLs keep working; all downstream DB access uses the resolved `row.key`. `GET /:seg/viewports/public` also returns `projectSlug` and now caches for 60s (was 3600s) so display-setting edits propagate quickly.
- `routes/dsk-templates.js` — Authenticated template CRUD + renderer start/stop + broadcast.
- `routes/dsk-viewports.js` — Authenticated viewport CRUD. `RESERVED_VIEWPORT_NAMES` (exported) blocks names that would shadow sibling `/dsk/:seg/*` routes (`events`, `images`, `viewports`, `templates`, `broadcast`, `renderer`, …) since a viewport name becomes the second path segment in `/dsk/:slug/:viewport`. The authed `GET /:apikey/viewports` listing includes `projectSlug` so the Viewports page can build slug-form display URLs. Per-viewport **display settings** (`plan_dsk_viewport_settings` Phase 3) ride in the `display_settings_json` column (`{ background?, ccMode?, ccStyle? }`), whitelisted/clamped by the exported `sanitizeDisplaySettings()`; POST/PUT accept a `displaySettings` field and PUT **coalesces** it against the stored value (a text-layers-only PUT never wipes display settings and vice versa; `null` clears). `GET /:seg/viewports/public` returns `displaySettings` alongside `textLayers`. `DskPage` applies them with URL params as explicit overrides: background `?bg=` → `displaySettings.background` → `#00B140`; CC `?cc=1`/`?cc=0` force on/off → `displaySettings.ccMode` → off; `ccStyle` (fontSize/position/color) has no URL form.
- `routes/images.js` — Image upload (POST), list (GET), update (PUT), serve (GET public), delete (DELETE).
- `routes/dsk-rtmp.js` — `createDskRtmpRouter(db, relayManager)`: nginx-rtmp `on_publish` / `on_publish_done` callbacks. Resolves the incoming stream name through a local `resolveApiKeyFromIngestStreamKey()` (mirrors the one in `lcyt-rtmp`'s `db/relay.js`, duplicated rather than imported since this plugin has no dependency on `lcyt-rtmp`) before treating it as an api_key — see `plan_selfservice_config_backend.md` §2.
- `stream-names.js` — DSK RTMP stream-name convention (`plan_dsk_viewport_settings` Phase 4): `viewportStreamName(key, viewport)` → `<key>__<viewport>`, `parseStreamName()`, `isViewportStream()`. A bare name is the program DSK push (triggers the server-side composite in `routes/dsk-rtmp.js`); a `__`-delimited name is a standalone per-viewport renderer stream and is **excluded** from the composite. Viewport names are validated to exclude `__`.
- `middleware/editor-auth.js` — `createEditorAuth(db)`: accepts `X-API-Key` header (no live session needed). `editorAuthOrBearer(jwtAuth, editorAuth)`: tries X-API-Key first, falls through to JWT Bearer.

**Per-viewport stream config (Phase 4, in `display_settings_json.stream`):** `{ enabled, mode: 'composite'|'standalone', pushUrls: [{ url, enabled }], chromaKey: { enabled, color, similarity, blend } }`, sanitized by `sanitizeStreamConfig` (rtmp(s):// push URLs only, clamped). Invariant: **at most one `composite` viewport per key** — `demoteOtherCompositeViewports()` demotes siblings on write. The `stream` object is **server-only**: `publicDisplaySettings()` strips it (pushUrls can carry stream keys) so `/viewports/public` never exposes it. Renderer consumption (per-viewport Chromium page-capture → `<key>__<viewport>` RTMP + tee push targets) is the remaining, integration-only part of Phase 4.

**DSK caption metacode syntax:**
```
<!-- graphics:logo,banner -->                         all viewports get logo+banner (absolute)
<!-- graphics[vertical-left]:stanza,logo -->          vertical-left gets stanza+logo
<!-- graphics[v1,v2]:stanza -->                       v1 AND v2 both get stanza
<!-- graphics[vertical-right]: -->                    vertical-right gets nothing (cleared)
<!-- graphics:+logo -->                               add logo to currently active set (delta)
<!-- graphics:-banner -->                             remove banner from active set (delta)
<!-- graphics:+logo,-banner -->                       add logo AND remove banner (delta)
```

**DSK SSE events** (on `GET /dsk/:apikey/events`):
- `graphics` — `{ default: string[]|null, viewports: { [name]: string[] }, ts: number }`
- `bindings` — `{ codes: { section?, stanza?, speaker?, ... }, ts: number }`

**Template JSON shape (layers):**
- `type: "text"` — text layer with CSS positioning, font, color
- `type: "rect"` — rectangle/box layer
- `type: "image"` — image layer (references uploaded image by ID)

**Environment variables** (see also `packages/lcyt-backend/CLAUDE.md`):
| Variable | Purpose | Default |
|---|---|---|
| `PLAYWRIGHT_DSK_CHROMIUM` | Path to Chromium binary | Playwright cache location |
| `DSK_LOCAL_SERVER` | Local server URL for renderer to fetch templates | `http://localhost:$PORT` |
| `DSK_PAGE_BASE_URL` | Base URL the renderer loads per-viewport display pages from (`/dsk/<slug>/<viewport>`); requires the SPA to be reachable (e.g. `STATIC_DIR`) | falls back to `DSK_LOCAL_SERVER` |
| `DSK_LOCAL_RTMP` | nginx-rtmp base URL for DSK RTMP output | `rtmp://127.0.0.1:1935` |
| `DSK_RTMP_APP` | RTMP application name for DSK renderer | `live` |

## DSK Graphics System

- **Templates** are JSON objects describing a layered HTML page (background, layers with text/rect/image types).
- The **renderer** (`src/renderer.js`) holds a single persistent Chromium instance; per-key pages are rendered and optionally streamed to nginx-rtmp via ffmpeg.
- **Caption metacodes** (`<!-- graphics:... -->`) in caption text are intercepted by `captionProcessor` before delivery, triggering SSE events to connected DSK overlay pages.
- **Viewports** define named display regions (e.g. `vertical-left`, `landscape`). The default landscape display is aliased as `landscape`, `default`, or `main`.
- **Delta mode** (`+name`, `-name` prefixes) lets captions add/remove individual graphic elements without replacing the full active set.

---

The `graphics` metacode stays inside this plugin's own `caption-processor.js` — see root `CLAUDE.md`'s Metacode Organization note for how it fits with the `cue` metacode (`lcyt-cues`) and the frontend parser (`lcyt-web`).
