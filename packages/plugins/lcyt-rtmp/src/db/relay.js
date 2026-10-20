import { ownerOfPrimaryFeedKey } from './feeds.js';
import { resolveOutputRoute } from '../output-routing.js';

/**
 * Get a full api_keys row by key value.
 * Used by RTMP routes to read per-key config (e.g. cea708_delay_ms).
 * @param {object} db  Prisma client
 * @param {string} key
 * @returns {Promise<object|null>}
 */
export async function getKey(db, key) {
  return (await db.api_keys.findUnique({ where: { key } })) ?? null;
}

/**
 * Resolve an incoming nginx-rtmp/MediaMTX stream `name` to the api_key it
 * belongs to. When a project has rotated its ingest stream key
 * (`api_keys.ingest_stream_key`), broadcasters publish using that rotated
 * value instead of the literal api_key — this looks it up. Falls back to
 * treating `name` as the literal api_key when no rotated key matches
 * (today's behavior, unchanged for any key that has never rotated).
 *
 * @param {object} db  Prisma client
 * @param {string} name  nginx-rtmp `$name` / MediaMTX stream name
 * @returns {Promise<string>} the resolved api_key
 */
export async function resolveApiKeyFromIngestStreamKey(db, name) {
  const row = await db.api_keys.findFirst({ where: { ingest_stream_key: name }, select: { key: true } });
  if (row) return row.key;
  // The primary feed's key is the truth since feeds-and-devices PR 8 (renaming it need not touch ingest_stream_key).
  const owner = await ownerOfPrimaryFeedKey(db, name);
  return owner ?? name;
}

// ─── RTMP relay config per API key (fan-out: arbitrary number of slots —
// plan_ingest_feeds.md §1b removed the earlier 4-slot cap) ────────────────────

/**
 * Check whether RTMP relay is allowed for an API key.
 * @param {object} db  Prisma client
 * @param {string} apiKey
 * @returns {Promise<boolean>}
 */
export async function isRelayAllowed(db, apiKey) {
  const row = await db.api_keys.findUnique({ where: { key: apiKey }, select: { relay_allowed: true } });
  return row ? row.relay_allowed === 1 : false;
}

// ─── Radio (RTMP → audio-only HLS) ───────────────────────────────────────────

/**
 * Check whether the audio-only HLS "radio" feature is enabled for an API key.
 * The api_key must have radio_enabled = 1 (set by admin via PATCH /keys/:key).
 *
 * @param {object} db  Prisma client
 * @param {string} apiKey
 * @returns {Promise<boolean>}
 */
export async function isRadioEnabled(db, apiKey) {
  const row = await db.api_keys.findUnique({ where: { key: apiKey }, select: { radio_enabled: true } });
  return row ? row.radio_enabled === 1 : false;
}

// ─── HLS (RTMP → video+audio HLS embed) ──────────────────────────────────────

/**
 * Check whether the video+audio HLS embed feature is enabled for an API key.
 * The api_key must have hls_enabled = 1 (set by admin via PATCH /keys/:key).
 *
 * @param {object} db  Prisma client
 * @param {string} apiKey
 * @returns {Promise<boolean>}
 */
export async function isHlsEnabled(db, apiKey) {
  const row = await db.api_keys.findUnique({ where: { key: apiKey }, select: { hls_enabled: true } });
  return row ? row.hls_enabled === 1 : false;
}

// ─── Per-key CORS origin for embeddable player endpoints ──────────────────────

/**
 * Get the CORS `Access-Control-Allow-Origin` value for the embeddable player.js
 * and HLS endpoints of an API key.  Defaults to `'*'` (allow all origins) when
 * the key does not exist or the column is NULL.
 *
 * @param {object} db  Prisma client
 * @param {string} apiKey
 * @returns {Promise<string>}  e.g. `'*'` or `'https://example.com'`
 */
export async function getEmbedCors(db, apiKey) {
  const row = await db.api_keys.findUnique({ where: { key: apiKey }, select: { embed_cors: true } });
  return row?.embed_cors || '*';
}

/**
 * Check whether the user has activated the RTMP relay for this key.
 * relay_active is a user-controlled toggle (set via PUT /stream/active).
 * Both relay_allowed (admin permission) and relay_active (user toggle) must be
 * true for the fan-out to start when nginx sends an on_publish callback.
 *
 * @param {object} db  Prisma client
 * @param {string} apiKey
 * @returns {Promise<boolean>}
 */
export async function isRelayActive(db, apiKey) {
  const row = await db.api_keys.findUnique({ where: { key: apiKey }, select: { relay_active: true } });
  return row ? row.relay_active === 1 : false;
}

/**
 * Set the relay_active flag for an API key.
 * @param {object} db  Prisma client
 * @param {string} apiKey
 * @param {boolean} active
 * @returns {Promise<boolean>} true if the key was found and updated
 */
export async function setRelayActive(db, apiKey, active) {
  const result = await db.api_keys.updateMany({ where: { key: apiKey }, data: { relay_active: active ? 1 : 0 } });
  return result.count > 0;
}

/**
 * Map a raw rtmp_relays row to a plain object.
 * @param {object} row
 * @returns {object}
 */
function formatRelayRow(row) {
  return {
    id:           row.id,
    apiKey:       row.api_key,
    slot:         row.slot,
    targetUrl:    row.target_url,
    targetName:   row.target_name  || null,
    captionMode:  row.caption_mode || 'http',
    recordOnStart: row.record_on_start === 1,
    recordOnButton: row.record_on_button === 1,
    // Per-slot transcoding options (null = use stream copy for this slot)
    scale:        row.scale        || null,
    fps:          row.fps          ?? null,
    videoBitrate: row.video_bitrate || null,
    audioBitrate: row.audio_bitrate || null,
    // 'program' (raw ingest, default) or 'crop' ({key}-crop vertical rendition) —
    // ignored when sourceFeedId is set
    sourceView:   row.source_view  || 'program',
    // Optional prod_feeds.id source (Feeds card). The resolved MediaMTX path is joined in as sourceFeedKey, which is
    // what rtmp-manager.js reads.
    sourceFeedId:    row.source_feed_id || null,
    sourceFeedKey:   row.source_feed_key || null,
    // Optional outputs.id source (egress outputs). sourceFeedKey / sourceView above already carry the resolved route (see
    // withSourceFeedKeys); sourceAudioPath is the audio feed's path when the output replaces the sound.
    sourceOutputId:  row.source_output_id || null,
    sourceAudioPath: row.source_audio_path || null,
    createdAt:    row.created_at,
    updatedAt:    row.updated_at,
  };
}

// The source feed's MediaMTX path is looked up separately and attached to each row, so rtmp-manager.js (which has no
// db handle of its own) can use it directly.
async function withSourceFeedKeys(db, rows) {
  const feedIds = [...new Set(rows.map(r => r.source_feed_id).filter(Boolean))];
  const feedKeys = new Map();
  if (feedIds.length) {
    const feeds = await db.prod_feeds.findMany({ where: { id: { in: feedIds } }, select: { id: true, feed_key: true } });
    for (const f of feeds) feedKeys.set(f.id, f.feed_key);
  }
  // A feed that no longer exists resolves to null: the slot then sends the project's program/crop view.
  const out = rows.map(r => ({ ...r, source_feed_key: r.source_feed_id ? (feedKeys.get(r.source_feed_id) ?? null) : null }));
  // Slots that send an output (source_feed_id wins when both are set): the output's route decides the source. A route that
  // is the main stream or the default crop leaves the slot on the old 'program' / 'crop' handling (an old 'crop' slot never
  // silently turns into a program slot); any other route fans out that MediaMTX path like a feed-sourced slot.
  for (const r of out) {
    if (!r.source_output_id || r.source_feed_key) continue;
    const route = await resolveOutputRoute(db, r.api_key, r.source_output_id);
    if (!route) continue;
    if (route.kind === 'path') {
      r.source_feed_key = route.path;
      r.source_audio_path = route.audioPath;
    } else if (route.kind === 'crop') {
      r.source_view = 'crop';
    }
  }
  return out;
}

/**
 * Get all configured relay slots for an API key.
 * @param {object} db  Prisma client
 * @param {string} apiKey
 * @returns {Promise<object[]>} ordered by slot ascending
 */
export async function getRelays(db, apiKey) {
  const rows = await db.rtmp_relays.findMany({ where: { api_key: apiKey }, orderBy: { slot: 'asc' } });
  return (await withSourceFeedKeys(db, rows)).map(formatRelayRow);
}

/**
 * Get a specific relay slot for an API key.
 * @param {object} db  Prisma client
 * @param {string} apiKey
 * @param {number} slot
 * @returns {Promise<object|null>}
 */
export async function getRelaySlot(db, apiKey, slot) {
  const row = await db.rtmp_relays.findUnique({ where: { api_key_slot: { api_key: apiKey, slot } } });
  if (!row) return null;
  const [withKey] = await withSourceFeedKeys(db, [row]);
  return formatRelayRow(withKey);
}

/**
 * @deprecated Use getRelays() or getRelaySlot(). Kept for migration compatibility.
 */
export async function getRelay(db, apiKey) {
  return getRelaySlot(db, apiKey, 1);
}

/**
 * Build the full ffmpeg-ready target URL from relay config.
 * If targetName is set, it is appended as the RTMP stream name.
 * @param {{ targetUrl: string, targetName: string|null }} relay
 * @returns {string}
 */
export function buildRelayFfmpegUrl(relay) {
  if (relay.targetName) {
    return `${relay.targetUrl.replace(/\/$/, '')}/${relay.targetName}`;
  }
  return relay.targetUrl;
}

/**
 * Create or replace a relay slot for an API key.
 * slot must be a positive integer — no upper bound (plan_ingest_feeds.md §1b
 * removes the earlier 4-slot cap; a future per-team quota is a deliberate
 * non-goal of that plan, not enforced here).
 * @param {object} db  Prisma client
 * @param {string} apiKey
 * @param {number} slot  positive integer
 * @param {string} targetUrl
 * @param {{ targetName?: string|null, captionMode?: string, recordOnStart?: boolean, recordOnButton?: boolean, scale?: string|null, fps?: number|null, videoBitrate?: string|null, audioBitrate?: string|null, sourceView?: 'program'|'crop', sourceFeedId?: string|null, sourceOutputId?: string|null }} [opts]
 * @returns {Promise<object>}
 */
export async function upsertRelay(db, apiKey, slot, targetUrl, { targetName = null, captionMode = 'http', recordOnStart = false, recordOnButton = false, scale = null, fps = null, videoBitrate = null, audioBitrate = null, sourceView = 'program', sourceFeedId = null, sourceOutputId = null } = {}) {
  if (!Number.isInteger(slot) || slot < 1) {
    throw new RangeError(`slot must be a positive integer, got ${slot}`);
  }
  if (sourceView !== 'program' && sourceView !== 'crop') {
    throw new RangeError(`sourceView must be 'program' or 'crop', got ${sourceView}`);
  }
  const values = {
    target_url: targetUrl,
    target_name: targetName || null,
    caption_mode: captionMode || 'http',
    record_on_start: recordOnStart ? 1 : 0,
    record_on_button: recordOnButton ? 1 : 0,
    scale: scale || null,
    fps: fps ?? null,
    video_bitrate: videoBitrate || null,
    audio_bitrate: audioBitrate || null,
    source_view: sourceView,
    source_feed_id: sourceFeedId || null,
    source_output_id: sourceOutputId || null,
  };
  const now = db.$util.sqlNow();
  await db.rtmp_relays.upsert({
    where: { api_key_slot: { api_key: apiKey, slot } },
    create: { api_key: apiKey, slot, ...values, created_at: now, updated_at: now },
    update: { ...values, updated_at: now },
  });
  return getRelaySlot(db, apiKey, slot);
}

/**
 * Resolve a relay's source feed to its MediaMTX path (feed_key), scoped to the requesting project. A feed is only
 * resolvable by the project that owns it; an unknown feed and another project's feed both give null.
 * @param {object} db  Prisma client
 * @param {string} feedId
 * @param {string} requestingApiKey
 * @returns {Promise<string|null>}
 */
export async function resolveRelaySourceFeedKey(db, feedId, requestingApiKey) {
  const row = await db.prod_feeds.findUnique({ where: { id: feedId }, select: { feed_key: true, owner_api_key: true } });
  if (!row || row.owner_api_key !== requestingApiKey) return null;
  return row.feed_key;
}

/**
 * Every distinct apiKey with a relay slot sourced from this feed.
 * @param {object} db  Prisma client
 * @param {string} feedId
 * @returns {Promise<string[]>}
 */
export async function getApiKeysReferencingFeed(db, feedId) {
  const rows = await db.rtmp_relays.findMany({ where: { source_feed_id: feedId }, distinct: ['api_key'], select: { api_key: true } });
  return rows.map(r => r.api_key);
}

/**
 * Whether the project has any relay slot that sends an output (egress outputs).
 * @param {object} db  Prisma client
 * @param {string} apiKey
 * @returns {Promise<boolean>}
 */
export async function hasOutputSlots(db, apiKey) {
  const row = await db.rtmp_relays.findFirst({ where: { api_key: apiKey, source_output_id: { not: null } }, select: { id: true } });
  return !!row;
}

/**
 * Delete a specific relay slot for an API key.
 * @param {object} db  Prisma client
 * @param {string} apiKey
 * @param {number} slot
 * @returns {Promise<boolean>} true if a row was deleted
 */
export async function deleteRelaySlot(db, apiKey, slot) {
  const result = await db.rtmp_relays.deleteMany({ where: { api_key: apiKey, slot } });
  return result.count > 0;
}

/**
 * Delete all relay slots for an API key.
 * @param {object} db  Prisma client
 * @param {string} apiKey
 * @returns {Promise<number>} number of rows deleted
 */
export async function deleteAllRelays(db, apiKey) {
  const result = await db.rtmp_relays.deleteMany({ where: { api_key: apiKey } });
  return result.count;
}

/**
 * @deprecated Use deleteAllRelays(). Kept for migration compatibility.
 */
export async function deleteRelay(db, apiKey) {
  return (await deleteAllRelays(db, apiKey)) > 0;
}

// ─── RTMP stream stats (per-stream, personified) ─────────────────────────────

/**
 * Categorise a target URL into a broad endpoint type for anonymous stats.
 * @param {string} targetUrl
 * @returns {'youtube'|'custom'}
 */
function categoriseEndpoint(targetUrl) {
  return /(?:^|[./])youtube\.com(?:[/:?]|$)|(?:^|[./])youtu\.be(?:[/:?]|$)/i.test(targetUrl) ? 'youtube' : 'custom';
}

/**
 * Insert a new RTMP stream stat record (call when relay starts).
 * @param {object} db  Prisma client
 * @param {{ apiKey: string, slot?: number, targetUrl: string, targetName?: string|null, captionMode?: string, startedAt?: string }} data
 * @returns {Promise<number>} The row id
 */
export async function writeRtmpStreamStart(db, { apiKey, slot = 1, targetUrl, targetName = null, captionMode = 'http', startedAt }) {
  const row = await db.rtmp_stream_stats.create({
    data: {
      api_key: apiKey,
      slot,
      target_url: targetUrl,
      target_name: targetName || null,
      caption_mode: captionMode || 'http',
      started_at: startedAt || new Date().toISOString(),
    },
  });
  return row.id;
}

/**
 * Complete an RTMP stream stat record when the relay ends.
 * @param {object} db  Prisma client
 * @param {{ streamStatId: number, endedAt?: string, durationMs: number, captionsSent?: number }} data
 */
export async function writeRtmpStreamEnd(db, { streamStatId, endedAt, durationMs, captionsSent = 0 }) {
  await db.rtmp_stream_stats.updateMany({
    where: { id: streamStatId },
    data: { ended_at: endedAt || new Date().toISOString(), duration_ms: Math.round(durationMs), captions_sent: captionsSent },
  });
}

/**
 * Get all RTMP stream stats for an API key.
 * @param {object} db  Prisma client
 * @param {string} apiKey
 * @returns {Promise<object[]>}
 */
export async function getRtmpStreamStats(db, apiKey) {
  const rows = await db.rtmp_stream_stats.findMany({
    where: { api_key: apiKey },
    orderBy: { id: 'desc' },
    take: 100,
  });
  return rows.map(r => ({
    id: r.id,
    slot: r.slot,
    targetUrl: r.target_url,
    targetName: r.target_name,
    captionMode: r.caption_mode,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    durationMs: db.$util.num(r.duration_ms),
    captionsSent: r.captions_sent,
  }));
}

/**
 * Increment anonymous RTMP daily stats when a relay stream ends.
 * @param {object} db  Prisma client
 * @param {{ targetUrl: string, captionMode?: string, durationMs: number }} data
 */
export async function incrementRtmpAnonDailyStat(db, { targetUrl, captionMode = 'http', durationMs }) {
  const date = new Date().toISOString().slice(0, 10);
  const endpointType = categoriseEndpoint(targetUrl);
  const durationSeconds = Math.round(durationMs / 1000);
  const mode = captionMode || 'http';
  await db.rtmp_anon_daily_stats.upsert({
    where: { date_endpoint_type_caption_mode: { date, endpoint_type: endpointType, caption_mode: mode } },
    create: { date, endpoint_type: endpointType, caption_mode: mode, streams_count: 1, duration_seconds: durationSeconds },
    update: { streams_count: { increment: 1 }, duration_seconds: { increment: durationSeconds } },
  });
}
