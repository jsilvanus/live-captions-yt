# Database Layer

LCYT uses **SQLite** for both the Node.js and Python backends. SQLite is the right choice for the current single-server deployment: it requires no external service, the DB file is trivially backed up, and `better-sqlite3`'s synchronous model removes async complexity from the Express request path.

---

## Overview

| Backend | Library | Mode |
|---------|---------|------|
| Node.js (`packages/lcyt-backend`) | [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3) | Synchronous (blocks per call, no async/await) |
| Python (`python-packages/lcyt-backend`) | stdlib `sqlite3` | Synchronous, WAL journal mode, `check_same_thread=False` |

**File location:** controlled by the `DB_PATH` environment variable. Defaults to `./lcyt-backend.db` next to the package root in both backends.

**Session model:** Active sessions live in an in-memory `Map` (`store.js`). The DB is used for restart recovery: sessions are persisted to the `sessions` table on create/update and reloaded via `rehydrate()` on startup.

---

## Node.js Backend Tables

Source: `packages/lcyt-backend/src/db.js`

### `api_keys`

Primary key management table. One row per issued API key.

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `id` | INTEGER PK AUTOINCREMENT | | |
| `key` | TEXT UNIQUE | | The API key value (UUID) |
| `owner` | TEXT | | Human-readable label |
| `email` | TEXT | NULL | Optional contact email |
| `active` | INTEGER | 1 | 0 = revoked |
| `revoked_at` | TEXT | NULL | ISO timestamp set on revoke |
| `expires_at` | TEXT | NULL | ISO timestamp; NULL = never expires |
| `created_at` | TEXT | `datetime('now')` | |
| `daily_limit` | INTEGER | NULL | Max captions per day; NULL = unlimited |
| `lifetime_limit` | INTEGER | NULL | Max captions ever; NULL = unlimited |
| `lifetime_used` | INTEGER | 0 | Incremented by `checkAndIncrementUsage` |
| `sequence` | INTEGER | 0 | Last YouTube caption sequence number |
| `last_caption_at` | TEXT | NULL | Timestamp of last caption; drives 2h TTL reset |
| `backend_file_enabled` | INTEGER | 0 | 1 = key may use `/file` endpoint |
| `relay_allowed` | INTEGER | 0 | 1 = admin has granted RTMP relay permission |
| `relay_active` | INTEGER | 0 | 1 = user has toggled relay on |

### `caption_usage`

Per-key daily caption counts for enforcing `daily_limit`.

| Column | Type | Notes |
|--------|------|-------|
| `api_key` | TEXT | |
| `date` | TEXT | `YYYY-MM-DD` |
| `count` | INTEGER | 0 default; incremented atomically |

Primary key: `(api_key, date)`. Rows are inserted or incremented via `ON CONFLICT ... DO UPDATE`.

### `sessions`

Persistent session metadata. Written on session create/update; deleted on session teardown. Loaded at startup to rebuild the in-memory store after a server restart.

| Column | Type | Notes |
|--------|------|-------|
| `session_id` | TEXT PK | SHA-256 of `apiKey:streamKey:domain` |
| `api_key` | TEXT | |
| `stream_key` | TEXT | NULL in target-array mode |
| `domain` | TEXT | Originating domain |
| `sequence` | INTEGER | 0 default; incremented by `incSessionSequence` |
| `started_at` | TEXT | ISO timestamp |
| `last_activity` | TEXT | ISO timestamp; updated on each caption |
| `sync_offset` | INTEGER | NTP-style clock offset in ms |
| `mic_holder` | TEXT | Session ID of current mic lock holder |
| `data` | TEXT | JSON blob for extensible per-session metadata |

### `session_stats`

Telemetry record written once when a session ends. Never updated after insert.

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK AUTOINCREMENT | |
| `session_id` | TEXT | |
| `api_key` | TEXT | |
| `domain` | TEXT | |
| `started_at` | TEXT | ISO timestamp |
| `ended_at` | TEXT | ISO timestamp |
| `duration_ms` | INTEGER | |
| `captions_sent` | INTEGER | 0 default |
| `captions_failed` | INTEGER | 0 default |
| `final_sequence` | INTEGER | 0 default |
| `ended_by` | TEXT | `'client'` \| `'timeout'` \| `'server'` |

### `caption_errors`

Log of YouTube caption delivery failures. Retained per key, pruned with revoked keys.

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK AUTOINCREMENT | |
| `api_key` | TEXT | |
| `session_id` | TEXT | |
| `timestamp` | TEXT | ISO timestamp |
| `error_code` | INTEGER | HTTP status from YouTube; NULL for network errors |
| `error_msg` | TEXT | |
| `batch_size` | INTEGER | 1 default |

### `auth_events`

Audit log for authentication failures and rate-limit rejections.

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK AUTOINCREMENT | |
| `api_key` | TEXT | NULL if key not yet resolved |
| `event_type` | TEXT | e.g. `'unknown_key'`, `'daily_limit_exceeded'` |
| `timestamp` | TEXT | ISO timestamp |
| `domain` | TEXT | |

### `domain_hourly_stats`

Per-domain usage aggregated by UTC hour. All counters are accumulated via upsert.

| Column | Type | Notes |
|--------|------|-------|
| `date` | TEXT | `YYYY-MM-DD` |
| `hour` | INTEGER | 0–23 UTC |
| `domain` | TEXT | |
| `sessions_started` | INTEGER | 0 default |
| `sessions_ended` | INTEGER | 0 default |
| `captions_sent` | INTEGER | 0 default |
| `captions_failed` | INTEGER | 0 default |
| `batches_sent` | INTEGER | 0 default |
| `total_duration_ms` | INTEGER | 0 default |
| `peak_sessions` | INTEGER | 0 default; updated via `MAX(peak_sessions, excluded.peak_sessions)` |

Primary key: `(date, hour, domain)`.

### `caption_files`

Metadata for caption files saved server-side via the `/file` endpoint. Actual file content lives on disk (`FILES_DIR` env var).

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK AUTOINCREMENT | |
| `api_key` | TEXT | |
| `session_id` | TEXT | NULL if uploaded out-of-session |
| `filename` | TEXT | User-visible name |
| `lang` | TEXT | BCP-47 language tag; NULL = unknown |
| `format` | TEXT | `'youtube'` default |
| `type` | TEXT | `'captions'` default |
| `created_at` | TEXT | `datetime('now')` |
| `updated_at` | TEXT | `datetime('now')` |
| `size_bytes` | INTEGER | 0 default; updated after file write |

### `rtmp_relays`

RTMP fan-out configuration. Each API key may configure up to 4 target slots.

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK AUTOINCREMENT | |
| `api_key` | TEXT | |
| `slot` | INTEGER | 1–4 |
| `target_url` | TEXT | RTMP ingest URL |
| `target_name` | TEXT | Optional stream name appended to URL |
| `caption_mode` | TEXT | `'http'` (default) or `'rtmp'` |
| `created_at` | TEXT | `datetime('now')` |
| `updated_at` | TEXT | `datetime('now')` |

Unique constraint: `(api_key, slot)`. Upserted via `ON CONFLICT(api_key, slot) DO UPDATE`.

### `rtmp_stream_stats`

Per-relay-stream telemetry. One row opened on relay start, completed on relay end.

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK AUTOINCREMENT | |
| `api_key` | TEXT | |
| `slot` | INTEGER | 1 default |
| `target_url` | TEXT | |
| `target_name` | TEXT | |
| `caption_mode` | TEXT | `'http'` default |
| `started_at` | TEXT | ISO timestamp |
| `ended_at` | TEXT | NULL until relay ends |
| `duration_ms` | INTEGER | 0 default |
| `captions_sent` | INTEGER | 0 default |

### `rtmp_anon_daily_stats`

Anonymous daily RTMP totals — no API key or URL stored. Endpoint categorised as `'youtube'` or `'custom'` by URL pattern.

| Column | Type | Notes |
|--------|------|-------|
| `date` | TEXT | `YYYY-MM-DD` |
| `endpoint_type` | TEXT | `'youtube'` \| `'custom'` |
| `caption_mode` | TEXT | `'http'` default |
| `streams_count` | INTEGER | 0 default |
| `duration_seconds` | INTEGER | 0 default |

Primary key: `(date, endpoint_type, caption_mode)`.

### `icons`

Metadata for user-uploaded PNG/SVG branding icons. File content lives on disk (`ICONS_DIR` env var).

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK AUTOINCREMENT | |
| `api_key` | TEXT | |
| `filename` | TEXT | User-visible name |
| `disk_filename` | TEXT | Unique on-disk name (to avoid collisions) |
| `mime_type` | TEXT | `'image/png'` default |
| `created_at` | TEXT | `datetime('now')` |
| `size_bytes` | INTEGER | 0 default |

### `viewer_key_daily_stats`

Per-viewer-key daily view counts, scoped to the owning API key.

| Column | Type | Notes |
|--------|------|-------|
| `date` | TEXT | `YYYY-MM-DD` |
| `api_key` | TEXT | |
| `viewer_key` | TEXT | |
| `views` | INTEGER | 0 default; incremented via upsert |

Primary key: `(date, api_key, viewer_key)`.

### `viewer_anon_daily_stats`

Global anonymous viewer stats — one row per day.

| Column | Type | Notes |
|--------|------|-------|
| `date` | TEXT PK | `YYYY-MM-DD` |
| `views` | INTEGER | 0 default; incremented via upsert |

---

## Python Backend Tables

Source: `python-packages/lcyt-backend/lcyt_backend/db.py`

The Python backend is a feature-subset implementation. It currently only maintains the `api_keys` table:

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK AUTOINCREMENT | |
| `key` | TEXT UNIQUE | |
| `owner` | TEXT | |
| `created_at` | TEXT | `datetime('now')` |
| `expires_at` | TEXT | NULL = never |
| `active` | INTEGER | 1 = active, 0 = revoked |

No quota, relay, sequence, or session tables exist in the Python backend.

---

## Key Patterns

### Additive Migrations

There are no migration files. On startup, `initDb()` inspects existing columns via `PRAGMA table_info(table_name)` and issues `ALTER TABLE ... ADD COLUMN` for any columns that are missing. This means:

- It is always safe to run on an existing database.
- Columns are never removed or renamed by the migration system.
- Destructive schema changes (e.g. the `rtmp_relays` slot fan-out) are handled by renaming the old table, creating the new one, migrating data, and dropping the old table — wrapped in a transaction.

### Upsert Pattern

Counters are maintained without a read-before-write by using `INSERT ... ON CONFLICT ... DO UPDATE SET`:

```sql
INSERT INTO caption_usage (api_key, date, count) VALUES (?, ?, 1)
ON CONFLICT (api_key, date) DO UPDATE SET count = count + 1
```

The same pattern is used for `domain_hourly_stats`, `sessions`, `rtmp_relays`, `rtmp_anon_daily_stats`, `viewer_key_daily_stats`, and `viewer_anon_daily_stats`.

### Transactions

`better-sqlite3` transactions are synchronous and atomic:

```js
db.transaction(() => {
  // all statements here run inside BEGIN/COMMIT
  stmts.incrementLifetime.run(key);
  stmts.incrementDaily.run(key, today);
})();
```

Transactions are used for: quota check-and-increment (`checkAndIncrementUsage`), GDPR key anonymisation (`anonymizeKey`), revoked key bulk deletion (`cleanRevokedKeys`), and the `rtmp_relays` schema migration.

### Prepared Statement Cache

`checkAndIncrementUsage` compiles its prepared statements once per `db` instance and caches them in a `WeakMap`. This avoids repeated statement compilation on the hot caption-send path:

```js
const cache = new WeakMap();
return function checkAndIncrementUsage(db, key) {
  if (!cache.has(db)) {
    cache.set(db, { getLimits: db.prepare('...'), ... });
  }
  const stmts = cache.get(db);
  // ...
};
```

### Sequence Tracking

YouTube's caption ingestion API requires a monotonically increasing sequence number per broadcast. The sequence is tracked at two levels:

- **Session level** (`sessions.sequence`): incremented atomically by `incSessionSequence` for each caption delivered. Used during an active session.
- **Key level** (`api_keys.sequence` + `api_keys.last_caption_at`): persisted at session end and reloaded at the start of the next session. A 2-hour inactivity TTL (hardcoded as `KEY_SEQUENCE_TTL_MS = 2h`) resets the sequence to 0 so YouTube doesn't reject stale sequence numbers after a gap.

---

## Backup System

Source: `packages/lcyt-backend/src/backup.js`

`better-sqlite3`'s built-in `.backup()` method performs an online hot backup — safe to run while the database is in use.

**`runBackup(db, backupDir)`** — writes a copy to `<backupDir>/YYYY-MM-DD/lcyt-backend.db`.

**`cleanOldBackups(backupDir, backupDays)`** — removes backup directories older than `backupDays` days. Only removes directories whose names match `YYYY-MM-DD`.

**Configuration:**

| Env var | Default | Notes |
|---------|---------|-------|
| `BACKUP_DIR` | — | If unset, backup is disabled |
| `BACKUP_DAYS` | 0 | Retention period in days (0 = disabled, max 180) |

Backup and cleanup are scheduled via `setInterval` in `src/index.js` on server startup.

---

## Configuration Reference

| Env var | Default | Purpose |
|---------|---------|---------|
| `DB_PATH` | `./lcyt-backend.db` (relative to package root) | SQLite file path — applies to both Node.js and Python backends |
| `BACKUP_DIR` | — | Root directory for DB backups (Node.js only) |
| `BACKUP_DAYS` | 0 (disabled) | Backup retention period: 1–180 days |
