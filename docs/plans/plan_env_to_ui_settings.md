---
id: plan/env_to_ui_settings
title: "Server Settings in the UI — Migrating Configuration from Env Vars to DB-Backed Admin Settings"
status: implemented
summary: "Moves the bulk of lcyt-backend's ~130 environment variables into a DB-backed, admin-editable Server Settings surface (new server_settings table + settings registry/service + Admin UI page), with a strict precedence of env > DB > built-in default so 12-factor deployments keep working and env-set values appear UI-locked. A small bootstrap tier (ports, paths, secrets that gate the process itself, anything whose value is executed) deliberately stays env-only. The system must boot and relay captions with zero configuration — no env beyond what already auto-defaults today, and no UI setup. Phases 1–6 implemented 2026-07-21 (registry/service/schema, admin API, Admin UI, lcyt-backend's own call-site migration incl. the RTMP/music hot-gate rewrite, then lcyt-files/lcyt-music/lcyt-rtmp/lcyt-dsk/lcyt-production/lcyt-agent all wired). **Not done:** lcyt-agent's VISION_PREVIEW_BASE_URL and lcyt-production's CAMERA_PREVIEW_BASE_URL/CAMERA_THUMBNAILS_DIR are registered but not yet read through SettingsService — see CONSIDER.md."
related: plan/selfservice_config_backend, plan/admin, plan/setup_wizard, plan/site_feature_policies, plan/metering_audit, plan/cloudfleet
---

# Server Settings in the UI — Env → DB-Backed Admin Settings

## Motivation

`lcyt-backend` is configured almost entirely through environment variables —
the reference table in `packages/lcyt-backend/CLAUDE.md` lists well over a
hundred, and `.env.example` only covers a fraction of them. This made sense
when the backend was a thin relay, but the product now has a full admin panel
(`plan_admin.md`), a Setup Wizard (`plan_setup_wizard.md`), per-project
self-service config in the DB (`plan_selfservice_config_backend.md`:
`caption_targets`, `translation_vendor_config`, STT config, `ai_config`), and
site-wide policy tables (`plan_site_feature_policies.md`). Server-level
configuration is the last surface that still requires shell access and a
process restart to change.

Concrete pains today:

- **Toggling a feature (`RTMP_RELAY_ACTIVE`, `MUSIC_DETECTION_ACTIVE`,
  `GRAPHICS_ENABLED`, `FREE_APIKEY_ACTIVE`) requires editing the environment
  and restarting** — even though the admin panel already manages per-project
  and per-org feature policy in the DB.
- **Contact info, retention windows, STT provider defaults, S3 credentials,
  embedding API keys** are all deploy-time decisions that are really runtime
  admin decisions.
- **No visibility**: an admin cannot see the effective configuration anywhere;
  diagnosing "why is radio HLS not working" means reading the process
  environment on the host.
- **`.env.example` drift**: the example file, the CLAUDE.md table, and the
  actual `process.env.*` read sites disagree about names and defaults.

### Goal

**Most settings become UI-editable** (stored in the DB, managed from a new
Admin → Server Settings page), **while the system continues to work for its
basic purpose with zero configuration** — no `.env`, no UI setup: boot,
`POST /live`, send captions to YouTube. Environment variables remain supported
as a deployment-level override for every migrated setting, so existing
docker-compose stacks and the Cloudfleet tiers (`plan_cloudfleet.md`) keep
working unchanged.

---

## Design principles

### 1. Precedence: `env` > `DB` > `built-in default`

For every migrated setting, the effective value resolves in this order:

1. **Environment variable set** → env value wins. The UI shows the setting as
   **read-only with an "env-locked" badge** ("managed by the environment").
2. **Else, DB row exists** (`server_settings`) → DB value wins. This is the
   normal UI-managed state.
3. **Else** → built-in default from the settings registry.

*Why env wins (and not the DB):* the alternative (DB overrides env) silently
diverges a running server from its compose file — the worst kind of drift for
fleet deployments, and it makes env useless as an ops "pin this value"
mechanism. With env-wins, 12-factor behaviour is exactly what it is today; a
deployment opts into UI control simply by **not setting** the variable. The
migration story for an existing install is: slim your `.env` down to the
bootstrap tier (§ Tier A), enter the remaining values once in the UI, keep in
env only what you want pinned.

### 2. Zero-config baseline (acceptance criterion)

A fresh checkout with **no environment and no UI configuration** must:

- boot on port 3000 with SQLite at `./lcyt-backend.db`;
- auto-generate `JWT_SECRET` (with the existing startup warning);
- serve `POST /live` → `POST /captions` → YouTube ingestion end-to-end;
- leave every optional subsystem (RTMP relay, radio, music, graphics upload,
  server STT, orchestrator) cleanly **off by default**, exactly as today.

Admin settings become editable once admin access exists — `ADMIN_KEY` (env,
Tier A) or an `is_admin` user. That is not a regression: admin routes are
already disabled without `ADMIN_KEY` today.

### 3. Some things must never be DB-editable

A DB-backed setting is writable by anyone holding admin credentials over HTTP.
Three classes stay **env-only forever** (Tier A below):

- **Bootstrap / chicken-and-egg**: values needed before or while opening the
  DB, or that define the process itself — `DB_PATH`, `PORT`, `HOST`,
  `NODE_ENV`, `TRUST_PROXY`, `STATIC_DIR`.
- **Secrets that gate the settings surface itself**: `JWT_SECRET`,
  `ADMIN_KEY`, `BACKEND_INTERNAL_TOKEN` / `WORKER_AUTH_TOKEN` /
  `ORCHESTRATOR_INTERNAL_TOKEN` (shared with *other processes'* env — a DB
  value on one side can't keep them in sync), `METRICS_TOKEN`.
- **Anything whose value is executed or dereferenced as code/binary/path**:
  `NGINX_RELOAD_CMD`, `NGINX_TEST_CMD` (arbitrary shell), `FFMPEG_WRAPPER`,
  `PLAYWRIGHT_DSK_CHROMIUM`, `GOOGLE_APPLICATION_CREDENTIALS`, `DOCKER_HOST`,
  container image names (`FFMPEG_IMAGE`, `DSK_RENDERER_IMAGE`, `DSK_IMAGE`),
  and every filesystem mount path (`*_DIR`, `*_ROOT`, `NGINX_RADIO_CONFIG_PATH`,
  `BACKUP_DIR`). Making these UI-writable converts "admin panel compromise"
  into "remote code execution / arbitrary file write" — not acceptable.

Tier A settings still appear in the Admin UI, **read-only**, with their
effective value (secrets masked as "set"/"unset") and source, so admins
finally get one place to *see* the whole configuration even where they can't
edit it.

---

## Current state (what exists, don't rebuild)

- **~130 `process.env.*` read sites** across `lcyt-backend` and the plugins
  (`lcyt-rtmp` is the heaviest, then `lcyt-dsk`, `lcyt-agent`, `lcyt-music`,
  `lcyt-files`, `lcyt-connectors`). Reads are scattered: some at request time
  (cheap to migrate, hot-reloadable), some at manager construction inside
  plugin `init*()` (needs reconfigure hooks or restart-required flagging),
  and a few gate **route mounting** in `server.js` (`RTMP_RELAY_ACTIVE`,
  `MUSIC_DETECTION_ACTIVE`).
- **DB-config precedent**: `ai_config`, `translation_vendor_config`,
  `caption_targets`, STT config — all per-project (`api_key`-scoped). This
  plan adds the missing **site-scope** equivalent; it does not touch
  per-project config.
- **Admin surface**: `AdminTabShell.jsx` + `Admin*Page.jsx` pages, all gated
  by `X-Admin-Key` or `is_admin` JWT; `write-audit` middleware and the unified
  `audit_log` (`plan_metering_audit.md`) already capture admin mutations.
- **EventBus** (`plan_pubsub_event_bus.md`): the natural channel for
  `settings.changed` notifications to managers/timers.
- **Plugin DI convention** (root `CLAUDE.md`): plugins receive `db`, `store`,
  `auth`, `relayManager` at init — a `settings` service slots into the same
  injection point.

---

## Setting tiers

### Tier A — env-only (bootstrap / infra / executed values)

Stays exactly as today; surfaced read-only in the UI. Full list per § Design
principle 3, plus the worker-daemon/orchestrator processes' own env (below,
Out of scope).

### Tier B — UI-managed (DB-backed, env-overridable)

Everything else. By category (mirroring `.env.example` groups; the registry in
Phase 1 is the authoritative enumeration):

| Category | Settings (env names today) | Apply mode |
|---|---|---|
| Application | `PUBLIC_URL`, `BACKEND_URL`, `ALLOWED_DOMAINS`, `ALLOWED_RTMP_DOMAINS`, `FREE_APIKEY_ACTIVE`, `USE_USER_LOGINS`, `FEATURE_GATE_ENFORCE`, `USAGE_PUBLIC`, `LOGIN_RATE_LIMIT_MAX`, `YOUTUBE_CLIENT_ID`, `BRIDGE_DOWNLOAD_BASE_URL` | hot |
| Contact | `CONTACT_NAME`, `CONTACT_EMAIL`, `CONTACT_PHONE`, `CONTACT_WEBSITE` | hot |
| Sessions & retention | `SESSION_TTL`, `CLEANUP_INTERVAL`, `REVOKED_KEY_TTL_DAYS`, `REVOKED_KEY_CLEANUP_INTERVAL`, `EVENT_LOG_RETENTION_DAYS`, `EVENT_LOG_CLEANUP_INTERVAL`, `AUDIT_LOG_RETENTION_DAYS`, `STATS_RETENTION_DAYS`, `USAGE_FLUSH_INTERVAL_MS`, `USAGE_ROLLUP_HOURLY_RETENTION_DAYS`, `ROLLUP_MAINTENANCE_INTERVAL`, `BROADCAST_ARCHIVE_MIN_AGE_DAYS` | timer |
| Media pipeline | `RTMP_RELAY_ACTIVE`, `RADIO_HLS_SOURCE`, `RTMP_HOST`, `RTMP_APP`/`RTMP_APPLICATION`, `HLS_LOCAL_RTMP`, `HLS_RTMP_APP`, `HLS_SUBS_SEGMENT_DURATION`, `HLS_SUBS_WINDOW_SIZE`, `RADIO_LOCAL_RTMP`, `RADIO_RTMP_APP`, `NGINX_RADIO_PREFIX`, `PREVIEW_INTERVAL_S`, `CEA708_*`, `CROP_OUTPUT_DEFAULT` | manager / restart |
| MediaMTX | `MEDIAMTX_API_URL`, `MEDIAMTX_HLS_BASE_URL`, `MEDIAMTX_RTSP_BASE_URL`, `MEDIAMTX_RTMP_BASE_URL`, `MEDIAMTX_WEBRTC_BASE_URL`, `MEDIAMTX_API_USER`, `MEDIAMTX_API_PASSWORD` *(secret)*, `MEDIAMTX_LOG_LEVEL` | manager |
| Compute | `FFMPEG_RUNNER`, `WORKER_DAEMON_URL`, `COMPUTE_ORCHESTRATOR_URL`, `ORCHESTRATOR_URL`, `ORCHESTRATOR_FALLBACK`, `DOCKER_BUILD_TIMEOUT_MS` | restart |
| Storage | `FILE_STORAGE`, `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_PREFIX`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` *(secret)*, `FILES_CACHE_LIMIT` | manager |
| Graphics / DSK | `GRAPHICS_ENABLED`, `GRAPHICS_MAX_FILE_BYTES`, `GRAPHICS_MAX_STORAGE_BYTES`, `DSK_LOCAL_SERVER`, `DSK_LOCAL_RTMP`, `DSK_RTMP_APP`, `DSK_PAGE_BASE_URL` | hot / manager |
| STT | `STT_PROVIDER`, `STT_DEFAULT_LANGUAGE`, `STT_AUDIO_SOURCE`, `GOOGLE_STT_KEY` *(secret)*, `GOOGLE_STT_MODE`, `WHISPER_HTTP_URL`, `WHISPER_HTTP_MODEL`, `OPENAI_STT_URL`, `OPENAI_STT_API_KEY` *(secret)*, `OPENAI_STT_MODEL` | hot (read per STT start) |
| AI / embeddings | `EMBEDDING_API_URL`, `EMBEDDING_API_KEY` *(secret)*, `EMBEDDING_MODEL` | hot |
| Music | `MUSIC_DETECTION_ACTIVE`, `MUSIC_CLASSIFIER_URL` | hot / manager |
| Metrics | `METRICS_PROJECT_LABELS` | hot |

Notes:

- **Server-level defaults vs per-project config**: STT and embedding settings
  above are the *server-level defaults / server-provided providers* — the
  per-project overrides in `stt config` and `ai_config` are untouched and
  continue to win for their project, exactly as today.
- `USE_USER_LOGINS` is Tier B but flagged **restart** and guarded in the UI
  with an explicit confirmation (turning it off can lock every non-admin out).

### Out of scope (their env stays)

- **`lcyt-orchestrator` and `lcyt-worker-daemon`** — separate processes with
  no DB or admin UI (`HETZNER_*`, `WARM_POOL_SIZE`, `BURST_*`, `WORKER_*`,
  `AUTOSCALER_*`). A follow-up could have them fetch settings from the backend
  over their existing authenticated channel; explicitly not in this plan.
- **`lcyt-bridge`**, the Python backend, both MCP servers, the CLI
  (`~/.lcyt-config.json` precedence is its own documented system).
- **Per-project config** (targets, translation, STT config, AI config, feature
  flags) — already DB-backed and self-service.
- **Secrets encryption at rest** — see Security notes.

---

## Architecture

### 1. `server_settings` table

```sql
CREATE TABLE IF NOT EXISTS server_settings (
  key        TEXT PRIMARY KEY,          -- registry key, e.g. 'contact.email'
  value      TEXT NOT NULL,             -- JSON-encoded value
  updated_at INTEGER NOT NULL,          -- ms epoch
  updated_by TEXT                       -- 'admin-key' | user id
);
```

Site-scope, one row per explicitly-saved setting. Absence of a row means
"fall through to env/default" — the table never mirrors defaults, so registry
default changes take effect without migration.

### 2. Settings registry — `packages/lcyt-backend/src/settings/registry.js`

One declarative entry per setting; the single source of truth that replaces
the drifting `.env.example` / CLAUDE.md tables:

```js
{
  key: 'contact.email',        // dotted, category-prefixed
  env: 'CONTACT_EMAIL',        // legacy env var (override + back-compat)
  type: 'string',              // string|int|bool|enum|url|csv|secret|json
  default: '',
  category: 'contact',
  tier: 'ui',                  // 'ui' (Tier B) | 'env' (Tier A, read-only)
  apply: 'hot',                // 'hot' | 'timer' | 'manager' | 'restart'
  enum: undefined,             // for type 'enum'
  validate: (v) => true,       // extra validation beyond type coercion
  description: 'Contact e-mail returned by GET /contact',
}
```

Type coercion is centralised here (today every read site hand-rolls
`=== '1'` / `parseInt` / `.split(',')` with subtle inconsistencies).

### 3. `SettingsService` — `packages/lcyt-backend/src/settings/service.js`

- `get(key)` → effective value (env > DB > default), from an in-memory cache
  loaded at startup and invalidated on write. Synchronous, like the rest of
  the better-sqlite3 data layer.
- `source(key)` → `'env' | 'db' | 'default'`.
- `set(key, value, { updatedBy })` → validates against the registry, rejects
  Tier A keys and env-locked keys (409 semantics), writes the DB row, updates
  the cache, publishes `settings.changed { key, source: 'db' }` on the shared
  EventBus.
- `clear(key, { updatedBy })` → deletes the row (revert to env/default),
  publishes `settings.changed`.
- `snapshot()` → full effective config for the admin GET route and for the
  restart-required diff (the boot-time snapshot of `apply: 'restart'` keys is
  kept; a divergence between it and the current effective value marks the key
  "pending restart").

Constructed in `server.js` right after the DB opens, injected everywhere
`process.env` is read today — including into plugin `init*()` dependency
objects, following the existing plugin-DI convention.

### 4. Apply modes

- **hot** — the read site already runs per request / per operation; migrating
  the read from `process.env.X` to `settings.get('x')` makes changes take
  effect immediately. This includes the route-mount gates: `server.js` stops
  conditionally mounting `/rtmp`, `/stream`, `/ingestion`, `/music` and
  instead mounts them always behind a tiny middleware that returns the same
  status as an unmounted route (404) when the toggle is off — turning
  `RTMP_RELAY_ACTIVE` and `MUSIC_DETECTION_ACTIVE` into hot settings.
- **timer** — retention/cleanup intervals: `index.js`'s timers are wrapped in
  a small re-arm helper subscribed to `settings.changed`.
- **manager** — plugin managers (MediaMTX client, storage adapter, Nginx
  radio config, music manager) get a `reconfigure(newValues)` hook where
  cheap, otherwise fall back to restart-required flagging. Reconfigure scope
  is deliberately conservative: connection URLs/credentials yes; topology
  changes (e.g. `RADIO_HLS_SOURCE`) no — flagged restart.
- **restart** — value is captured at composition time (`FFMPEG_RUNNER`
  factory choice, compute URLs). The setting saves fine; the UI and
  `GET /admin/settings` show a "restart required" banner listing pending keys.

### 5. Admin API — `src/routes/admin-settings.js`

Mounted under `/admin`, same auth as the rest of `routes/admin.js`
(`X-Admin-Key` or `is_admin` JWT), covered by `write-audit` (values of
`secret`-typed settings are never written to the audit log — key name only).

```
GET    /admin/settings            — registry + effective values grouped by
                                    category; secrets masked ('***' / unset);
                                    per key: { value, source, tier, apply,
                                    pendingRestart, type, enum, description }
PUT    /admin/settings            — batch { values: { key: value } };
                                    all-or-nothing validation; 409 on Tier A
                                    or env-locked keys
DELETE /admin/settings/:key       — revert key to env/default
POST   /admin/settings/probe/:kind — optional connection tests (s3, mediamtx,
                                    whisper, openai, embedding); Phase 6
```

### 6. Admin UI — `AdminServerSettingsPage.jsx`

New tab in `AdminTabShell` ("Server"). Per category section:

- field types driven by the registry metadata (toggle, number, text, enum
  select, CSV chips, secret);
- **source badge** per setting: *Default* / *Saved* / *Env-locked* (read-only,
  with the env var name shown so the admin knows what to unset to take UI
  control);
- **secrets are write-only**: shown as "set"/"not set" with Replace / Clear
  actions, never echoed back;
- sticky **"Restart required"** banner when any pending-restart key diverges;
- Tier A section at the bottom: the read-only effective view of bootstrap/infra
  settings;
- destructive-ish toggles (`USE_USER_LOGINS`, `FEATURE_GATE_ENFORCE`) use the
  shared `ConfirmDialog.jsx`.

The Setup Wizard gets a small admin-only pointer card ("Server settings have
moved to Admin → Server") — no wizard redesign in this plan.

---

## Security notes

- **Secrets at rest**: stored plaintext in SQLite, consistent with the
  existing precedent (`ai_config.embedding_api_key`,
  `translation_vendor_config` credentials, user password hashes aside). All
  read paths mask; audit log records key names only. Encrypting at rest
  (keyfile/KMS) is deliberately deferred — doing it only for this table would
  be false comfort while sibling tables hold equivalent secrets; if done, it
  should be one repo-wide pass. Log this as a CONSIDER.md item when
  implementing.
- **No executed values in the DB** — enforced structurally: Tier A keys are
  rejected by `SettingsService.set()` regardless of route-level checks.
- **Env-locked rejection is server-side**, not just UI affordance.
- CSRF/authz surface is unchanged: same admin middleware as existing
  `/admin/*` mutation routes.

---

## Phases

### Phase 1 — Registry, service, table (no behaviour change)

- `server_settings` migration in `db/schema.js`; helpers in
  `src/db/server-settings.js` (thin, per the DB-module convention).
- `src/settings/registry.js` enumerating **every** current env var (Tier A
  and B), with types/defaults transcribed from the actual read sites — where
  the CLAUDE.md table and code disagree, the code wins and the discrepancy is
  noted in the commit.
- `src/settings/service.js` with precedence, cache, EventBus publication.
- **Golden tests**: for a matrix of env fixtures, `settings.get()` must equal
  the value the current scattered parsing produces (guards against silent
  coercion drift — the riskiest part of this whole plan).

### Phase 2 — Admin API

- `GET/PUT/DELETE /admin/settings*` routes + write-audit integration +
  restart-pending diff. Route tests: auth, masking, 409 on locked/Tier A,
  all-or-nothing batch validation, revert.

### Phase 3 — Admin UI

- `AdminServerSettingsPage.jsx` + `AdminTabShell` tab; registry-driven field
  rendering; source badges; secrets write-only flow; restart banner;
  ConfirmDialog on flagged toggles. Vitest component tests.

### Phase 4 — Core backend call-site migration

- Migrate `lcyt-backend`'s own reads by category: contact route, application
  toggles (including the route-mount → request-gate change for
  `RTMP_RELAY_ACTIVE` / `MUSIC_DETECTION_ACTIVE`), login rate limit, session
  TTL + all retention timers (timer re-arm helper), YouTube client id, bridge
  download base URL. Each category lands as its own commit with tests proving
  a DB write takes effect without restart where `apply` says so.

### Phase 5 — Plugin integration

- Extend plugin `init*()` dependency objects with `settings`; migrate reads in
  `lcyt-rtmp` (largest: MediaMTX URLs/credentials, HLS/radio/preview tuning,
  STT provider defaults), `lcyt-files` (storage adapter selection + S3),
  `lcyt-dsk`, `lcyt-music`, `lcyt-agent` (server embedding defaults),
  `lcyt-connectors`. Add `reconfigure()` where cheap (MediaMTX client,
  storage adapter credential swap); everything else flags restart-required.
  Plugin CLAUDE.md env tables gain a "UI-managed since" note.

### Phase 6 — Docs, polish, probes

- Rewrite `.env.example`: a short **bootstrap section** (Tier A) plus a
  pointer — "everything else is configured in Admin → Server; env vars remain
  as overrides, see the settings registry".
- Update `packages/lcyt-backend/CLAUDE.md` env table with a Source/Tier
  column; root `CLAUDE.md` Configuration convention updated (server config:
  "env for bootstrap + overrides, DB/UI for the rest").
- Optional `POST /admin/settings/probe/:kind` connection tests wired to
  Storage / MediaMTX / STT / embeddings cards.
- `docs/PLANS.md` status flip.

---

## Testing strategy

- **Phase 1 golden tests** are the backbone: precedence (env beats DB beats
  default), coercion parity with legacy parsing, Tier A write rejection,
  `settings.changed` emission.
- Route tests per Phase 2; component tests per Phase 3.
- Per-category integration tests in Phases 4–5: write via `PUT
  /admin/settings`, observe behaviour change (or restart-pending flag)
  without process restart.
- Zero-config boot test: start `server.js` with a scrubbed env and assert the
  baseline (§ Design principle 2) — health, live session, defaults, optional
  subsystems off.

## Risks

- **Coercion drift** during call-site migration — mitigated by the golden
  tests and category-by-category commits.
- **Module-load-time env reads** in plugins (some values are captured in
  top-level constants): each such site must be found and either deferred to
  init-time or flagged `restart`. The Phase 1 registry audit doubles as this
  inventory.
- **Restart-required creep**: if too much lands as `restart`, the UI feels
  broken. Counter: the categories users will actually touch (application
  toggles, contact, retention, STT/AI/S3 credentials) are all hot/timer/
  manager by design; `restart` is reserved for compute topology.
- **Scope creep toward orchestrator/worker settings** — explicitly out of
  scope; revisit only after this ships.
