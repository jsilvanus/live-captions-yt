---
status: pending
summary: "Concrete, atomic implementation plan for ROADMAP.md's Tier 3 (small, independent gap-closers). Seven items, each scoped to file-level steps grounded in the current codebase (not just the plan-file summaries), with two corrections to ROADMAP's package attributions and one already-satisfied sub-item flagged as done. Organised as seven independent lanes plus one item that needs a scope decision before dispatch."
---

# Tier 3 Implementation Plan

Source: `docs/plans/ROADMAP.md` Tier 3 table. This document turns each row into
concrete file-level steps, verified against the current source tree on
2026-07-18 (not just the referenced plan files, which are occasionally stale —
see the corrections called out per item below).

**Scope discipline:** every lane below stays inside one package (plus at most
one composition-root line in `lcyt-backend/src/server.js` where a new route
needs mounting). Per ROADMAP §0: if a lane's steps touch a `package.json`,
diff-review the `exports` map before merging — only add entries, never replace
existing ones.

---

## Corrections to ROADMAP's Tier 3 table

Two of the seven rows point at the wrong package/location, and one is already
done. Fixing these before dispatch avoids agents searching the wrong files:

1. **HLS master-manifest `BANDWIDTH`/`CODECS`** — ROADMAP attributes this to
   "`lcyt-rtmp` (`hls-sidecar`/manifest generation)". The hard-coded
   `#EXT-X-STREAM-INF` line actually lives in
   `packages/lcyt-backend/src/routes/video.js` (`buildMasterManifest()`,
   line 158). `lcyt-rtmp`'s `hls-manager.js` is still involved (it owns the
   running ffmpeg/MediaMTX process the values describe), but the manifest
   string itself is a `lcyt-backend` file. See Item 6 below.
2. **Admin Phase 3 "live-stats dashboard"** — already implemented, by
   `plan_metering_audit.md`, not part of `plan_admin.md`. `GET
   /admin/metrics/live` (`packages/lcyt-backend/src/routes/metrics.js`) +
   `AdminMetricsPage.jsx` (5s poll) already ship this. Item 3 below is
   rescoped to just the two genuinely-outstanding Phase 3 checkboxes:
   role-tiered admin access and confirmation dialogs.
3. **YouTube stream-status polling "auth approach"** — already resolved by
   existing code, not an open question. `packages/lcyt-web/src/lib/youtubeAuth.js`
   (GIS OAuth2 token client) and `lib/youtubeApi.js` (`listScheduledBroadcasts`,
   `getLiveStream`, `transitionBroadcast`) already implement the
   browser-side-OAuth approach `plan_client.md` flagged as an open question.
   The actual gap is narrower: `YouTubeTab.jsx` only refreshes broadcast
   status on manual "↻ Refresh" clicks or after a transition action — there is
   no interval poll. See Item 5.

---

## Suggested parallel dispatch

All seven lanes below are file-disjoint and can run as separate agents
simultaneously (subject to the ROADMAP §0 caveats — verify `isolation:
"worktree"` actually took, diff-review any `package.json` change):

| Lane | Package(s) | Item | Needs a decision first? |
|---|---|---|---|
| 1 | `lcyt-rtmp` + `lcyt-files` | HLS `putObject`/`publicUrl` wiring | No |
| 2a | `lcyt-web` (DSK editor + shared layer schema) | DSK rotation handle | No |
| 2b | `lcyt-web` (DSK editor) | DSK snap-grid ruler overlay | No — can run alongside 2a, same file but non-overlapping regions (see Item 2 note) |
| 3 | `lcyt-backend` + `lcyt-web` admin | Admin role tiers + confirm dialogs | No |
| 4 | `lcyt-backend` + `lcyt-web` | Device role Phase 4 (scoped subset) | **Yes — see Item 4**, confirm scope before dispatch |
| 5 | `lcyt-web` | YouTube stream-status polling | No |
| 6 | `lcyt-backend` + `lcyt-rtmp` | HLS ffprobe `BANDWIDTH`/`CODECS` | No |
| 7 | `lcyt-files` | S3 adapter tests (mock HTTP server) | No — recommendation made below, flag if you want localstack instead |

Do not combine Lane 2a and 2b into one agent dispatch if running two agents —
they touch overlapping regions of `TemplatePreview.jsx`/`dskEditorGeometry.js`
and should be sequenced (2a then 2b, or one agent does both) rather than run
as two truly parallel edits to the same file.

---

## Item 1 — Wire `putObject`/`publicUrl` into the HLS manager

**Plan:** `plan_files3.md` §"HLS / Live Stream Storage — Groundwork". Priority: medium.

**Current state:** `packages/plugins/lcyt-files/src/adapters/{local,s3,webdav}.js`
already implement `putObject(apiKey, objectKey, buffer, contentType?)` and
`publicUrl(apiKey, objectKey)` (verified in `s3.js` lines 153–187). Nothing in
`lcyt-rtmp` or `lcyt-backend` calls either method — HLS segments/playlists are
still written straight to local disk by ffmpeg (`HlsManager.start()` in
`packages/plugins/lcyt-rtmp/src/hls-manager.js`, `-f hls out` where `out` is a
local path) or served directly from MediaMTX.

**Steps:**

1. `packages/plugins/lcyt-rtmp/src/hls-manager.js` — add an optional
   `{ resolveStorage }` constructor dependency (mirrors how `lcyt-backend`
   already injects `resolveStorage` into `createStatsRouter`, per
   `plan_files3.md`'s GDPR-erasure section). When absent, behavior is
   unchanged (back-compat default).
2. Add a `publishToStorage(hlsKey, objectKey, filePath, contentType)` private
   helper: reads the local file, calls `storage.putObject(hlsKey, objectKey,
   buffer, contentType)`. Only invoked when `resolveStorage` was injected.
3. Hook it into the local ffmpeg branch of `start()`: since ffmpeg writes
   `index.m3u8` + segment `.ts` files directly to `dir` (line 55–56), add an
   `fs.watch(dir, …)` (or a `chokidar`-free polling loop at a short interval,
   matching this repo's no-extra-deps convention) that pushes each new/changed
   file under `dir` to `putObject()` as it lands, keyed by the file's
   basename as `objectKey` (e.g. `'index.m3u8'`, `'segment003.ts'`). Debounce
   `index.m3u8` writes (it's rewritten every few seconds).
4. Expose `getPublicUrl(hlsKey, objectKey)` on `HlsManager` → delegates to
   `storage.publicUrl()`, returns `null` when no `resolveStorage` was
   injected or the resolved adapter is local (matches the documented "local
   adapter returns null" contract).
5. `packages/lcyt-backend/src/server.js` — thread `resolveStorage` (already
   returned by `initFilesControl(db)`) into the `HlsManager` constructor call
   inside `initRtmpControl`. This is the one composition-root line other
   lanes must not also touch.
6. Tests: `packages/plugins/lcyt-rtmp/test/hls-manager-storage.test.js` (new
   file) — mock `resolveStorage` returning a fake adapter with a spy
   `putObject`; assert segments/playlist get pushed and `getPublicUrl()`
   delegates correctly. Follow this plugin's existing `node:test
   --experimental-test-module-mocks` pattern (see `test/crop-manager.test.js`
   for the mock-worker-daemon style to imitate).
7. Update `packages/plugins/lcyt-rtmp/CLAUDE.md`'s `HlsManager` bullet and
   `packages/plugins/lcyt-files/CLAUDE.md`'s "Not done" note (remove this row
   from `plan_files3.md`'s Remaining/Future Work table, mark done).

**Out of scope for this lane** (leave for later, per `plan_files3.md`'s own
priority list): the `cdn_url` config field, and Item 7's S3 mock tests.

---

## Item 2 — DSK editor: rotation handle + snap-grid visual ruler

**Plan:** `plan_dsk.md` §"Not yet implemented (deferred to Phase 4 or later)".
These are two unrelated additions to the same editor — split into 2a/2b, can
be two separate agents run sequentially (not simultaneously — same files).

### 2a — Rotation handle

**Current state:** no `rotation` field exists anywhere in the layer schema.
Confirmed by grep across `lcyt-web` and `lcyt-dsk` — the template JSON only
has `x`/`y`/`width`/`height`. This is new surface, not a small UI tweak:
rotation must render correctly in three places (editor canvas, server-side
Playwright renderer, live browser overlay page), or a rotated layer will look
right in the editor and wrong on stream.

**Steps:**

1. `packages/lcyt-web/src/lib/dskEditorGeometry.js` — add pure helpers:
   `rotationFromPointerAngle(centerX, centerY, pointerX, pointerY)` (returns
   degrees) and `snapRotation(deg, snapEnabled)` (15° increments when
   snapping, matching the existing `GRID_SIZE`-style toggle pattern at the
   top of this file). Unit-test in `test/dskEditorGeometry.test.js`.
2. `packages/lcyt-web/src/components/dsk-editor/TemplatePreview.jsx` — add a
   9th handle (a small circular handle above the `n` resize handle, offset by
   a fixed pixel distance) to `HANDLE_LIST`-adjacent rendering (don't add
   `'rotate'` to `HANDLE_LIST` itself since that array drives resize-cursor
   logic — render it as a sibling element keyed off the same `layer.id`).
   Wire `onPointerDown` → a new `startRotateDrag(e, layerId)` alongside the
   existing `startHandleDrag`. Apply `transform: rotate(${layer.rotation ??
   0}deg)` to the layer's rendered `div`/`img` style (rotation pivots around
   the shape's own center — use `transformOrigin: 'center center'`).
3. `packages/lcyt-web/src/components/DskEditorPage.jsx` — add `onRotateLayer`
   callback (parallels the existing `onMoveLayer`/`onResizeLayer`), push
   rotation changes onto the existing undo/redo stack the same way moves and
   resizes already do.
4. `packages/lcyt-web/src/components/dsk-editor/LayerPropertyEditor.jsx` —
   add a numeric "Rotation (°)" input as a fallback to dragging (also needed
   for precise values like 90/180).
5. `packages/plugins/lcyt-dsk/src/renderer.js` — `renderTemplateToHtml()`,
   `baseStyle` array (line 132-139): add
   `layer.rotation ? `transform:rotate(${Number(layer.rotation)}deg)` : ''`.
   This is the server-side Playwright RTMP-output render path — skipping it
   means rotated layers work in the editor preview but not on the actual
   overlay stream.
6. `packages/lcyt-web/src/components/DskPage.jsx` — same `transform:rotate()`
   addition to whatever produces the live browser-source overlay's layer
   styles (this is the public `/dsk/:key` page OBS reads as a browser
   source — it has its own layer→CSS logic, separate from `renderer.js`).
7. Tests: extend `test/dskEditorGeometry.test.js` (pure rotation math) and
   `test/components/TemplatePreview.test.jsx` (rotate-handle drag → layer
   rotation update). Add a `renderer.js` unit test asserting the `transform`
   style appears in output HTML when `layer.rotation` is set (mirrors
   existing style-assembly tests for that file, if any exist — check
   `packages/plugins/lcyt-dsk/test/` first).

### 2b — Snap-to-grid visual ruler overlay

**Current state:** snap-to-grid *behavior* is done (`GRID_SIZE = 20` in
`dskEditorGeometry.js`, applied via `gridSnap()`). What's missing is the
*visual* ruler/gridline overlay so the operator can see the grid while
dragging, not just feel the snap.

**Steps:**

1. `packages/lcyt-web/src/components/dsk-editor/TemplatePreview.jsx` — add a
   `showGrid` prop (toggled from the same UI control that already toggles
   `showSafeArea`/`snapGrid`) that renders a repeating-background-image or
   absolutely-positioned line `div`s at `GRID_SIZE`-px intervals across the
   1920×1080 canvas (scaled by the existing 50% display factor — reuse
   whatever scale constant the canvas already applies to layer coordinates,
   don't hardcode 0.5 a second time).
2. `packages/lcyt-web/src/components/DskEditorPage.jsx` — add the toolbar
   toggle button (next to the existing snap-to-grid toggle) and the
   `showGrid` state, persisted the same way other editor UI toggles persist
   (check whether `snapGrid`'s toggle state is component-local or
   localStorage-persisted via `storageKeys.js`, and match it).
3. No renderer/DskPage changes needed — this is editor-canvas-only, it never
   appears in the rendered output.
4. Tests: `test/components/TemplatePreview.test.jsx` — grid renders when
   `showGrid` true, absent when false; line count/spacing matches
   `GRID_SIZE`.

---

## Item 3 — Admin Phase 3: role-tiered access + confirmation dialogs

**Plan:** `plan_admin.md` §"Phase 3 (planned)". Per the correction above, the
live-stats dashboard checkbox is already satisfied elsewhere — this item is
just the two remaining Phase 3 boxes.

### 3a — Role-based admin access (super-admin vs. read-only admin)

**Current state:** `users.is_admin` is a plain boolean
(`packages/lcyt-backend/src/db/schema.js` line 26). `createAdminMiddleware()`
(`packages/lcyt-backend/src/middleware/admin.js`) grants full access to any
`is_admin=1` user or anyone with the legacy `X-Admin-Key` header — there is no
tiering today.

**Steps:**

1. `packages/lcyt-backend/src/db/schema.js` — additive migration following
   the existing pattern (line 203's `is_admin` column add):
   ```js
   if (!existingUserCols.has('admin_role'))
     db.exec("ALTER TABLE users ADD COLUMN admin_role TEXT NOT NULL DEFAULT 'full'");
   ```
   Values: `'full'` (today's behavior — default, so existing admins keep
   full access) or `'readonly'`. Don't invent a third tier without a product
   decision — the plan only asks for two.
2. `packages/lcyt-backend/src/db/users.js` — `getUserById()`'s SELECT
   (line 43) gains `admin_role`; `setUserAdmin()`-equivalent write path gains
   an optional role param.
3. `packages/lcyt-backend/src/middleware/admin.js` — `createAdminMiddleware()`
   sets `req.adminUser = { userId, email, role: user.admin_role }`
   (line 62). The `X-Admin-Key` path (no per-user identity) always resolves
   to `'full'` — it's the legacy superuser bypass, not subject to tiering.
4. New middleware `requireFullAdmin` (same file) — 403s when
   `req.adminUser?.role === 'readonly'`. Apply it to every mutating route in
   `packages/lcyt-backend/src/routes/admin.js` (POST/PATCH/PUT/DELETE) —
   there are roughly 20 such routes per the CLAUDE.md route table; GET routes
   stay open to both roles.
5. `packages/lcyt-backend/src/routes/admin.js` — extend `PATCH
   /admin/users/:id` to accept an `adminRole` field (full/readonly), audit
   logged the same way `is_admin` changes already are.
6. `packages/lcyt-web/src/components/AdminUserDetailPage.jsx` — add an
   "Admin role" select (Full / Read-only) next to wherever `is_admin` is
   currently toggled, gated to only show for users who are already
   `is_admin=1`.
7. `packages/lcyt-web` — any admin page that renders mutating buttons
   (batch actions, delete, feature edits) should hide/disable them when the
   logged-in admin's own role is `readonly` (read from `/auth/me` or
   equivalent — check what the admin pages already use to know they're an
   admin, likely `useUserAuth`).
8. Tests: extend `packages/lcyt-backend/test/admin.test.js` — readonly admin
   gets 403 on mutating routes, 200 on GET routes; `X-Admin-Key` unaffected.

### 3b — Admin action confirmation dialogs

**Current state:** confirmations already exist but are native `confirm()`
popups (`AdminUsersPage.jsx:88`, `AdminProjectsPage.jsx:85`,
`AdminUserDetailPage.jsx:115`, `AdminProjectDetailPage.jsx:108`) — inconsistent
with the rest of the app's styled-modal UI (compare
`ProductionBridgesPage.jsx`'s `DeleteConfirmModal`, which is a real styled
component). Rescope this checkbox as: replace native `confirm()` with a
shared styled dialog, not "add confirmation where none exists."

**Steps:**

1. `packages/lcyt-web/src/components/ConfirmDialog.jsx` (new, shared) —
   generalize `ProductionBridgesPage.jsx`'s `DeleteConfirmModal` pattern into
   a reusable `{ title, message, confirmLabel, danger?, onConfirm, onCancel }`
   component instead of copy-pasting a fourth bespoke modal.
2. Replace the four `confirm(...)` call sites above with the shared
   component + local `useState` for open/pending item, matching each page's
   existing async handler flow (`handleBatch`, `handleDelete`).
3. Tests: component test for `ConfirmDialog.jsx` (render, confirm/cancel
   callbacks, danger styling); no need to re-test the four call sites'
   business logic since that's unchanged, only the confirmation UI.

---

## Item 4 — Device role Phase 4 enhancements

**Plan:** `plan_userprojects.md` §"Phase 4 — Future device role enhancements
(pending)". ROADMAP explicitly flags this row as needing user confirmation of
scope before dispatch, since the plan lists six items without prioritizing
them. Recommendation below; **confirm before assigning to an agent.**

The six listed items split cleanly into "clear backend work, no design
ambiguity" vs. "needs a product/UX decision":

| Item | Ambiguity | Recommended for this pass? |
|---|---|---|
| Device role JWT verification middleware (check `active=1` per request) | None — pure correctness fix, closes a real gap (a deactivated device role's existing token currently still works until TTL/process restart) | **Yes** |
| Time-limited device role sessions (optional expiry field) | Low — additive optional field, off by default | **Yes** |
| Admin CLI `lcyt-backend-admin users features [list\|grant\|revoke]` | None — CLI-only, mirrors existing `users` subcommands | **Yes** |
| Web UI for admin user feature management | Low, but overlaps Item 3's admin UI work — sequence after 3a lands | Maybe, defer to a follow-up lane |
| QR code generation for device PINs | Needs a UX call (where in the flow, what library, print vs. screen) | **No — ask first** |
| Tally light display on camera device role view | Needs a hardware/UX spec (what tally state maps to what visual) — not just "add a light" | **No — ask first** |

**Steps for the three recommended items:**

1. **JWT verification middleware.** `packages/lcyt-backend/src/routes/device-roles.js`
   / wherever device-role JWTs are currently verified for `/production/*`
   device-authenticated routes — find the existing device-JWT auth
   middleware (likely in `middleware/`, parallel to `user-auth.js`), add a
   DB lookup against `db/device-roles.js`'s active-flag check on every
   request, not just at login time. Add a `packages/lcyt-backend/src/db/device-roles.js`
   helper `isDeviceRoleActive(db, code)` if one doesn't already exist.
2. **Time-limited sessions.** `packages/lcyt-backend/src/db/device-roles.js` —
   optional `expires_at` column (additive migration), checked in the same
   middleware as #1. `POST /production/device-roles` gains an optional
   `expiresAt` field. Default remains indefinite (current behavior) when
   omitted — this is opt-in per `plan_userprojects.md`'s stated design
   rationale ("indefinite device session... can be made time-limited later").
3. **Admin CLI.** `packages/lcyt-backend/bin/lcyt-backend-admin` — add `users
   features list|grant|revoke` subcommands mirroring the existing `users
   [list|info|add|...]` subcommand structure in the same file, calling the
   already-implemented `GET/PATCH /admin/users/:id/features` HTTP routes (or
   the underlying DB helpers directly, matching whatever pattern the
   existing `users` subcommands use — check if the CLI calls HTTP or DB
   directly before choosing).
4. Tests: extend `packages/lcyt-backend/test/feature-gate.test.js` or a new
   `device-role-auth.test.js` for the active-check middleware and expiry;
   CLI subcommand tests wherever the existing `users` CLI tests live (if
   any — flag as a gap if not).

---

## Item 5 — YouTube stream-status polling in the web client

**Plan:** `plan_client.md` non-goals note (now stale — see correction above).

**Current state:** `packages/lcyt-web/src/components/broadcast/YouTubeTab.jsx`
already has the full OAuth + broadcast-list + transition machinery
(`lib/youtubeAuth.js`, `lib/youtubeApi.js`). Status (`broadcastStatus`,
`isLive`, `httpCaptionsEnabled`) only updates on manual "↻ Refresh" or after
`handleTransition()`/`handleEnableHttpCaptions()` calls `fetchBroadcasts()`.
There is no interval poll, so if the stream goes live/ends from YouTube
Studio directly (not via this UI), the tab shows stale status indefinitely.

**Steps:**

1. `packages/lcyt-web/src/components/broadcast/YouTubeTab.jsx` — add a
   `useEffect` interval (suggest 15–30s, YouTube API quota is generous enough
   for one key's worth of polling) that calls `fetchBroadcasts(token)` while
   `token` is set and the tab is mounted/visible. Clear on unmount and on
   sign-out (`handleSignOut`).
2. Pause polling when the document is hidden (`document.visibilityState`) to
   avoid burning API quota on backgrounded tabs — check whether any other
   `lcyt-web` component already has a "poll only when visible" helper to
   reuse rather than writing a new one (grep `visibilitychange` across
   `hooks/`/`lib/` first).
3. Optionally surface stream health (not just `lifeCycleStatus`) — `getLiveStream()`
   already exists in `youtubeApi.js` and returns `status.streamStatus`/
   `status.healthStatus` for the bound `liveStreams` resource
   (`contentDetails.boundStreamId` on the broadcast). Add a small health
   badge next to the existing status badge if this is in scope — flag as
   optional/stretch since it's a new API call per poll, not just re-reading
   what's already fetched.
4. No backend changes — this is entirely client-side per the existing
   architecture (`lcyt-backend` only serves `YOUTUBE_CLIENT_ID`, never
   proxies YouTube Data API calls).
5. Tests: `packages/lcyt-web` has no existing component test for
   `YouTubeTab.jsx` — if adding one, follow the Vitest pattern in
   `test/components/useSession.test.jsx` (mock fetch, fake timers for the
   interval). Otherwise this is a reasonable gap to leave documented rather
   than block the feature on new test infrastructure — note it in
   `packages/lcyt-web/CLAUDE.md`'s test gaps list either way.

---

## Item 6 — HLS ffprobe `BANDWIDTH`/`CODECS` detection

**Plan:** `plan_hls_sidecar.md` §"Video CODECS string" / `plan_files3.md`.
Per the correction above, the actual hard-coded values are in
`packages/lcyt-backend/src/routes/video.js`, not `lcyt-rtmp`.

**Current state:** `buildMasterManifest()` (`video.js` line 158) always
emits `BANDWIDTH=2800000,CODECS="avc1.4d401f,mp4a.40.2"` regardless of what's
actually being streamed. The video+audio HLS output is produced either by
MediaMTX directly (no ffmpeg in the hot path, per `hls-manager.js`) or by a
local ffmpeg `-c copy` passthrough (`hls-manager.js` line 56) — either way,
the actual codec/bitrate isn't known to `lcyt-backend` today, only to
whatever encoder the operator's OBS/hardware is running.

**Steps:**

1. `packages/plugins/lcyt-rtmp/src/hls-manager.js` — add
   `async probeStreamInfo(hlsKey)`: runs `ffprobe -v quiet -print_format json
   -show_streams` against the running HLS output (`hlsDir(hlsKey) +
   '/index.m3u8'` for the local-ffmpeg path, or the MediaMTX HLS URL via
   `getInternalHlsUrl(hlsKey)` for the no-local-rtmp path), parses the video
   stream's `codec_name`/`profile`/`level` into an HLS `CODECS` string
   (`avc1.<hex profile+level>` for H.264) and the audio stream's
   `codec_name` (`mp4a.40.2` for AAC-LC — map from `profile` if ffprobe
   reports it, else default). Reuse this repo's existing `spawnSync`
   pattern for shelling out (already imported in this file) rather than
   adding a new subprocess-handling dependency.
2. Cache the probe result per `hlsKey` with a short TTL (e.g. re-probe every
   60s, not on every manifest request — `master.m3u8` can be polled
   frequently by players) and a fallback to today's hard-coded constants if
   `ffprobe` fails or isn't installed (never 500 the manifest route over a
   probe failure — this must degrade gracefully, matching the "hard-coded
   defaults" behavior it's replacing).
3. Compute actual `BANDWIDTH` from the probed video+audio `bit_rate` fields
   (sum, rounded) when available; fall back to `2800000` when ffprobe
   doesn't report bitrate (common for some containers — `format.bit_rate` is
   a reasonable fallback source if `stream.bit_rate` is absent).
4. `packages/lcyt-backend/src/routes/video.js` — `buildMasterManifest()`
   gains an optional `streamInfo` param; `GET /:key/master.m3u8` handler
   (line 226) calls `hlsManager.probeStreamInfo(key)` before building the
   manifest, passes the result through. Keep the hard-coded string as the
   literal fallback value inside `buildMasterManifest` itself so the
   function stays pure/testable without requiring ffprobe in unit tests.
5. Tests: `packages/plugins/lcyt-rtmp/test/hls-manager-probe.test.js` (new) —
   mock `spawnSync` returning canned ffprobe JSON, assert CODECS/BANDWIDTH
   parsing for a few real-world ffprobe output shapes (H.264+AAC, H.265 if
   worth covering, missing bit_rate). Extend `packages/lcyt-backend/test/video.test.js`
   (17 existing tests per CLAUDE.md) with cases for the new `streamInfo`
   param and the fallback-on-missing-probe path.
6. Update `plan_hls_sidecar.md`'s "Not done" note and `docs/PLANS.md`'s
   `plan_hls_sidecar.md` summary row once this lands.

---

## Item 7 — S3 adapter tests against a mock S3

**Plan:** `plan_files3.md` Remaining/Future Work table. ROADMAP flags this as
needing an "infra decision first" (localstack vs. custom mock).

**Recommendation:** custom lightweight HTTP mock, not localstack. Reasoning,
grounded in what's already in the codebase: `createS3Adapter()`
(`packages/plugins/lcyt-files/src/adapters/s3.js` line 29-41) already accepts
an `endpoint` override with `forcePathStyle: true` specifically for
S3-compatible services (R2/MinIO/B2) — the same mechanism trivially points
the adapter at `http://127.0.0.1:<port>` in tests. This repo's whole test
suite is `node:test` with zero external service dependencies (no Docker
compose test fixtures, no localstack anywhere in `ci/` or `docker/`) — adding
localstack would be the first test-time infra dependency in the repo and
needs `ci/test-docker.sh`-style plumbing that doesn't exist for unit tests
today. A custom mock stays consistent with that convention. Flag this
recommendation to the user if they'd rather standardize on localstack for
other reasons (e.g. planned Postgres-style integration-test infra) — this is
a call worth a quick confirmation before dispatch, per ROADMAP's own note.

**Steps (once confirmed):**

1. `packages/plugins/lcyt-files/test/helpers/mock-s3-server.js` (new) — a
   minimal `node:http` server implementing just the S3 REST subset the
   adapter uses: `PUT /:bucket/:key` (store in-memory `Map`), `GET
   /:bucket/:key` (200 + body, or 404), `DELETE /:bucket/:key` (204), `GET
   /:bucket?list-type=2&prefix=...` (XML `ListObjectsV2` response with
   `NextContinuationToken` pagination support, since `listObjects()`
   exercises pagination). Path-style only (matches `forcePathStyle: true`).
   Export `startMockS3()`/`stopMockS3()` returning `{ port, objects }` for
   assertions.
2. `packages/plugins/lcyt-files/test/s3-adapter.test.js` (new) — spin up the
   mock server in a `before()`/`after()`, construct `createS3Adapter({
   bucket: 'test', endpoint: `http://127.0.0.1:${port}`, region: 'us-east-1',
   credentials: { accessKeyId: 'x', secretAccessKey: 'x' } })`, exercise
   every adapter method: `openAppend`/`write`/`close` round-trip,
   `openRead`, `deleteFile`, `putObject`/`publicUrl` (the groundwork methods
   from Item 1 — this test file is a natural place to cover them too, since
   `local-adapter.test.js` already covers the local equivalents),
   `listObjects` pagination (seed >1 page worth of keys, assert
   `ContinuationToken` handling), `describe()`.
3. Mirror `local-adapter.test.js`'s existing test structure/naming so the two
   files read as a matched pair for anyone comparing adapter coverage.
4. Update `packages/plugins/lcyt-files/CLAUDE.md`'s Tests section to list
   the new file, and `plan_files3.md`'s Remaining/Future Work table to mark
   this row done.

---

## Sequencing notes

- Item 1 and Item 6 both touch `hls-manager.js` — if run as separate agents,
  sequence them (Item 1 first, since Item 6's `probeStreamInfo` is additive
  and low-risk to layer on afterward) rather than parallelizing, to avoid
  both agents editing the same constructor/file concurrently.
- Item 3a (role tiers) should land before Item 4's "Web UI for admin user
  feature management" if that deferred sub-item is picked up later, since
  both touch admin-page permission gating.
- Everything else in this document (Items 2, 5, 7, and Item 1/6's non-overlap
  with everything but each other) is fully independent and matches ROADMAP
  §0's package-ownership dispatch rule.
