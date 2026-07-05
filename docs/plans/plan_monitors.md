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

## 2. Backend

Create `packages/plugins/lcyt-production/src/routes/monitors.js` with CRUD routes mirroring the existing production routers:

- `GET /production/monitors`
- `GET /production/monitors/:id`
- `POST /production/monitors` — accepts a `name`, generates an `ingest_key`, stores the row
- `PUT /production/monitors/:id` — updates the name
- `DELETE /production/monitors/:id`

Mount the router from `packages/plugins/lcyt-production/src/api.js` alongside the existing production routes.

No MediaMTX preview or ffmpeg pipeline is created in this phase. The backend only accepts ingestion and returns the key to the user.

## 3. Frontend

Add new UI pieces:

- `packages/lcyt-web/src/components/setup-hub/MonitorsSection.jsx`
- `packages/lcyt-web/src/components/ProductionMonitorsPage.jsx` (`MonitorsManager` + `MonitorForm`)

The Monitors page lets operators create and manage named monitors. The form only needs a `name` field and displays the generated ingest key after creation.

Update `packages/lcyt-web/src/components/setup-hub/SetupHubPage.jsx` so that:

- the Production devices grid includes a Monitors entry
- the existing Ingestion card becomes a real expandable card that lists ingestion-related entries plus every monitor
- monitor rows are visually disabled/greyed out and labelled as “Monitor”
- each monitor row shows the ingest key inline and links back to `/production/monitors`

No live preview tile is introduced in this iteration.

## 4. CLAUDE.md updates

Update the package docs to mention the new table and UI route:

- `packages/plugins/lcyt-production/CLAUDE.md`
- `packages/lcyt-web/CLAUDE.md`

## 5. Phased rollout

1. **DB + CRUD + key assignment** — add the table, create the routes, and generate an ingest key for each monitor.
2. **UI wiring** — show monitors in the Monitors card and as greyed-out entries in the Ingestion card.
3. **Future work (out of scope)** — any downscaling, preview transcode, or live-monitor rendering is deferred.

## 6. Verification

- **Node tests** — CRUD coverage for the new production monitor routes and database insert/select behavior.
- **Frontend tests** — cover the Monitors form and the SetupHub rendering of greyed-out monitor rows.
- **Manual** — create a monitor, confirm it gets an ingest key, confirm it appears in the Monitors card, and confirm it appears in the Ingestion card as a greyed-out monitor entry.
