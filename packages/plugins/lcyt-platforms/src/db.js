/**
 * lcyt-platforms — CRUD helpers on the Prisma client from lcyt-backend's initDb().
 *
 * Tables (created by the backend schema; see docs/plans/plan_broadcast_platform_sync.md § Schema).
 * Every function is async:
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

/** No-op kept for old callers: the tables come from the backend schema. */
export async function runMigrations() {}

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
 * @param {import('lcyt-backend/db').Db} db
 * @param {string} apiKey
 * @param {{ platform?: string, includeRevoked?: boolean }} [opts]
 */
export async function listCredentials(db, apiKey, { platform, includeRevoked = false } = {}) {
  const where = { api_key: apiKey };
  if (platform) where.platform = platform;
  if (!includeRevoked) where.revoked_at = null;
  return db.platform_credentials.findMany({ where, orderBy: { connected_at: 'asc' } });
}

/**
 * Fetch by id, scoped to a project so one project can never address another's
 * credential by guessing a uuid.
 * @param {import('lcyt-backend/db').Db} db
 * @param {string} apiKey
 * @param {string} id
 */
export async function getCredential(db, apiKey, id) {
  return (await db.platform_credentials.findFirst({ where: { id, api_key: apiKey } })) || null;
}

/**
 * Unscoped lookup, for the poller — it walks links, which already carry a
 * project-scoped credential_id, so there is no api_key in hand at that point.
 * @param {import('lcyt-backend/db').Db} db
 * @param {string} id
 */
export async function getCredentialById(db, id) {
  return (await db.platform_credentials.findUnique({ where: { id } })) || null;
}

/**
 * Resolve the credential to use when a caller didn't name one.
 *
 * Multi-channel makes "the project's YouTube account" ambiguous the moment a
 * second channel is connected, so this returns a discriminated result instead
 * of guessing: exactly one live account resolves, zero and many are distinct
 * errors the route layer turns into different messages.
 *
 * @param {import('lcyt-backend/db').Db} db
 * @param {string} apiKey
 * @param {string} platform
 * @returns {Promise<{ ok: true, credential: object } | { ok: false, reason: 'none'|'ambiguous', candidates?: object[] }>}
 */
export async function getDefaultCredential(db, apiKey, platform) {
  const rows = await listCredentials(db, apiKey, { platform });
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
 * @param {import('lcyt-backend/db').Db} db
 * @param {string} apiKey
 * @param {{ platform: string, externalAccountId: string, accountLabel?: string,
 *           accessTokenEnc: string, refreshTokenEnc: string, expiresAt: string,
 *           scopes?: string }} fields
 * @returns {Promise<object>} the stored row
 */
export async function upsertCredential(db, apiKey, fields) {
  const {
    platform, externalAccountId, accountLabel = null,
    accessTokenEnc, refreshTokenEnc, expiresAt, scopes = null,
  } = fields;

  const existing = await db.platform_credentials.findFirst({
    where: { api_key: apiKey, platform, external_account_id: externalAccountId },
    select: { id: true },
  });

  if (existing) {
    await db.platform_credentials.updateMany({
      where: { id: existing.id },
      data: {
        account_label: accountLabel, access_token_enc: accessTokenEnc, refresh_token_enc: refreshTokenEnc,
        expires_at: expiresAt, scopes, revoked_at: null, connected_at: db.$util.sqlNow(),
      },
    });
    return getCredentialById(db, existing.id);
  }

  const id = randomUUID();
  await db.platform_credentials.create({
    data: {
      id, api_key: apiKey, platform, external_account_id: externalAccountId, account_label: accountLabel,
      access_token_enc: accessTokenEnc, refresh_token_enc: refreshTokenEnc, expires_at: expiresAt, scopes,
    },
  });
  return getCredentialById(db, id);
}

/**
 * Persist a rotated access token after a refresh. The refresh token itself is
 * untouched — providers usually keep issuing the same one.
 * @param {import('lcyt-backend/db').Db} db
 * @param {string} id
 * @param {{ accessTokenEnc: string, expiresAt: string }} fields
 */
export async function updateCredentialTokens(db, id, { accessTokenEnc, expiresAt }) {
  await db.platform_credentials.updateMany({
    where: { id },
    data: { access_token_enc: accessTokenEnc, expires_at: expiresAt },
  });
}

/**
 * Soft-delete: the row is kept for audit and never hard-deleted, per the plan.
 * @returns {Promise<boolean>} whether a live credential was actually revoked
 */
export async function revokeCredential(db, apiKey, id) {
  const info = await db.platform_credentials.updateMany({
    where: { id, api_key: apiKey, revoked_at: null },
    data: { revoked_at: db.$util.sqlNow() },
  });
  return info.count > 0;
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

export async function getLink(db, broadcastId, platform) {
  return (await db.broadcast_platform_links.findUnique({
    where: { broadcast_id_platform: { broadcast_id: broadcastId, platform } },
  })) || null;
}

export async function listLinks(db, broadcastId) {
  const rows = await db.broadcast_platform_links.findMany({ where: { broadcast_id: broadcastId } });
  return rows.sort((a, b) => (a.platform < b.platform ? -1 : a.platform > b.platform ? 1 : 0));
}

/**
 * Create or update the single link for (broadcast, platform).
 * @param {import('lcyt-backend/db').Db} db
 * @param {{ broadcastId: string, platform: string, credentialId: string,
 *           externalBroadcastId: string, externalStreamId?: string|null,
 *           thumbnailUrl?: string|null, lastStatus?: string|null }} fields
 */
export async function upsertLink(db, fields) {
  const {
    broadcastId, platform, credentialId, externalBroadcastId,
    externalStreamId = null, thumbnailUrl = null, lastStatus = null,
  } = fields;
  const existing = await getLink(db, broadcastId, platform);
  const ts = db.$util.sqlNow();
  if (existing) {
    // A schedule-update that doesn't re-fetch the stream id or thumbnail
    // must not blank out values an earlier call established.
    await db.broadcast_platform_links.updateMany({
      where: { id: existing.id },
      data: {
        credential_id: credentialId,
        external_broadcast_id: externalBroadcastId,
        external_stream_id: externalStreamId ?? existing.external_stream_id,
        thumbnail_url: thumbnailUrl ?? existing.thumbnail_url,
        last_status: lastStatus ?? existing.last_status,
        last_synced_at: ts,
        last_sync_error: null,
      },
    });
    return getLink(db, broadcastId, platform);
  }
  await db.broadcast_platform_links.create({
    data: {
      broadcast_id: broadcastId, platform, credential_id: credentialId,
      external_broadcast_id: externalBroadcastId, external_stream_id: externalStreamId,
      thumbnail_url: thumbnailUrl, last_status: lastStatus, last_synced_at: ts,
    },
  });
  return getLink(db, broadcastId, platform);
}

/**
 * @param {import('lcyt-backend/db').Db} db
 * @param {number} linkId
 * @param {{ lastStatus?: string, thumbnailUrl?: string, externalVideoIds?: string[], lastSyncError?: string|null }} patch
 */
export async function updateLink(db, linkId, patch = {}) {
  const data = {};
  if (patch.lastStatus !== undefined) data.last_status = patch.lastStatus;
  if (patch.thumbnailUrl !== undefined) data.thumbnail_url = patch.thumbnailUrl;
  if (patch.externalVideoIds !== undefined) data.external_video_ids = JSON.stringify(patch.externalVideoIds || []);
  if (patch.lastSyncError !== undefined) data.last_sync_error = patch.lastSyncError;
  if (!Object.keys(data).length) return;
  data.last_synced_at = db.$util.sqlNow();
  await db.broadcast_platform_links.updateMany({ where: { id: linkId }, data });
}

/**
 * Links the stats poller should be ticking — the ones whose external broadcast
 * is currently live. Re-read every tick rather than cached, so a broadcast that
 * ends (or is deleted) drops out on its own without every mutation path having
 * to remember to deregister it.
 * @param {import('lcyt-backend/db').Db} db
 */
export async function listLiveLinks(db) {
  return db.broadcast_platform_links.findMany({ where: { last_status: 'live' } });
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
 * @param {import('lcyt-backend/db').Db} db
 * @param {{ broadcastId: string, platform: string, kind: string,
 *           concurrentViewers?: number|null, views?: number|null,
 *           averageWatchTimeSec?: number|null, peakConcurrentViewers?: number|null }} fields
 */
export async function insertStats(db, fields) {
  const {
    broadcastId, platform, kind,
    concurrentViewers = null, views = null,
    averageWatchTimeSec = null, peakConcurrentViewers = null,
  } = fields;
  await db.broadcast_platform_stats.create({
    data: {
      broadcast_id: broadcastId, platform, kind,
      concurrent_viewers: concurrentViewers, views,
      average_watch_time_s: averageWatchTimeSec, peak_concurrent_viewers: peakConcurrentViewers,
    },
  });
}

export async function getLatestStats(db, broadcastId, platform, kind) {
  const where = { broadcast_id: broadcastId, platform };
  if (kind) where.kind = kind;
  return (await db.broadcast_platform_stats.findFirst({
    where,
    orderBy: [{ captured_at: 'desc' }, { id: 'desc' }],
  })) || null;
}

/**
 * Full time series for one broadcast/platform — tier 3 ("historical trend")
 * needs no extra table, it is just this query.
 */
export async function listStats(db, broadcastId, platform, { kind, limit = 1000 } = {}) {
  const where = { broadcast_id: broadcastId, platform };
  if (kind) where.kind = kind;
  return db.broadcast_platform_stats.findMany({
    where,
    orderBy: [{ captured_at: 'asc' }, { id: 'asc' }],
    take: limit,
  });
}

/**
 * Peak concurrent viewers observed across the live snapshots — what the
 * post-broadcast summary reports when the provider's analytics API doesn't
 * supply its own peak figure (YouTube Analytics does not expose one directly).
 */
export async function peakConcurrentFromSnapshots(db, broadcastId, platform) {
  const agg = await db.broadcast_platform_stats.aggregate({
    where: { broadcast_id: broadcastId, platform, kind: STATS_LIVE_SNAPSHOT },
    _max: { concurrent_viewers: true },
  });
  return agg._max.concurrent_viewers ?? null;
}
