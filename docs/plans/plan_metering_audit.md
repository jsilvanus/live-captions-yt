# Plan: Metering, Prometheus Metrics & Unified Audit Log

> **Status:** pending
> **Scope:** `lcyt-backend`, `lcyt-rtmp`, `lcyt-dsk`, `lcyt-agent`, `lcyt-orchestrator`, `lcyt-worker-daemon`, `lcyt-web`, compose files, `PORTS.md`
> **Decided with user 2026-07-16.** Design discussion resolved: project-level attribution, DB-first metering, wall-clock × purpose compute, Prometheus server in compose (no Grafana), unified audit log with `admin_audit_log` migration, in-app Admin/Team views as primary consumers.

## 1. Context & goals

LCYT currently has no coherent observability layer:

- Usage accounting is scattered across ~6 ad-hoc SQLite tables (`caption_usage`, `session_stats`, `domain_hourly_stats`, `viewer_key_daily_stats`, `rtmp_stream_stats`, …), all keyed by `api_key` only, none with retention sweeps, none exposing org/user attribution.
- The only `/metrics` endpoint is a hand-rolled 4-counter exporter in `lcyt-orchestrator` (`src/metrics.js`) that mislabels its gauge as a counter.
- MediaMTX's native Prometheus endpoint is enabled in `docker/mediamtx.yml` (`metrics: yes`, `metricsAddress: :9998`) but the port is mapped nowhere and undocumented.
- ffmpeg compute and network egress are entirely unmeasured; worker/orchestrator job records carry no duration timestamps.
- The audit trail covers only admin-panel actions (`admin_audit_log`, 13 call sites in `routes/admin.js`) and caption-relay rejections (`auth_events` — despite its name it records **no** logins). User/device logins and all self-service configuration edits are unrecorded.

Goals:

1. **Infra metrics** — compute (ffmpeg process-seconds, burst VM-hours), sessions, RTMP stream time, network egress, storage bytes — **attributed to the project (`api_key`) that causes them**, rollable to org/team and system level, durable enough to become a billing basis.
2. **Business metrics** — captions sent, DSK template activations, RTMP streams, videos created, STT time, cue fires, AI calls, bridge/production commands, viewer views.
3. **Audit log** — logins (success + failure), device PIN auth, every self-service configuration edit, admin actions — unified, queryable, retained.
4. **Consumption**: in-app Admin metrics page, Admin audit-log view, Team usage tab (primary); Prometheus server shipped in compose for ops (secondary); no Grafana.

## 2. Architecture decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | **Attribution at project (`api_key`) level.** Org/user derived by `JOIN api_keys` at query time; no denormalized org/user on usage rows. | Matches every existing accounting table; the org pays for its projects. Per-user "who did it" belongs to the audit log, not metering. |
| 2 | **DB-first metering**: narrow `usage_rollups` table is the billing-grade backbone; Prometheus is a secondary projection of the same in-memory counters. | In-app views need queryable history from SQLite; Prometheus is ops-grade (restart-lossy, retention-limited) and must not be a runtime dependency of user-facing features. |
| 3 | **Hourly grain, compacted to daily after 90 days**; daily rows kept indefinitely. | Hour resolution for recent ops questions; bounded table size; daily is what billing needs. |
| 4 | **Zero DB writes on hot paths**: in-memory buffer, interval flush (~15 s) in one transaction. | better-sqlite3 is synchronous; same rationale that keeps `bus_events` off high-frequency topics (`src/db/bus-events.js`). |
| 5 | **Compute = wall-clock process-seconds × `purpose` label** (relay/crop/radio/stt/dsk/music/hls/preview/pcm). No CPU sampling in v1. | Free to collect at the runner choke point; purpose is a good billing weight proxy (relay ≈ 3% of a core, crop/DSK transcode ≈ 2–3 cores). CPU sampling can be added later without schema changes. |
| 6 | **Egress measured where it flows**: MediaMTX REST poller (per-path bytes; paths are named by api_key → attribution is free) + byte counting on Node-proxied HLS pipes. The nginx-proxied radio path is documented as unmeasured. | Honest accounting without nginx log parsing. MediaMTX `:9998` additionally exposed for Prometheus scrape (ops view). |
| 7 | **One unified `audit_log` table**: generic write-audit middleware for all authenticated mutating requests + hand-written semantic events for auth. `admin_audit_log` is **migrated in and dropped**; `bus_events` stays as the separate system/agent trail. | Complete-by-default coverage of "how much things are edited"; one query API for the UI; no dual-write drift. |
| 8 | **prom-client** on backend, orchestrator, worker-daemon; backend `/metrics` gated by `METRICS_TOKEN` (404 when unset); business series labeled `{project}` only (bounded cardinality; `METRICS_PROJECT_LABELS=0` opt-out); never label by session or user. | Backend :3000 is public behind nginx — dedicated low-privilege scrape token instead of reusing `X-Admin-Key`. Orchestrator/worker are loopback-bound. |
| 9 | **UI**: Admin metrics page; audit-log view **nested under the Admin page** (admin sub-navigation, not a standalone sidebar item); Team page gets a Usage tab. In-repo SVG chart components (no chart dependency exists in lcyt-web; none added). | User decision. |

## 3. Metering data model (`lcyt-backend`)

### 3.1 `usage_rollups` table

Additive migration in `packages/lcyt-backend/src/db/schema.js`:

```sql
CREATE TABLE IF NOT EXISTS usage_rollups (
  api_key      TEXT NOT NULL,            -- '' = system scope (no project attribution)
  period_start TEXT NOT NULL,            -- 'YYYY-MM-DDTHH:00:00Z' (hour) / 'YYYY-MM-DD' (day)
  grain        TEXT NOT NULL DEFAULT 'hour',  -- 'hour' | 'day'
  metric       TEXT NOT NULL,            -- dotted name from the metric registry
  value        REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (api_key, metric, grain, period_start)
);
CREATE INDEX IF NOT EXISTS idx_usage_rollups_period ON usage_rollups(period_start);
CREATE INDEX IF NOT EXISTS idx_usage_rollups_metric ON usage_rollups(metric, period_start);
```

UPSERT semantics by metric kind: **counter** → `value = value + excluded.value`; **gauge** → `value = excluded.value`; **max** → `value = MAX(value, excluded.value)`.

Org/user/system rollups are join-derived: `usage_rollups JOIN api_keys ON api_keys.key = usage_rollups.api_key` grouped by `api_keys.org_id` / `api_keys.user_id`. If a project changes org, its history follows the project (accepted; billing snapshots can be layered later).

### 3.2 Metric catalog

Single source of truth in `packages/lcyt-backend/src/metrics/registry.js` — `{ name, kind, unit, promName, promLabels }` per metric. Initial catalog and collection source:

| Metric | Kind | Source (hook point) |
|---|---|---|
| `captions.sent` / `captions.failed` | counter | bus tap: `caption.sent` / `caption.error` (published by `SessionStore._bridgeEmitterToBus`, `src/store.js:74-89`) |
| `sessions.count` / `sessions.seconds` | counter | bus tap: `session.closed` (duration from payload or store `startedAt`) |
| `sessions.peak_concurrent` | max | `POST /live` success path: `store` size |
| `rtmp.streams` / `rtmp.stream_seconds` | counter | direct hook in `lcyt-rtmp/src/api.js:100-136` `onStreamEnded` (payload has `durationMs`), next to existing `writeRtmpStreamEnd` |
| `ffmpeg.process_seconds.<purpose>` | counter | ffmpeg runner factory wrapper (§4.1) |
| `stt.seconds` | counter | `SttManager` `stopped` event, hooked where `routes/stt.js:130-133` already subscribes |
| `dsk.template_activations` | counter | direct hook in `POST /dsk/:apikey/templates/:id/activate` (verify exact bus topic names against `src/dsk-bus.js` emit sites first — the events catalog has known mismatches) |
| `dsk.broadcasts` | counter | direct hook in `POST /dsk/:apikey/broadcast` |
| `cues.fired` | counter | bus tap: `plugin.cue_fired` (**not** `cue.fired` — cue fires reach the bus via the generic plugin passthrough, `store.js:89`) |
| `videos.created` / `videos.bytes` | counter | direct hook in `src/db/videos.js` `createVideo`/`finishVideoRecording` |
| `viewer.views` | counter | `routes/viewer.js:111` connect path (next to existing daily-stat increment) |
| `viewer.peak_concurrent` | max | same path, `viewerSubs` size |
| `storage.caption_files_bytes` / `storage.images_bytes` | gauge | 5-min poller: `SUM(caption_files.size_bytes)` per key + `getTotalImageStorageBytes` (`lcyt-dsk/src/db/images.js:158`) |
| `egress.mediamtx_bytes` | counter | MediaMTX poller (§4.2), per-path deltas |
| `egress.node_hls_bytes` | counter | byte counting on Node proxy pipes (§4.2) |
| `connectors.refreshes` | counter | bus tap `variable.*.changed` + direct hook `POST /variables/refresh` |
| `ai.calls` | counter | LLM-call choke point in `lcyt-agent`, via `initAgent(db, { eventBus, metrics })` |
| `bridge.commands` | counter | bus tap: `bridge.command_result` |
| `production.commands` | counter | direct hook in production control routes (camera preset / mixer switch / encoder control) |
| `compute.burst_vms_created` / `compute.burst_vm_seconds` | counter | backend poller over orchestrator burst-VM history (§4.3); system scope (`api_key=''`) |
| `auth.logins` | counter | semantic auth hook (system scope; per-user detail lives in `audit_log`) |

### 3.3 Relationship to existing tables

**No existing table is deprecated and no fact gains a second write path.** `caption_usage` keeps quota enforcement (`checkAndIncrementUsage`, `src/db/keys.js:170-215` — untouched). `session_stats`, `rtmp_stream_stats`, `domain_hourly_stats`, `viewer_*_daily_stats`, `videos` remain the per-fact detail layer. Rollup increments are added **at the same code sites** that already write those tables — one extra in-memory Map bump, so the two layers agree by construction. The new REST/UI layer queries only `usage_rollups`.

### 3.4 Write buffer

`packages/lcyt-backend/src/metrics/buffer.js`:

- In-memory `Map` keyed `${apiKey}\x00${metric}\x00${hourBucket}` → `{kind, value}`. `count()`/`gauge()`/`max()` mutate the Map only.
- Flush timer (default 15 s, `USAGE_FLUSH_INTERVAL_MS`), `unref()`'d; drains inside one `db.transaction()` of prepared UPSERTs; errors caught and logged, never thrown into callers (mirrors `writeAuditLog`'s swallow contract).
- `flushNow()` called from `index.js` shutdown before `db.close()`.

### 3.5 Retention & compaction

Timers in `packages/lcyt-backend/src/index.js`, mirroring the `EVENT_LOG_RETENTION_DAYS` pattern (index.js:59-63):

- `USAGE_ROLLUP_HOURLY_RETENTION_DAYS` (default 90): hourly rows older than N compacted into `grain='day'` rows (SUM counters / MAX max / last gauge), then deleted. Day rows kept indefinitely.
- `STATS_RETENTION_DAYS` (default **0 = disabled**, opt-in; docs recommend 365): sweeps the existing unbounded tables — `session_stats`, `caption_errors`, `auth_events`, `domain_hourly_stats`, `viewer_key_daily_stats`, `viewer_anon_daily_stats`, `rtmp_stream_stats`, `rtmp_anon_daily_stats`, `cue_events`, `agent_events`, `music_events`. `caption_usage` explicitly excluded (quota source of truth).

## 4. Instrumentation layer

### 4.1 Shared metrics module + ffmpeg accounting

`packages/lcyt-backend/src/metrics/` — injected into plugins as a `metrics` handle, following the existing `db`/`store`/`eventBus` injection pattern:

- `index.js` — `createMetrics({ db })` → `{ count, gauge, max, ffmpeg, setSseGauge, flushNow, registry, promRegistry }`. Every method feeds both the rollup buffer and the prom-client series — one hook, two sinks.
- `bus-tap.js` — `attachBusMetrics(eventBus, metrics)`: one `eventBus.tap()` (`packages/lcyt/src/event-bus.js:172`), mirroring `attachBusAuditLog` but mapping topics → metrics instead of persisting. Envelope `projectId` provides attribution.
- `pollers.js` — storage gauges, MediaMTX egress, orchestrator burst history.

Wiring in `server.js`: create `metrics` next to the EventBus block (~line 201-206), `attachBusMetrics` beside `attachBusAuditLog` (line 204), pass into `initRtmpControl(db, store, { metrics })`, `initAgent(db, { eventBus, metrics })`, `initDskControl`, music init; add to module exports for tests.

**ffmpeg**: extend `createFfmpegRunner()` (`src/ffmpeg/index.js`) opts with `purpose` + `apiKey` (optional; defaults `'unknown'`/`''`). The factory wraps the returned runner: timestamp on `start()`, duration on `'close'`, reported to a module-level sink set once via `setFfmpegAccountingSink(fn)` from server.js (no-op when unset — tests, CLI). Because relay/crop already construct runners through this factory from inside `lcyt-rtmp` (rtmp-manager.js:608, crop-manager.js:272), this single choke point covers them; the remaining direct `spawn()` sites are migrated onto the factory: `lcyt-rtmp/src/hls-manager.js:59`, `stt-manager.js:245`, `lcyt-music/src/music-manager.js:212`, `lcyt-music/src/pcm-extractor.js:20`, `lcyt-dsk/src/renderer.js:491/:662` (ffmpeg parts only; Chromium stays direct — if migration proves risky there, minimal manual start/close timing calling the same sink is pre-approved). Backend-side observation of worker-runner jobs means DB attribution always happens in the backend process regardless of `FFMPEG_RUNNER`.

### 4.2 Bandwidth

- **MediaMTX poller** (30 s): `MediaMtxClient.listPaths()` (:9997 REST, already configured via `MEDIAMTX_API_URL`) → per-path `bytesSent`/`bytesReceived` deltas with counter-reset detection (`if current < last: delta = current`; unit-tested). Path name = api_key → direct attribution to `egress.mediamtx_bytes`.
- **Node HLS proxies**: accumulate chunk bytes on the proxied bodies at `stream-hls.js:236/260` and `radio.js:361/385` → `egress.node_hls_bytes` keyed by the `:key` param.
- **nginx-fronted radio** (`NGINX_RADIO_CONFIG_PATH` set) bypasses Node — documented as measured at MediaMTX only.
- MediaMTX `:9998` mapped in both compose files for the Prometheus scrape (ops view; the rollup path uses the REST poller because attribution needs JSON anyway).

### 4.3 Orchestrator & worker daemon

- **Orchestrator** (`packages/lcyt-orchestrator`): rewrite `src/metrics.js` on prom-client **keeping the `inc(name, n)` / `set(name, v)` facade** so all 8 call sites in `index.js` are untouched. `burst_vm_created_total`/`burst_vm_destroyed_total`/`hetzner_rate_limit_backoff_total` become Counters; `active_workers` becomes a Gauge (fixes the hardcoded `# TYPE ... counter` bug at index.js:286). Add `collectDefaultMetrics()` + `orchestrator_jobs_pending` gauge. **Burst VM lifetime**: stamp `createdAt` on burst worker records; on destroy, record lifetime → `burst_vm_seconds_total` counter, `burst_vms_active` gauge, and an in-memory history ring exposed as `GET /compute/burst/history` (JSON) for the backend poller and Admin live panel. This yields "how many burst servers, for how long" — the number Hetzner bills.
- **Worker daemon** (`packages/lcyt-worker-daemon/src/index.js`): extend job records with `startedAt`/`finishedAt`/`durationMs`; add `GET /metrics` (prom-client): `worker_jobs_running` gauge, `worker_jobs_total{status}` counter, `worker_job_duration_seconds` histogram, default metrics. `GET /stats` unchanged.

### 4.4 Prometheus exposition (backend)

- `prom-client` dependency in `lcyt-backend`; series built from the same registry catalog. Business counters as `lcyt_<name>_total{project}`; `collectDefaultMetrics()`; process/system series unlabeled.
- SSE connection gauges via `metrics.setSseGauge(name, sizeFn)` registered by the 8 in-memory registries (`viewer.js` viewerSubs, `events.js`, `events-stream.js`, `stt.js`, `mcp-endpoint.js`, DSK `dsk.js`, music `music.js`, bridge `bridge-manager.js`) — read lazily at collect time; also surfaced in the live REST panel.
- `GET /metrics` on the backend: `Authorization: Bearer ${METRICS_TOKEN}`; 404 when env unset.

## 5. Unified audit log

### 5.1 Schema

```sql
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  actor_kind  TEXT NOT NULL,   -- 'user'|'admin'|'device'|'session'|'external'|'system'
  actor_id    TEXT,            -- email / admin label / device role code / session id / token id
  user_id     INTEGER,         -- users.id when known (FK-by-convention; rows outlive users)
  api_key     TEXT,            -- project attribution when known
  org_id      INTEGER,         -- resolved from api_keys.org_id AT WRITE TIME (point-in-time attribution)
  action      TEXT NOT NULL,   -- 'auth.login' | 'PUT /targets/:id' | 'user.create' ...
  target_type TEXT,
  target_id   TEXT,
  details     TEXT,            -- redacted JSON summary
  ip          TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_project ON audit_log(api_key, id);
CREATE INDEX IF NOT EXISTS idx_audit_log_org     ON audit_log(org_id, id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action  ON audit_log(action);
```

Unlike metering, `org_id` **is** denormalized here — audit must reflect attribution at event time.

### 5.2 Generic write-audit middleware

`packages/lcyt-backend/src/middleware/write-audit.js` — `createWriteAudit(db, { skip })`, mounted **once, app-level in `server.js` before the scoped routers** (~line 405). It only registers `res.on('finish')`; by finish time `req.auth` is populated by the router-level project-access middleware, so one mount covers every scoped router (DSK, targets, translation, cues, connectors, variables, roles, mcp-tokens, broadcasts, keys, orgs, project-members, device-roles, …).

- Records only POST/PUT/PATCH/DELETE with 2xx status and populated `req.auth` (or `req.user`).
- `action` = `` `${method} ${req.baseUrl}${req.route?.path ?? ''}` `` — route **template**, not the concrete URL (bounded action-name cardinality). `target_type` from the first path segment; `target_id` from route params.
- `details` = shallow body summary (depth ≤ 2, ≤ 2 kB) with a redaction denylist — `password`, `pin`, `token`, `secret`, `key`, `apiKey`, `credentials`, `auth_config`, `authorization` → `'***'` (follows the existing `auth_config` masking convention).
- Skip-list (path-prefix + method): `POST /captions`, `/sync`, `/mic`, `/live`, `/variables/refresh`, `/dsk/*/broadcast`, `POST /events`, `/production/bridge/status`, `/dsk-rtmp/*`, `/roles/*/message` — high-frequency or already covered by `session_stats`/bus.
- Same swallow-errors contract as today's `writeAuditLog`; single prepared INSERT per mutating request (low frequency — no buffering needed).

### 5.3 Semantic auth events

Via `writeAudit(db, entry)` in `src/db/audit-log.js`:

- `routes/auth.js`: `auth.login` (success: user_id, ip), `auth.login_failed` (details `{email}`, ip; **throttled in-memory to 1 row per email+ip per 10 s** so credential-stuffing can't bloat the table — the `auth.logins` metric still counts every attempt), `auth.register`, `auth.change_password`.
- `routes/device-roles.js` `deviceLoginHandler`: `auth.device_login` / `auth.device_login_failed` with role code + project.
- Session start/end: **not** duplicated into audit_log (already in `session_stats` + bus).

### 5.4 `admin_audit_log` migration

One-time, in `schema.js`: if `admin_audit_log` exists and `audit_log` was just created, copy rows (`actor_kind='admin'`), then `DROP TABLE admin_audit_log`. `writeAuditLog` (13 call sites in `routes/admin.js`, signatures unchanged) is retargeted to insert `actor_kind:'admin'` rows into `audit_log`. `queryAuditLog` (`src/db/audit-log.js:39`) gains `actorKind`/`apiKey`/`orgId` filters; `GET /admin/audit-log` keeps its response shape (superset). `bus_events` untouched.

### 5.5 Retention & read APIs

- `AUDIT_LOG_RETENTION_DAYS` (default 365, 0 disables) sweep in `index.js`.
- `GET /admin/audit-log` — extended filters.
- `GET /orgs/:id/audit` — org owner/admin only (existing role helpers in `routes/orgs.js`).
- `GET /keys/:key/audit` — project owner/admin (same auth pattern as `/keys/:key/features`).

## 6. REST + UI

### 6.1 Rollup endpoints

`src/routes/metrics.js` + query helpers in `src/db/usage-rollups.js` (thin-routes convention):

- `GET /admin/metrics/rollups?from&to&grain=hour|day&metrics=a,b&groupBy=metric|project|org` (X-Admin-Key) → `{ series: [{ key, metric, points: [[period, value]] }] }`.
- `GET /admin/metrics/live` — "right now" panel, no Prometheus dependency: active sessions (store size), running ffmpeg by purpose, SSE connection counts, burst VMs (orchestrator history poll).
- `GET /orgs/:id/usage?from&to&metrics` — any org member; per-project breakdown for owner/admin.
- `GET /keys/:key/usage?from&to&metrics` — project members. `GET /stats` untouched (StatsModal keeps working).

### 6.2 lcyt-web

- **Admin metrics page** — new page in the admin area (`navConfig.jsx` admin entry): live panel (5 s poll) + time-range rollup charts + top-N project/org tables.
- **Audit-log view** — nested **under the Admin page** as admin sub-navigation (NOT a standalone sidebar item). The existing hidden `AdminAuditLogPage` is repurposed: new filters/columns (actor_kind, project, org).
- **Team usage tab** — added to the existing `TeamPage` (tabbed pattern as in `ProjectSettingsPage`), backed by `/orgs/:id/usage`.
- Charts: small in-repo SVG `Sparkline`/`BarChart` components (`components/charts/`) — no new dependency (lcyt-web has none today: react, wouter, hls.js, mermaid, react-grid-layout). Consult the dataviz skill when implementing.

## 7. Deploy

- **`docker-compose.monitoring.yml`** (repo root): single `prom/prometheus` service, `127.0.0.1:9090:9090`, volume `prometheus-data`, `--storage.tsdb.retention.time=${PROM_RETENTION:-30d}`, config from new `ops/prometheus/prometheus.yml` with 4 scrape jobs: backend :3000 (`authorization.credentials: ${METRICS_TOKEN}`), orchestrator :4000, worker :5000, mediamtx :9998. No Grafana.
- **MediaMTX :9998** mapped (`127.0.0.1:9998:9998`) in `docker-compose.yml` and `docker-compose.orchestrator.yml`.
- **PORTS.md**: rows for 9998 (MediaMTX Prometheus metrics, internal), 9090 (Prometheus, internal), 4000/5000 (currently undocumented). Env vars (`METRICS_TOKEN`, `USAGE_FLUSH_INTERVAL_MS`, `USAGE_ROLLUP_HOURLY_RETENTION_DAYS`, `STATS_RETENTION_DAYS`, `AUDIT_LOG_RETENTION_DAYS`, `METRICS_PROJECT_LABELS`) documented in `packages/lcyt-backend/CLAUDE.md`.

## 8. Implementation phases

Each phase independently shippable; tests use the repo's `node:test` + in-memory better-sqlite3 pattern. Order: **1 → 2 → {3, 4, 5} → 6**.

### Phase 1 — Metering foundation
Create `src/metrics/{index,registry,buffer,bus-tap}.js`, `src/db/usage-rollups.js`; modify `schema.js` (usage_rollups), `server.js` (wire metrics + bus tap, inject into `initRtmpControl`), `index.js` (flush on shutdown, compaction/retention timers), `lcyt-rtmp/src/api.js` (stream hooks), `src/db/videos.js`, `routes/viewer.js`, STT-stop hook.
**Tests:** UPSERT semantics per kind, buffer flush, compaction; bus tap publish → rollup row after flush.
**Verify:** send captions through `POST /captions`; after flush, `SELECT * FROM usage_rollups` shows `captions.sent` for the key/hour.

### Phase 2 — ffmpeg, storage, egress, burst accounting
Modify `src/ffmpeg/index.js` (purpose/apiKey, timing wrapper, sink), runner call sites in `lcyt-rtmp`, migrate direct spawns (hls-manager, stt-manager, pcm-extractor, music-manager, DSK renderer), add `src/metrics/pollers.js` (MediaMTX egress + storage gauges + orchestrator history), byte counting in stream-hls.js/radio.js, orchestrator burst lifetime + `GET /compute/burst/history`.
**Tests:** fake runner start/close → sink called with duration+purpose; poller delta/reset-detection with stubbed MediaMtxClient.
**Verify:** start+stop an RTMP relay; `ffmpeg.process_seconds.relay` and `egress.mediamtx_bytes` rows appear.

### Phase 3 — Prometheus exposition + monitoring compose
Create `docker-compose.monitoring.yml`, `ops/prometheus/prometheus.yml`; modify backend `GET /metrics` (+ `METRICS_TOKEN` gate), `lcyt-orchestrator/src/metrics.js` (prom-client rewrite, gauge fix), `lcyt-worker-daemon/src/index.js` (job timestamps + /metrics), both compose files (mediamtx 9998), `PORTS.md`, package.jsons.
**Tests:** orchestrator `/metrics` contains `# TYPE active_workers gauge` with preserved names; backend 404 without token / 200 with.
**Verify:** `docker compose -f docker-compose.orchestrator.yml -f docker-compose.monitoring.yml up`; Prometheus targets page shows 4/4 up.

### Phase 4 — Unified audit log
Create `src/middleware/write-audit.js`; modify `schema.js` (audit_log + migration + drop), `src/db/audit-log.js`, `routes/auth.js` + `routes/device-roles.js` (semantic events + throttle), `server.js` (mount), `routes/admin.js` (filters), `routes/orgs.js` + `/keys/:key/audit`, `index.js` (retention).
**Tests:** migration copies rows; middleware records `PUT /targets/:id` with template action + redacted body (no `password` value survives); skip-list honored; login-failure throttling; scoped queries role-gated.
**Verify:** login (good+bad), edit a target, run an admin user-update → all rows visible via `GET /admin/audit-log`.

### Phase 5 — Rollup REST + live panel
Create `src/routes/metrics.js` + query helpers; mount `/admin/metrics/*`, `/orgs/:id/usage`, `/keys/:key/usage`; SSE-gauge registrations feeding the live endpoint.
**Tests:** seeded rollups → correct grouping/org join; auth matrix (admin key / org member / non-member 403).

### Phase 6 — lcyt-web UI
Create `AdminMetricsPage.jsx`, `components/charts/{Sparkline,BarChart}.jsx`, Team usage tab; modify router + `navConfig.jsx` (metrics page; audit view under Admin), `AdminAuditLogPage.jsx` (filters/columns), `TeamPage.jsx`.
**Tests:** vitest component tests (fetch-mocked pages render series/rows).
**Verify:** `npm run web` against a seeded dev backend; check all three surfaces incl. live-panel refresh.

## 9. Risks / open items

- Exact DSK bus topic names for activation counting must be confirmed against `src/dsk-bus.js` emit sites before wiring the bus-tap map (the events catalog in `routes/events-catalog.js` has known mismatches — e.g. cue fires arrive as `plugin.cue_fired`).
- DSK renderer ffmpeg migration (renderer.js:491/:662) touches a fragile pipeline — manual timing fallback pre-approved.
- MediaMTX per-path byte counters reset on path recreation — poller reset detection must be unit-tested.
- `usage_rollups` UPSERT volume: worst case one row-key per project×metric×hour; flush batching keeps write amplification low, but watch flush duration on very large installs (metric available: flush time can be self-reported to prom).
