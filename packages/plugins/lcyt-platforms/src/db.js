/**
 * lcyt-platforms — DB migrations and CRUD helpers.
 *
 * Tables (see docs/plans/plan_broadcast_platform_sync.md § Schema):
 *   platform_credentials      — per-project OAuth credentials, one row per connected account
 *   broadcast_platform_links  — an LCYT broadcast ↔ an external platform broadcast
 *   broadcast_platform_stats  — live snapshots + one post-broadcast summary per link
 *
 * MULTI-CHANNEL (resolved decision #1): the source plan's original
 * `UNIQUE(api_key, platform)` is deliberately NOT what ships. A project may
 * connect several YouTube channels, so uniqueness is on
 * `(api_key, platform, external_account_id)` — reconnecting the *same* channel
 * replaces its row, connecting a *different* one adds a row.
 * `broadcast_platform_links.credential_id` records which account a given link
 * was created under, so a later stats poll or transition uses the same channel
 * that scheduled the broadcast even if the project has since connected others.
 *
 * Secrets never leave this module in the clear: rows carry `*_token_enc`
 * ciphertext (see crypto.js) and `maskCredential()` is the only shape any
 * route is allowed to return — mirroring `lcyt-connectors`' `maskConnector()`.
 */
import { randomUUID } from 'node:crypto';

/**
 * @param {import('better-sqlite3').Database} db
 */
export function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_credentials (
      id                  TEXT PRIMARY KEY,
      api_key             TEXT NOT NULL REFERENCES api_keys(key) ON DELETE CASCADE,
      platform            TEXT NOT NULL,
      external_account_id TEXT NOT NULL,
      account_label       TEXT,
      access_token_enc    TEXT NOT NULL,
      refresh_token_enc   TEXT NOT NULL,
      expires_at          TEXT NOT NULL,
      scopes              TEXT,
      connected_at        TEXT NOT NULL DEFAULT (datetime('now')),
      revoked_at          TEXT,
      UNIQUE (api_key, platform, external_account_id)
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_platform_credentials_key ON platform_credentials(api_key)');

  db.exec(`
    CREATE TABLE IF NOT EXISTS broadcast_platform_links (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      broadcast_id          TEXT NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
      platform              TEXT NOT NULL,
      credential_id         TEXT REFERENCES platform_credentials(id),
      external_broadcast_id TEXT NOT NULL,
      external_stream_id    TEXT,
      external_video_ids    TEXT,
      thumbnail_url         TEXT,
      last_status           TEXT,
      last_synced_at        TEXT,
      last_sync_error       TEXT,
      created_at            TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (broadcast_id, platform)
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_bpl_broadcast ON broadcast_platform_links(broadcast_id)');
  // Live links are polled on a loop; the poller filters on status, not broadcast.
  db.exec('CREATE INDEX IF NOT EXISTS idx_bpl_status ON broadcast_platform_links(last_status)');

  db.exec(`
    CREATE TABLE IF NOT EXISTS broadcast_platform_stats (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      broadcast_id            TEXT NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
      platform                TEXT NOT NULL,
      captured_at             TEXT NOT NULL DEFAULT (datetime('now')),
      kind                    TEXT NOT NULL,
      concurrent_viewers      INTEGER,
      views                   INTEGER,
      average_watch_time_s    INTEGER,
      peak_concurrent_viewers INTEGER
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_bps_broadcast ON broadcast_platform_stats(broadcast_id, kind, captured_at)');
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

/**
 * The only credential shape a route may return. Deliberately omits both
 * ciphertext columns entirely rather than emitting a redacted placeholder —
 * there is no client-side use for either, so the safest representation is
 * absence.
 * @param {object} row
 */
export function maskCredential(row) {
  if (!row) return null;
  return {
    credentialId: row.id,
    platform: row.platform,
    externalAccountId: row.external_account_id,
    accountLabel: row.account_label,
    scopes: row.scopes ? row.scopes.split(' ').filter(Boolean) : [],
    connectedAt: row.connected_at,
    revokedAt: row.revoked_at ?? null,
    // Useful to the UI ("reconnect needed") without revealing the token itself.
    expiresAt: row.expires_at,
  };
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {{ platform?: string, includeRevoked?: boolean }} [opts]
 */
export function listCredentials(db, apiKey, { platform, includeRevoked = false } = {}) {
  const where = ['api_key = ?'];
  const params = [apiKey];
  if (platform) { where.push('platform = ?'); params.push(platform); }
  if (!includeRevoked) where.push('revoked_at IS NULL');
  return db.prepare(
    `SELECT * FROM platform_credentials WHERE ${where.join(' AND ')} ORDER BY connected_at ASC`,
  ).all(...params);
}

/**
 * Fetch by id, scoped to a project so one project can never address another's
 * credential by guessing a uuid.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {string} id
 */
export function getCredential(db, apiKey, id) {
  return db.prepare('SELECT * FROM platform_credentials WHERE id = ? AND api_key = ?').get(id, apiKey) || null;
}

/**
 * Unscoped lookup, for the poller — it walks links, which already carry a
 * project-scoped credential_id, so there is no api_key in hand at that point.
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 */
export function getCredentialById(db, id) {
  return db.prepare('SELECT * FROM platform_credentials WHERE id = ?').get(id) || null;
}

/**
 * Resolve the credential to use when a caller didn't name one.
 *
 * Multi-channel makes "the project's YouTube account" ambiguous the moment a
 * second channel is connected, so this returns a discriminated result instead
 * of guessing: exactly one live account resolves, zero and many are distinct
 * errors the route layer turns into different messages.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {string} platform
 * @returns {{ ok: true, credential: object } | { ok: false, reason: 'none'|'ambiguous', candidates?: object[] }}
 */
export function getDefaultCredential(db, apiKey, platform) {
  const rows = listCredentials(db, apiKey, { platform });
  if (rows.length === 0) return { ok: false, reason: 'none' };
  if (rows.length > 1) return { ok: false, reason: 'ambiguous', candidates: rows.map(maskCredential) };
  return { ok: true, credential: rows[0] };
}

/**
 * Insert or replace the credential for (api_key, platform, external_account_id).
 *
 * Reconnecting the same channel refreshes its tokens and clears any prior
 * revocation — the operator re-consented, so the row is live again. Connecting
 * a different channel inserts alongside.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {{ platform: string, externalAccountId: string, accountLabel?: string,
 *           accessTokenEnc: string, refreshTokenEnc: string, expiresAt: string,
 *           scopes?: string }} fields
 * @returns {object} the stored row
 */
export function upsertCredential(db, apiKey, fields) {
  const {
    platform, externalAccountId, accountLabel = null,
    accessTokenEnc, refreshTokenEnc, expiresAt, scopes = null,
  } = fields;

  const existing = db.prepare(
    'SELECT id FROM platform_credentials WHERE api_key = ? AND platform = ? AND external_account_id = ?',
  ).get(apiKey, platform, externalAccountId);

  if (existing) {
    db.prepare(`
      UPDATE platform_credentials
         SET account_label = ?, access_token_enc = ?, refresh_token_enc = ?,
             expires_at = ?, scopes = ?, revoked_at = NULL,
             connected_at = datetime('now')
       WHERE id = ?
    `).run(accountLabel, accessTokenEnc, refreshTokenEnc, expiresAt, scopes, existing.id);
    return getCredentialById(db, existing.id);
  }

  const id = randomUUID();
  db.prepare(`
    INSERT INTO platform_credentials
      (id, api_key, platform, external_account_id, account_label,
       access_token_enc, refresh_token_enc, expires_at, scopes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, apiKey, platform, externalAccountId, accountLabel,
    accessTokenEnc, refreshTokenEnc, expiresAt, scopes);
  return getCredentialById(db, id);
}

/**
 * Persist a rotated access token after a refresh. The refresh token itself is
 * untouched — providers usually keep issuing the same one.
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 * @param {{ accessTokenEnc: string, expiresAt: string }} fields
 */
export function updateCredentialTokens(db, id, { accessTokenEnc, expiresAt }) {
  db.prepare('UPDATE platform_credentials SET access_token_enc = ?, expires_at = ? WHERE id = ?')
    .run(accessTokenEnc, expiresAt, id);
}

/**
 * Soft-delete: the row is kept for audit and never hard-deleted, per the plan.
 * @returns {boolean} whether a live credential was actually revoked
 */
export function revokeCredential(db, apiKey, id) {
  const info = db.prepare(
    "UPDATE platform_credentials SET revoked_at = datetime('now') WHERE id = ? AND api_key = ? AND revoked_at IS NULL",
  ).run(id, apiKey);
  return info.changes > 0;
}

// ---------------------------------------------------------------------------
// Broadcast ↔ platform links
// ---------------------------------------------------------------------------

/** @param {object} row */
export function formatLink(row) {
  if (!row) return null;
  return {
    platform: row.platform,
    credentialId: row.credential_id,
    externalBroadcastId: row.external_broadcast_id,
    externalStreamId: row.external_stream_id,
    externalVideoIds: row.external_video_ids ? JSON.parse(row.external_video_ids) : [],
    thumbnailUrl: row.thumbnail_url,
    lastStatus: row.last_status,
    lastSyncedAt: row.last_synced_at,
    lastSyncError: row.last_sync_error,
    createdAt: row.created_at,
  };
}

export function getLink(db, broadcastId, platform) {
  return db.prepare('SELECT * FROM broadcast_platform_links WHERE broadcast_id = ? AND platform = ?')
    .get(broadcastId, platform) || null;
}

export function listLinks(db, broadcastId) {
  return db.prepare('SELECT * FROM broadcast_platform_links WHERE broadcast_id = ? ORDER BY platform')
    .all(broadcastId);
}

/**
 * Create or update the single link for (broadcast, platform).
 * @param {import('better-sqlite3').Database} db
 * @param {{ broadcastId: string, platform: string, credentialId: string,
 *           externalBroadcastId: string, externalStreamId?: string|null,
 *           thumbnailUrl?: string|null, lastStatus?: string|null }} fields
 */
export function upsertLink(db, fields) {
  const {
    broadcastId, platform, credentialId, externalBroadcastId,
    externalStreamId = null, thumbnailUrl = null, lastStatus = null,
  } = fields;
  const existing = getLink(db, broadcastId, platform);
  if (existing) {
    // COALESCE so a schedule-update that doesn't re-fetch the stream id or
    // thumbnail doesn't blank out values an earlier call established.
    db.prepare(`
      UPDATE broadcast_platform_links
         SET credential_id = ?, external_broadcast_id = ?,
             external_stream_id = COALESCE(?, external_stream_id),
             thumbnail_url = COALESCE(?, thumbnail_url),
             last_status = COALESCE(?, last_status),
             last_synced_at = datetime('now'),
             last_sync_error = NULL
       WHERE id = ?
    `).run(credentialId, externalBroadcastId, externalStreamId, thumbnailUrl, lastStatus, existing.id);
    return getLink(db, broadcastId, platform);
  }
  db.prepare(`
    INSERT INTO broadcast_platform_links
      (broadcast_id, platform, credential_id, external_broadcast_id,
       external_stream_id, thumbnail_url, last_status, last_synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(broadcastId, platform, credentialId, externalBroadcastId,
    externalStreamId, thumbnailUrl, lastStatus);
  return getLink(db, broadcastId, platform);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {number} linkId
 * @param {{ lastStatus?: string, thumbnailUrl?: string, externalVideoIds?: string[], lastSyncError?: string|null }} patch
 */
export function updateLink(db, linkId, patch = {}) {
  const sets = [];
  const params = [];
  if (patch.lastStatus !== undefined) { sets.push('last_status = ?'); params.push(patch.lastStatus); }
  if (patch.thumbnailUrl !== undefined) { sets.push('thumbnail_url = ?'); params.push(patch.thumbnailUrl); }
  if (patch.externalVideoIds !== undefined) {
    sets.push('external_video_ids = ?');
    params.push(JSON.stringify(patch.externalVideoIds || []));
  }
  if (patch.lastSyncError !== undefined) { sets.push('last_sync_error = ?'); params.push(patch.lastSyncError); }
  if (!sets.length) return;
  sets.push("last_synced_at = datetime('now')");
  params.push(linkId);
  db.prepare(`UPDATE broadcast_platform_links SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

/**
 * Links the stats poller should be ticking — the ones whose external broadcast
 * is currently live. Re-read every tick rather than cached, so a broadcast that
 * ends (or is deleted) drops out on its own without every mutation path having
 * to remember to deregister it.
 * @param {import('better-sqlite3').Database} db
 */
export function listLiveLinks(db) {
  return db.prepare("SELECT * FROM broadcast_platform_links WHERE last_status = 'live'").all();
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export const STATS_LIVE_SNAPSHOT = 'live_snapshot';
export const STATS_POST_SUMMARY = 'post_broadcast_summary';

/** @param {object} row */
export function formatStats(row) {
  if (!row) return null;
  return {
    capturedAt: row.captured_at,
    kind: row.kind,
    concurrentViewers: row.concurrent_viewers,
    views: row.views,
    averageWatchTimeSec: row.average_watch_time_s,
    peakConcurrentViewers: row.peak_concurrent_viewers,
  };
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ broadcastId: string, platform: string, kind: string,
 *           concurrentViewers?: number|null, views?: number|null,
 *           averageWatchTimeSec?: number|null, peakConcurrentViewers?: number|null }} fields
 */
export function insertStats(db, fields) {
  const {
    broadcastId, platform, kind,
    concurrentViewers = null, views = null,
    averageWatchTimeSec = null, peakConcurrentViewers = null,
  } = fields;
  db.prepare(`
    INSERT INTO broadcast_platform_stats
      (broadcast_id, platform, kind, concurrent_viewers, views, average_watch_time_s, peak_concurrent_viewers)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(broadcastId, platform, kind, concurrentViewers, views, averageWatchTimeSec, peakConcurrentViewers);
}

export function getLatestStats(db, broadcastId, platform, kind) {
  const where = ['broadcast_id = ?', 'platform = ?'];
  const params = [broadcastId, platform];
  if (kind) { where.push('kind = ?'); params.push(kind); }
  return db.prepare(
    `SELECT * FROM broadcast_platform_stats WHERE ${where.join(' AND ')} ORDER BY captured_at DESC, id DESC LIMIT 1`,
  ).get(...params) || null;
}

/**
 * Full time series for one broadcast/platform — tier 3 ("historical trend")
 * needs no extra table, it is just this query.
 */
export function listStats(db, broadcastId, platform, { kind, limit = 1000 } = {}) {
  const where = ['broadcast_id = ?', 'platform = ?'];
  const params = [broadcastId, platform];
  if (kind) { where.push('kind = ?'); params.push(kind); }
  params.push(limit);
  return db.prepare(
    `SELECT * FROM broadcast_platform_stats WHERE ${where.join(' AND ')} ORDER BY captured_at ASC, id ASC LIMIT ?`,
  ).all(...params);
}

/**
 * Peak concurrent viewers observed across the live snapshots — what the
 * post-broadcast summary reports when the provider's analytics API doesn't
 * supply its own peak figure (YouTube Analytics does not expose one directly).
 */
export function peakConcurrentFromSnapshots(db, broadcastId, platform) {
  const row = db.prepare(`
    SELECT MAX(concurrent_viewers) AS peak
      FROM broadcast_platform_stats
     WHERE broadcast_id = ? AND platform = ? AND kind = ?
  `).get(broadcastId, platform, STATS_LIVE_SNAPSHOT);
  return row?.peak ?? null;
}
