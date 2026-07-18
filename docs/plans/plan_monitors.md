---
id: plan/monitors
title: "Monitors — Ingestion-Only Monitoring"
status: draft
summary: "A lightweight 'Monitor' concept for confidence-only monitoring. For now, the backend only accepts ingestion and assigns an ingest key; the UI labels those entries as monitors, shows them in the Monitors card, and renders them as greyed-out rows in the existing Ingestion card. No downscaling or preview-transcode work is planned in this iteration."
---

# Monitors — Ingestion-Only Monitoring

## Context

Operators sometimes need a named stream for visual confidence-monitoring without turning it into a production input. The current scope is intentionally narrow: register a monitor, accept its ingestion, and surface it in the UI as a monitor.

This plan does not introduce any preview pipeline, downscaler, or live tile. The only job of the monitor is to accept ingestion and expose the assigned key so the operator can use it.

**Builds directly on `plan_selfservice_config_backend.md` §2/§2a** (implemented, PR #239) — the rotatable-ingest-key + `resolveApiKeyFromIngestStreamKey()` + `on_publish`/`on_publish_done` + `RtmpRelayManager.isPublishing()` recipe used for the primary video and DSK ingest apps is the same recipe a monitor's ingest needs, just keyed off its own `prod_monitors` row instead of `api_keys`. That plan's `IngestionSection.jsx` Setup Hub card (§3 below) is also the concrete extension point — it already exists and is already backend-wired, it is not being built from scratch here.

## 1. Data model

Add a new table in `packages/plugins/lcyt-production/src/db.js`:

```sql
CREATE TABLE IF NOT EXISTS prod_monitors (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  ingest_key  TEXT NOT NULL UNIQUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

There is intentionally no mixer wiring, no preview settings, and no transcode settings on this table. A monitor is just a named ingestion target.

**`ingest_key` is not just a database string — it has to be resolvable by an actual RTMP `on_publish` callback**, the same way `api_keys.ingest_stream_key` is for the primary video and DSK ingest apps (`plan_selfservice_config_backend.md` §2/§2a, implemented in PR #239). Reuse that pattern rather than inventing a new one:

- A dedicated nginx-rtmp/MediaMTX application for monitors, e.g. `monitor` (env var `MONITOR_RTMP_APP`, default `monitor` — same convention as `DSK_RTMP_APP`).
- A resolver mirroring `resolveApiKeyFromIngestStreamKey()` (`packages/plugins/lcyt-rtmp/src/db/relay.js`) and its DSK-side duplicate (`packages/plugins/lcyt-dsk/src/routes/dsk-rtmp.js`), except it looks up `prod_monitors.ingest_key` instead of `api_keys.ingest_stream_key` — there is no api_key to resolve back to, just the monitor row itself:

  ```js
  // packages/plugins/lcyt-production/src/db.js
  export function resolveMonitorByIngestKey(db, name) {
    return db.prepare('SELECT * FROM prod_monitors WHERE ingest_key = ?').get(name) ?? null;
  }
  ```

- Ingest URLs are composed the same way `buildIngestUrl()` does in `routes/ingestion.js`: `rtmp://<RTMP_HOST>/<MONITOR_RTMP_APP>/<ingest_key>`.

## 2. Backend

Create `packages/plugins/lcyt-production/src/routes/monitors.js` with CRUD routes mirroring the existing production routers:

- `GET /production/monitors`
- `GET /production/monitors/:id`
- `POST /production/monitors` — accepts a `name`, generates an `ingest_key`, stores the row
- `PUT /production/monitors/:id` — updates the name
- `DELETE /production/monitors/:id`

Mount the router from `packages/plugins/lcyt-production/src/api.js` alongside the existing production routes.

No MediaMTX preview or ffmpeg pipeline is created in this phase. The backend only accepts ingestion and returns the key to the user.

**RTMP callback wiring** (the actual "accepts ingestion" piece — CRUD alone doesn't do this): a `createMonitorRtmpRouter(db, relayManager)` mirroring `routes/dsk-rtmp.js`'s shape, mounted at `/monitor-rtmp`, handling nginx-rtmp `on_publish`/`on_publish_done` for the `monitor` app:

- `on_publish`: resolve `name` via `resolveMonitorByIngestKey()`; 403 if no matching monitor row exists (this is the entire accept/reject gate — no `relay_allowed`-style admin flag needed, since a monitor's mere existence is the permission); otherwise `relayManager.markPublishing(row.ingest_key)` (or an equivalent lightweight `Set`-based tracker scoped to monitors, if reusing `RtmpRelayManager`'s instance-per-api-key semantics doesn't fit) and 200.
- `on_publish_done`: `markNotPublishing(row.ingest_key)`.

This gives monitors a real `live` boolean for free, the same way `GET /ingestion/config`'s `video.live` reads `relayManager.isPublishing(apiKey)` — worth surfacing on `GET /production/monitors` rows so the greyed-out Ingestion-card entries (§3) can still show a live/offline dot despite being non-interactive.

## 3. Frontend

Add new UI pieces:

- `packages/lcyt-web/src/components/setup-hub/MonitorsSection.jsx`
- `packages/lcyt-web/src/components/ProductionMonitorsPage.jsx` (`MonitorsManager` + `MonitorForm`)

The Monitors page lets operators create and manage named monitors. The form only needs a `name` field and displays the generated ingest key after creation.

Update `packages/lcyt-web/src/components/setup-hub/SetupHubPage.jsx` so that:

- the Production devices grid includes a Monitors entry
- `IngestionSection.jsx` (`packages/lcyt-web/src/components/setup-hub/IngestionSection.jsx` — already a real, backend-wired card per `plan_selfservice_config_backend.md` §2/§2a, not a placeholder to promote) is extended to also list every monitor as a row, alongside its existing Video/DSK slots and camera-phantom badges
- monitor rows are visually disabled/greyed out and labelled as “Monitor”, using the same `statusDotFor()`/`live` pattern the Video/DSK rows already use (see §2's `live` boolean) rather than a new status convention
- each monitor row shows the ingest key inline and links back to `/production/monitors`

No live preview tile is introduced in this iteration.

## 4. CLAUDE.md updates

Update the package docs to mention the new table and UI route:

- `packages/plugins/lcyt-production/CLAUDE.md`
- `packages/lcyt-web/CLAUDE.md`

## 5. Phased rollout

1. **DB + CRUD + key assignment** — add the table, create the CRUD routes, and generate an ingest key for each monitor.
1a. **RTMP callback wiring** — `monitor-rtmp` router + `resolveMonitorByIngestKey()` + publish tracking (§2), so the assigned key is actually resolvable by an incoming publish, not just a stored string.
2. **UI wiring** — show monitors in the Monitors card and as greyed-out entries in the Ingestion card.
3. **Future work (out of scope)** — any downscaling, preview transcode, or live-monitor rendering is deferred.

## 6. Verification

- **Node tests** — CRUD coverage for the new production monitor routes and database insert/select behavior; `monitor-rtmp` `on_publish`/`on_publish_done` coverage (unknown key → 403, known key → 200 + live tracking flips), mirroring `packages/plugins/lcyt-dsk/test/` and `packages/plugins/lcyt-rtmp/test/rtmp-manager.test.js`'s existing publish-tracking test patterns.
- **Frontend tests** — cover the Monitors form and the SetupHub/`IngestionSection` rendering of greyed-out monitor rows including their live/offline dot.
- **Manual** — create a monitor, confirm it gets an ingest key, publish an RTMP stream to it and confirm the live dot flips, confirm it appears in the Monitors card, and confirm it appears in the Ingestion card as a greyed-out monitor entry.
