---
id: plan/ingest_feeds
title: "Ingest Feeds — Arbitrary Named Ingestion, Egress, and Mixing"
status: draft
summary: "Generalizes RTMP ingestion from the current fixed 'one Video, one DSK' model to an arbitrary number of named, independently-relayable feeds, modeled as a new prod_cameras control_type rather than a separate table. Egress (rtmp_relays) is generalized to select any named feed as its source, and its 4-slot cap is removed (per-team quota is a deliberate non-goal for now). A 'Monitor' is no longer a distinct entity — it's simply a feed nobody has pointed an egress target at. Supersedes the earlier, narrower plan_monitors.md draft."
---

# Ingest Feeds — Arbitrary Named Ingestion, Egress, and Mixing

## Context

The original ask ("Monitors") was narrow: a named ingestion-only target for visual confidence-monitoring, with its own table and its own RTMP app. Working through the design surfaced that the platform's actual gap is one level up: ingestion today is **hardcoded to exactly one feed per project** (`rtmp://.../{apiKey}`), plus a second fixed DSK-overlay slot, and egress (`rtmp_relays`) can only select between that one feed's raw form (`'program'`) or its `{apiKey}-crop` rendition (`'crop'`) — there is no way to point an egress target at anything else, named or otherwise.

The motivating scenario: an operator has a named "Altar" camera feed that should go to Teams, while the main feed goes to YouTube — two named incoming feeds, routed independently to two different egress destinations. That requires generalizing ingestion to N named feeds and egress to select any of them, not a bespoke monitors table bolted on beside the existing two-slot model.

**Design decision — reuse `prod_cameras`, don't invent a parallel table.** `packages/plugins/lcyt-production/src/camera-thumbnail.js` already treats `camera.cameraKey` as a generic "this camera has a real, independently-viewable MediaMTX path" identity — the thumbnail-capture branch is gated on `if (camera.cameraKey)` alone, not on `control_type`. `webcam`/`mobile` are just the only two control types that populate it today (via WHIP push). Everything else a named ingest feed needs — CRUD, list/edit UI (`ProductionCamerasPage`), thumbnail capture, and eligibility as a software-mixer source via `mixer_input` — already exists for cameras and doesn't care how the path was populated. So a named RTMP-pushed feed becomes a **new `control_type: 'rtmp'`** on `prod_cameras`, not a new table.

**Also supersedes `plan_mixer_feed_sources.md`'s `prod_mixer_feed_sources.source_type: 'encoder'`.** That plan independently arrived at the same concept from the mixer side — "a plain ingest-only feed (an already-mixed video signal with no control channel at all)" wired to a `mixer_input`. That's exactly a `control_type: 'rtmp'` camera with `mixer_input` set, and needs no second table: `routes/mixers.js`'s `GET /:id/sources` already queries `prod_cameras WHERE mixer_input IS NOT NULL` with no `control_type` filter, so an `'rtmp'`-type camera with `mixer_input` set is automatically included with zero union-query changes. `plan_mixer_feed_sources.md` has been trimmed accordingly — see its updated Context section for the reconciliation and what remains genuinely distinct there (the `'file'` looping-video source type, and the WHEP live-preview-tile upgrade).

**Live vs. on-program are different signals — the crop-follow system already gets this right.** A `control_type: 'rtmp'` camera's `live` status (§2a — is something currently publishing to its `camera_key`) is independent of whether it's the mixer's *active* source (on program). This matters because `packages/plugins/lcyt-rtmp/src/db/crop.js`'s `crop_source_map`/`resolveCropPresetForSource()` — the mechanism that decides which crop preset to apply — is keyed off `mixer_input` (its least-specific tier) precisely because a camera can be live, or PTZ-repositioned to a new preset, without being cut to program; the crop system must only follow what's *actually on air*, not every camera that happens to be moving or streaming. This already works correctly for `'rtmp'`-type feeds with no new plumbing: setting `mixer_input` on one makes it eligible for the same mixer-input-tier crop-follow behavior a PTZ or webcam camera gets today, driven by the mixer's active-source state, not by the feed's own live/publish state.

**"Monitor" is no longer a first-class entity.** Any camera row with a `camera_key` (regardless of `control_type` — `rtmp`, `webcam`, or `mobile`) that no `rtmp_relays` row currently sources from *is* a monitor: ingested, live-tracked, never egressed anywhere. The standalone `prod_monitors` table, its own RTMP app, `MonitorsSection.jsx`, and `ProductionMonitorsPage.jsx` from the earlier draft of this plan are dropped entirely — superseded by this framing.

**Egress becomes open-ended.** `rtmp_relays`' `MAX_RELAY_SLOTS = 4` cap is removed outright; an operator can add as many egress targets as they want, each sourced from any named feed. Admin-configurable per-team limits are a real future need but a **deliberate non-goal of this plan** — no quota enforcement is built here.

**Explicitly out of scope: a live Preview (PVW) bus for the `lcyt` software mixer.** Checked and confirmed: Preview/Program are not real distinct video signals anywhere today, for any mixer type. `getActiveSource()`/`switchSource()` across every mixer adapter (including `lcyt`) track exactly one active input; the production console's "Preview" tile is a client-side-only staged-camera thumbnail, not a live encode. The `lcyt` adapter does zero server-side compositing — per its own header comment, compositing happens in the browser via canvas + WHIP. Building a second, real live Preview output for `lcyt` would mean a new browser compositing/WHIP leg — genuine new video-production engineering, not a registry change — and is deferred to a separate future plan. What **is** in scope: "Program" (the existing single signal) becomes one of the selectable named feeds, and if an operator has *already* cabled a hardware mixer's physical PVW output to its own encoder pushing RTMP, that arrives and is handled identically to any other named `'rtmp'`-type feed (e.g. "Altar") — no special-casing needed.

## 1. Data model

### 1a. `prod_cameras` — new `control_type: 'rtmp'`

`packages/plugins/lcyt-production/src/routes/cameras.js`'s `CAMERA_CONTROL_TYPES` gains `'rtmp'` alongside `'none' | 'amx' | 'visca-ip' | 'webcam' | 'mobile'`. No schema change — `camera_key`, `mixer_input`, `control_config` (unused, stays `{}`), `sort_order` all already exist and already work for any control type. A `'rtmp'`-type camera is a named feed a broadcaster pushes to over RTMP instead of WHIP:

- `camera_key` — the resolvable MediaMTX/RTMP path name (generated on create, same role it already plays for `webcam`/`mobile`).
- `mixer_input` — optional; set it and the feed becomes selectable in the `lcyt` software mixer's `GET /:id/sources` list, the same way a `webcam` camera does today. This is the "mixed inside our own feed mixer" path — no new mixer code needed.
- No PTZ semantics — `/:id/preset/:presetId` simply isn't meaningful for this type, same as it already isn't for `webcam`/`mobile`.

### 1b. `rtmp_relays` (egress) — arbitrary source, arbitrary count

Two changes to `packages/plugins/lcyt-rtmp/src/db/relay.js` / `routes/stream.js`:

1. **Add `source_camera_id TEXT NULL`** (nullable FK, no enforced constraint — FK enforcement is off repo-wide). `sourceView` keeps its current meaning (`'program'` = raw `{apiKey}` ingest, `'crop'` = the `{apiKey}-crop` rendition) as the default when `source_camera_id` is null — fully backward compatible, no migration of existing rows needed. When `source_camera_id` is set, it takes priority: the slot relays from that camera's `camera_key` MediaMTX path instead.

   ```sql
   ALTER TABLE rtmp_relays ADD COLUMN source_camera_id TEXT;
   ```

2. **Remove `MAX_RELAY_SLOTS`.** Delete the `existing.length >= MAX_RELAY_SLOTS` check in `routes/stream.js`'s `POST /stream` handler and the `slot < 1 || slot > MAX_RELAY_SLOTS` bound in `parseSlot()` — keep `slot` as the addressing key (`(api_key, slot)` stays the unique constraint `upsertRelay()` already uses; the DB and CRUD shape don't need to change, only the bound). `POST /stream` without an explicit `slot` should default to `MAX(slot)+1` for that key instead of the current hardcoded `slot ?? 1`, so adding targets doesn't require the client to track slot numbers by hand.

   Admin-configurable per-team caps are explicitly deferred — see Context.

## 2. Backend

### 2a. Feed RTMP ingest — accept pushes to any `'rtmp'`-type camera

New router `packages/plugins/lcyt-rtmp/src/routes/feed-rtmp.js` (or alongside `lcyt-production` — either plugin can own it; `lcyt-rtmp` is the more natural home since it already owns `routes/rtmp.js`/pattern precedent, and `lcyt-dsk`'s `routes/dsk-rtmp.js` shows this pattern working fine across a plugin boundary without a hard dependency), mirroring `routes/dsk-rtmp.js`'s shape exactly:

- One new static nginx-rtmp application (e.g. `feed`, env var `FEED_RTMP_APP`, default `feed`) — a single app handles arbitrarily many named feeds via dynamic per-request resolution, the same way the existing `stream`/`dsk` apps do. No nginx reconfiguration is needed per camera.
- `on_publish`: resolve the incoming stream `name` against `prod_cameras`:

  ```js
  // packages/plugins/lcyt-production/src/db.js (or wherever camera queries live)
  export function resolveFeedCamera(db, cameraKey) {
    return db.prepare("SELECT * FROM prod_cameras WHERE camera_key = ? AND control_type = 'rtmp'").get(cameraKey) ?? null;
  }
  ```

  No row found → 403 (this *is* the entire accept/reject gate; a camera's mere existence with `control_type: 'rtmp'` is the permission, there's no separate admin flag to check, mirroring how the earlier monitors draft reasoned about its own gate).
- Live tracking: `RtmpRelayManager._publishing` is already a generic `Set<string>` keyed by apiKey today — key it by `camera_key` for feed pushes instead (a disjoint namespace from apiKeys in practice; worth a uniqueness note when generating `camera_key` values so a crafted collision can't happen). `markPublishing(camera.cameraKey)` / `markNotPublishing(camera.cameraKey)` on `on_publish`/`on_publish_done`, giving `isPublishing(camera.cameraKey)` for free — same mechanism `GET /ingestion/config`'s `video.live` already reads.
- Compose the ingest URL the same way `buildIngestUrl()` does in `routes/ingestion.js`: `rtmp://<RTMP_HOST>/<FEED_RTMP_APP>/<camera_key>`.

### 2b. `GET /production/cameras` — surface `live` and ingest URL

Add `live` (from `relayManager.isPublishing(camera_key)`, or `mediamtxClient.isPathPublishing(camera_key)` — `routes/cameras.js`'s existing `/:id/whip-url` handler already calls the latter for `webcam`/`mobile`, so reusing it here instead of the RTMP-manager tracker is the more consistent choice and works uniformly across both push mechanisms) and, for `control_type: 'rtmp'` rows, the composed ingest URL to each camera row's JSON — same treatment `withThumbnailUrl()` already gives `thumbnailUrl`.

### 2c. Egress source resolution — `rtmp-manager.js`

`sourceUrl(apiKey)` currently hardcodes the raw `{apiKey}` ingest; the `startAll`/`start` fan-out logic branches on `sourceView === 'crop'` for the one alternate rendition. Add a third branch: when a relay row has `source_camera_id` set, resolve that camera's `camera_key` and use its MediaMTX path as the source instead of `sourceUrl(apiKey)` — independent of `sourceView`, and independent of whether the sourced camera belongs to the same project's primary feed at all (a monitor camera can be an egress source for a *different* project's relay just as easily as its own, since the resolution is by camera id, not by apiKey — worth deciding in implementation whether to scope `source_camera_id` lookups to cameras belonging to the same project, which the current single-tenant-ish `prod_cameras` table doesn't actually partition by project today; flagging this as a real open question for whoever picks up Phase 1, not resolved here).

### 2d. `routes/stream.js` — accept `sourceCameraId`

`validateBody()` gains an optional `sourceCameraId` field (validated as an existing camera id with a non-null `camera_key`, mutually informative with but not replacing `sourceView` — see §1b). No other route shape changes; CRUD stays slot-addressed, just uncapped.

## 3. Frontend

- **No new pages.** `ProductionCamerasPage`'s existing camera form gains `'RTMP Feed'` as a selectable control type (alongside the current PTZ/webcam/mobile options) — creating one is exactly the existing camera-creation flow, just without a PTZ config step. The ingest URL and live dot render the same way a `webcam` camera's WHIP status does today.
- **`IngestionSection.jsx`** (`packages/lcyt-web/src/components/setup-hub/IngestionSection.jsx`, already real and backend-wired per `plan_selfservice_config_backend.md` §2/§2a) is extended to list every `camera_key`-bearing camera row alongside its existing Video/DSK slots:
  - a camera **referenced by at least one `rtmp_relays.source_camera_id`** row renders as an active, named ingestion entry with its live dot and current egress target(s);
  - a camera referenced by **none** renders greyed-out and labelled "Monitor" — computed client-side from the camera list + relay list, not a separate flag anywhere in the data model.
- **Egress UI** (the relay-target editor under `/broadcast` or wherever `routes/stream.js` is currently consumed — confirm exact component when implementing) gets a source picker per target: "Program" (default) / "Vertical Crop" / any named `'rtmp'`/`webcam`/`mobile` camera with a `camera_key`. The "add target" action is no longer capped at 4 — becomes an open-ended list, consistent with §1b.
- **Mixing**: setting `mixerInput` on an `'rtmp'`-type camera makes it appear in the `lcyt` software mixer's source list via the existing `GET /:id/sources` query (cameras with non-null `mixer_input`) — no frontend change needed beyond what already renders mixer sources today.

## 4. CLAUDE.md updates

Update the package docs to mention the new control type, the new router, and the egress source generalization:

- `packages/plugins/lcyt-production/CLAUDE.md` — `'rtmp'` added to the camera control-type table; note on reusing `camera_key`/`mixer_input` for pushed feeds.
- `packages/plugins/lcyt-rtmp/CLAUDE.md` — new `routes/feed-rtmp.js` entry (mirrors the existing `routes/dsk-rtmp.js` entry); `routes/stream.js`'s description updated to mention `source_camera_id` and the removed slot cap.
- `packages/lcyt-web/CLAUDE.md` — note on the camera form's new `'RTMP Feed'` type and `IngestionSection.jsx`'s computed Monitor-row behavior.

## 5. Phased rollout

1. **Egress generalization** — `rtmp_relays.source_camera_id` column, `routes/stream.js` accepting it, `rtmp-manager.js` branching, `MAX_RELAY_SLOTS` removed.
2. **RTMP-pushed camera ingest** — `control_type: 'rtmp'` added to `CAMERA_CONTROL_TYPES`, `feed-rtmp` on_publish/on_publish_done router + resolver, live status surfaced on `GET /production/cameras`.
3. **UI wiring** — camera form's new `'RTMP Feed'` type, `IngestionSection.jsx`'s computed active/Monitor rows, egress source picker with open-ended target list.
4. **Future, non-goal now** — admin-configurable per-team relay quota.
5. **Future, separate plan** — `lcyt` software mixer live Preview/PVW bus.

## 6. Verification

- **Node tests** — `rtmp-manager.js` source resolution (`source_camera_id` set vs. `sourceView='program'|'crop'` vs. legacy rows with neither); `routes/stream.js` CRUD with no slot cap (creating a 5th+ target); `feed-rtmp` `on_publish`/`on_publish_done` (unknown `camera_key` → 403, known `'rtmp'`-type camera → 200 + live tracking flips, mirroring `packages/plugins/lcyt-dsk/test/`'s `dsk-rtmp` coverage and `rtmp-manager.test.js`'s existing publish-tracking patterns).
- **Frontend tests** — camera form's new `'RTMP Feed'` type; `IngestionSection`'s computed active-vs-Monitor row rendering from camera + relay lists.
- **Manual** — create an `'rtmp'`-type camera named "Altar," push an RTMP stream to it, confirm its live dot flips. Add two egress targets: one sourced from Program → a YouTube destination, one sourced from the Altar camera → a Teams (or any generic RTMP-in) destination, and confirm they fan out independently. Create a third camera with no egress target pointed at it and confirm it renders as a greyed-out Monitor row in the Ingestion card. Set `mixerInput` on the Altar camera and confirm it appears in the `lcyt` software mixer's source list.
