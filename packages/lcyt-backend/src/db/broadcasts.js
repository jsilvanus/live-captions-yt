/**
 * Broadcast DB helpers — first-class intra-project casting occasion.
 * (plan/broadcasts) A project (`api_key`) has many broadcasts; each has a
 * lifecycle (draft → scheduled → live → completed → archived), optional
 * schedule, and linked reusable assets. Produced content (sessions,
 * session_stats, caption_files) attaches back via a nullable `broadcast_id`.
 *
 * Route handlers stay thin and delegate all SQL here (backend DB convention).
 */

import { randomUUID } from 'node:crypto';
import { getCaptionFile } from './files.js';
import { getActiveBroadcastId, setActiveBroadcastId } from './keys.js';
import { sqlNow, num } from './helpers.js';

export const BROADCAST_STATUSES = new Set([
  'draft', 'scheduled', 'live', 'completed', 'archived',
]);

/** Statuses a PUT may not set by hand. */
const LIFECYCLE_ONLY_STATUSES = new Set(['live', 'completed']);

export const BROADCAST_ASSET_TYPES = new Set([
  'graphic', 'cue', 'action', 'icon', 'target', 'rundown',
]);

/**
 * Visibility a broadcast is created with on an external platform
 * (lcyt-platforms). These are YouTube's `status.privacyStatus` values; a
 * future provider whose vocabulary differs maps them in its own adapter
 * rather than widening this set.
 */
export const PRIVACY_STATUSES = new Set(['public', 'unlisted', 'private']);

/**
 * Deliberately not 'public'. A broadcast accidentally created public is a
 * worse failure than one accidentally created unlisted, so the safe value is
 * the default and going public is an explicit act.
 */
export const DEFAULT_PRIVACY_STATUS = 'unlisted';

/** Minimum days a broadcast must be archived before it can be hard-deleted. */
export function archiveMinAgeDays() {
  const v = Number(process.env.BROADCAST_ARCHIVE_MIN_AGE_DAYS);
  return Number.isFinite(v) && v >= 0 ? v : 30;
}

/**
 * Shape a DB row to the API representation (camelCase, parsed JSON).
 * @param {object} row
 * @returns {object}
 */
function formatRow(row) {
  return {
    id:                 row.id,
    title:              row.title,
    description:        row.description ?? null,
    status:             row.status,
    scheduledStart:     row.scheduled_start ?? null,
    scheduledEnd:       row.scheduled_end ?? null,
    actualStart:        row.actual_start ?? null,
    actualEnd:          row.actual_end ?? null,
    youtubeVideoIds:    row.youtube_video_ids ? JSON.parse(row.youtube_video_ids) : [],
    youtubeBroadcastId: row.youtube_broadcast_id ?? null,
    rundownFileId:      row.rundown_file_id ?? null,
    recordEnabled:      Boolean(row.record_enabled),
    privacyStatus:      row.privacy_status ?? 'unlisted',
    armed:              Boolean(row.armed),
    archivedAt:         row.archived_at ?? null,
    createdAt:          row.created_at,
    updatedAt:          row.updated_at,
  };
}

function formatAsset(row) {
  return {
    id:         row.id,
    assetType:  row.asset_type,
    assetRef:   row.asset_ref,
    sortOrder:  row.sort_order,
    createdAt:  row.created_at,
  };
}

function formatBroadcastFile(row) {
  return {
    id:        row.link_id,
    fileId:    row.file_id,
    filename:  row.filename,
    lang:      row.lang ?? null,
    format:    row.format,
    type:      row.type,
    sizeBytes: num(row.size_bytes) ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Files linked to a broadcast (newest link first), in the formatBroadcastFile row shape. */
async function queryBroadcastFiles(db, apiKey, id) {
  const links = await db.broadcast_files.findMany({
    where: { broadcast_id: id, caption_files: { api_key: apiKey } },
    include: { caption_files: true },
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
  });
  return links.map((bf) => formatBroadcastFile({
    link_id: bf.id, file_id: bf.file_id,
    filename: bf.caption_files.filename, lang: bf.caption_files.lang, format: bf.caption_files.format,
    type: bf.caption_files.type, size_bytes: bf.caption_files.size_bytes,
    created_at: bf.caption_files.created_at, updated_at: bf.caption_files.updated_at,
  }));
}

async function clearActiveBroadcastIfMatches(db, apiKey, id) {
  if (await getActiveBroadcastId(db, apiKey) === id) await setActiveBroadcastId(db, apiKey, null);
}

function isUnique(e) {
  return e?.code === 'P2002';
}

/**
 * List broadcasts for a project.
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @param {{ status?: string, includeArchived?: boolean, from?: string, to?: string }} [opts]
 * @returns {Promise<object[]>}
 */
export async function listBroadcasts(db, apiKey, { status, includeArchived = false, from, to } = {}) {
  const and = [{ api_key: apiKey }];
  if (status) {
    and.push({ status });
  } else if (!includeArchived) {
    and.push({ status: { not: 'archived' } });
  }
  // Calendar range filter on the scheduled window (overlap semantics).
  if (from) {
    and.push({ scheduled_start: { not: null } });
    and.push({ OR: [{ scheduled_end: { gte: from } }, { scheduled_end: null, scheduled_start: { gte: from } }] });
  }
  if (to) and.push({ scheduled_start: { not: null, lte: to } });

  const rows = await db.broadcasts.findMany({ where: { AND: and } });
  // ORDER BY COALESCE(scheduled_start, created_at) DESC (done here so collation is the same on both databases)
  const key = (r) => r.scheduled_start ?? r.created_at;
  rows.sort((a, b) => (key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : 0));
  return rows.map(formatRow);
}

/**
 * Get the raw row for a broadcast, scoped to a project (internal use).
 * @returns {Promise<object|null>}
 */
async function getRow(db, apiKey, id) {
  return (await db.broadcasts.findFirst({ where: { api_key: apiKey, id } })) ?? null;
}

/**
 * Get one broadcast + its linked assets.
 * @param {import('./connection.js').Db} db
 * @returns {Promise<object|null>}
 */
export async function getBroadcast(db, apiKey, id) {
  const row = await getRow(db, apiKey, id);
  if (!row) return null;
  const assets = (await db.broadcast_assets.findMany({
    where: { broadcast_id: id },
    orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
  })).map(formatAsset);
  const files = await queryBroadcastFiles(db, apiKey, id);
  return { ...formatRow(row), assets, files };
}

/**
 * Create a broadcast.
 * @param {import('./connection.js').Db} db
 * @param {{ title?, description?, status?, scheduledStart?, scheduledEnd?, id?, actualStart?, youtubeBroadcastId?, rundownFileId?, recordEnabled?, privacyStatus? }} fields
 * @returns {Promise<{ ok: true, broadcast: object }|{ ok: false, error: string }>}
 */
export async function createBroadcast(db, apiKey, fields = {}) {
  const {
    id = randomUUID(),
    title = '', description = null,
    status = 'draft',
    scheduledStart = null, scheduledEnd = null, actualStart = null,
    youtubeBroadcastId = null, rundownFileId = null, recordEnabled = false,
    privacyStatus = DEFAULT_PRIVACY_STATUS,
  } = fields;

  if (!BROADCAST_STATUSES.has(status)) {
    return { ok: false, error: `Invalid status: ${status}` };
  }
  if (!PRIVACY_STATUSES.has(privacyStatus)) {
    return { ok: false, error: `Invalid privacyStatus: ${privacyStatus}` };
  }

  await db.broadcasts.create({
    data: {
      id, api_key: apiKey, title, description, status,
      scheduled_start: scheduledStart, scheduled_end: scheduledEnd, actual_start: actualStart,
      youtube_broadcast_id: youtubeBroadcastId, rundown_file_id: rundownFileId,
      record_enabled: recordEnabled ? 1 : 0, privacy_status: privacyStatus,
    },
  });
  return { ok: true, broadcast: await getBroadcast(db, apiKey, id) };
}

const UPDATABLE = {
  title:              'title',
  description:        'description',
  status:             'status',
  scheduledStart:     'scheduled_start',
  scheduledEnd:       'scheduled_end',
  youtubeBroadcastId: 'youtube_broadcast_id',
  rundownFileId:      'rundown_file_id',
  recordEnabled:      'record_enabled',
  privacyStatus:      'privacy_status',
};

/**
 * Update editable fields on a broadcast. Only provided keys change.
 * @param {import('./connection.js').Db} db
 * @returns {Promise<{ ok: true, broadcast: object }|{ ok: false, error: string, status?: number }>}
 */
export async function updateBroadcast(db, apiKey, id, patch = {}) {
  const existing = await getRow(db, apiKey, id);
  if (!existing) return { ok: false, error: 'Broadcast not found', status: 404 };

  if (patch.privacyStatus !== undefined && !PRIVACY_STATUSES.has(patch.privacyStatus)) {
    return { ok: false, error: `Invalid privacyStatus: ${patch.privacyStatus}` };
  }
  if (patch.status !== undefined && !BROADCAST_STATUSES.has(patch.status)) {
    return { ok: false, error: `Invalid status: ${patch.status}` };
  }
  // live and completed are reached by going live / ending, not by editing the
  // field (plan_broadcast_lifecycle.md, PR 1).
  if (patch.status !== undefined && patch.status !== existing.status && LIFECYCLE_ONLY_STATUSES.has(patch.status)) {
    return { ok: false, error: `Status "${patch.status}" cannot be set directly; it follows the broadcast lifecycle`, status: 409 };
  }

  const data = {};
  for (const [key, col] of Object.entries(UPDATABLE)) {
    if (patch[key] !== undefined) {
      data[col] = key === 'recordEnabled' ? (patch[key] ? 1 : 0) : patch[key];
    }
  }
  if (Object.keys(data).length === 0) return { ok: true, broadcast: await getBroadcast(db, apiKey, id) };

  data.updated_at = sqlNow();
  await db.broadcasts.updateMany({ where: { api_key: apiKey, id }, data });
  return { ok: true, broadcast: await getBroadcast(db, apiKey, id) };
}

/**
 * Archive (soft-delete) a broadcast.
 * @param {import('./connection.js').Db} db
 * @returns {Promise<{ ok: true, broadcast: object }|{ ok: false, error: string, status?: number }>}
 */
export async function archiveBroadcast(db, apiKey, id) {
  const existing = await getRow(db, apiKey, id);
  if (!existing) return { ok: false, error: 'Broadcast not found', status: 404 };
  if (existing.status === 'live') {
    return { ok: false, error: 'Cannot archive a live broadcast', status: 409 };
  }
  const now = sqlNow();
  await db.broadcasts.updateMany({
    where: { api_key: apiKey, id },
    data: { status: 'archived', archived_at: now, updated_at: now },
  });
  await clearActiveBroadcastIfMatches(db, apiKey, id);
  return { ok: true, broadcast: await getBroadcast(db, apiKey, id) };
}

/**
 * Restore an archived broadcast back to draft.
 * @param {import('./connection.js').Db} db
 * @returns {Promise<{ ok: true, broadcast: object }|{ ok: false, error: string, status?: number }>}
 */
export async function restoreBroadcast(db, apiKey, id) {
  const existing = await getRow(db, apiKey, id);
  if (!existing) return { ok: false, error: 'Broadcast not found', status: 404 };
  if (existing.status !== 'archived') {
    return { ok: false, error: 'Broadcast is not archived', status: 409 };
  }
  await db.broadcasts.updateMany({
    where: { api_key: apiKey, id },
    data: { status: 'draft', archived_at: null, updated_at: sqlNow() },
  });
  return { ok: true, broadcast: await getBroadcast(db, apiKey, id) };
}

/**
 * Permanently delete a broadcast. Only permitted once it has been archived for
 * at least archiveMinAgeDays(); otherwise blocked. Produced content survives —
 * broadcast_id is nulled on sessions / session_stats / caption_files, and
 * broadcast_assets cascade-drop via FK.
 * @param {import('./connection.js').Db} db
 * @returns {Promise<{ ok: true }|{ ok: false, error: string, status?: number, archive?: object }>}
 */
export async function deleteBroadcast(db, apiKey, id) {
  const existing = await getRow(db, apiKey, id);
  if (!existing) return { ok: false, error: 'Broadcast not found', status: 404 };

  if (existing.status !== 'archived') {
    // First delete archives instead of hard-deleting.
    const archived = await archiveBroadcast(db, apiKey, id);
    return archived.ok
      ? { ok: false, error: 'Broadcast archived; delete again after the cooling-off window to remove permanently', status: 202, archive: archived.broadcast }
      : archived;
  }

  // Already archived — enforce cooling-off window before permanent delete.
  const minDays = archiveMinAgeDays();
  const cutoff = sqlNow(new Date(Date.now() - minDays * 86400000));
  if (!existing.archived_at || existing.archived_at > cutoff) {
    return { ok: false, error: `Archived broadcast cannot be permanently deleted until ${minDays} days after archiving`, status: 409 };
  }

  await db.$transaction(async (tx) => {
    await clearActiveBroadcastIfMatches(tx, apiKey, id);
    await tx.sessions.updateMany({ where: { broadcast_id: id }, data: { broadcast_id: null } });
    await tx.session_stats.updateMany({ where: { broadcast_id: id }, data: { broadcast_id: null } });
    await tx.caption_files.updateMany({ where: { broadcast_id: id }, data: { broadcast_id: null } });
    await tx.broadcasts.deleteMany({ where: { api_key: apiKey, id } });
  });
  return { ok: true };
}

// ── Asset linkage ──────────────────────────────────────────────────────────

/**
 * List files linked to a broadcast.
 * @param {import('./connection.js').Db} db
 * @returns {Promise<object[]|null>} null if the broadcast does not exist for this project.
 */
export async function listBroadcastFiles(db, apiKey, id) {
  const existing = await getRow(db, apiKey, id);
  if (!existing) return null;
  return queryBroadcastFiles(db, apiKey, id);
}

/**
 * Link a file to a broadcast.
 * @param {import('./connection.js').Db} db
 * @returns {Promise<{ ok: true, file: object }|{ ok: false, error: string, status?: number }>}
 */
export async function linkBroadcastFile(db, apiKey, id, fileId) {
  const existing = await getRow(db, apiKey, id);
  if (!existing) return { ok: false, error: 'Broadcast not found', status: 404 };

  const parsedFileId = Number(fileId);
  if (!Number.isInteger(parsedFileId) || parsedFileId <= 0) {
    return { ok: false, error: 'fileId must be a positive integer', status: 400 };
  }

  const file = await getCaptionFile(db, parsedFileId, apiKey);
  if (!file) return { ok: false, error: 'File not found', status: 404 };

  try {
    const link = await db.broadcast_files.create({ data: { broadcast_id: id, file_id: parsedFileId } });
    return {
      ok: true,
      file: formatBroadcastFile({
        link_id: link.id, file_id: parsedFileId,
        filename: file.filename, lang: file.lang, format: file.format, type: file.type,
        size_bytes: file.size_bytes, created_at: file.created_at, updated_at: file.updated_at,
      }),
    };
  } catch (e) {
    if (isUnique(e)) {
      return { ok: false, error: 'File already linked to this broadcast', status: 409 };
    }
    throw e;
  }
}

/**
 * Unlink a file from a broadcast.
 * @param {import('./connection.js').Db} db
 * @returns {Promise<{ ok: true }|{ ok: false, error: string, status?: number }>}
 */
export async function unlinkBroadcastFile(db, apiKey, id, fileId) {
  const existing = await getRow(db, apiKey, id);
  if (!existing) return { ok: false, error: 'Broadcast not found', status: 404 };

  const parsedFileId = Number(fileId);
  if (!Number.isInteger(parsedFileId) || parsedFileId <= 0) {
    return { ok: false, error: 'fileId must be a positive integer', status: 400 };
  }

  const result = await db.broadcast_files.deleteMany({ where: { broadcast_id: id, file_id: parsedFileId } });
  if (result.count === 0) return { ok: false, error: 'Linked file not found', status: 404 };
  return { ok: true };
}

/**
 * Link a reusable asset to a broadcast.
 * @param {import('./connection.js').Db} db
 * @returns {Promise<{ ok: true, asset: object }|{ ok: false, error: string, status?: number }>}
 */
export async function linkAsset(db, apiKey, id, { assetType, assetRef, sortOrder } = {}) {
  const existing = await getRow(db, apiKey, id);
  if (!existing) return { ok: false, error: 'Broadcast not found', status: 404 };
  if (!BROADCAST_ASSET_TYPES.has(assetType)) {
    return { ok: false, error: `Invalid asset type: ${assetType}` };
  }
  if (assetRef === undefined || assetRef === null || assetRef === '') {
    return { ok: false, error: 'assetRef is required' };
  }
  const ref = String(assetRef);
  let order;
  if (Number.isFinite(Number(sortOrder))) {
    order = Math.trunc(Number(sortOrder));
  } else {
    const agg = await db.broadcast_assets.aggregate({ where: { broadcast_id: id }, _max: { sort_order: true } });
    order = (agg._max.sort_order ?? -1) + 1;
  }
  try {
    const asset = await db.broadcast_assets.create({
      data: { broadcast_id: id, asset_type: assetType, asset_ref: ref, sort_order: order },
    });
    return { ok: true, asset: formatAsset(asset) };
  } catch (e) {
    if (isUnique(e)) {
      return { ok: false, error: 'Asset already linked to this broadcast', status: 409 };
    }
    throw e;
  }
}

/**
 * Unlink an asset from a broadcast.
 * @param {import('./connection.js').Db} db
 * @returns {Promise<{ ok: true }|{ ok: false, error: string, status?: number }>}
 */
export async function unlinkAsset(db, apiKey, id, assetRowId) {
  const existing = await getRow(db, apiKey, id);
  if (!existing) return { ok: false, error: 'Broadcast not found', status: 404 };
  const rowId = Number(assetRowId);
  const count = Number.isInteger(rowId)
    ? (await db.broadcast_assets.deleteMany({ where: { broadcast_id: id, id: rowId } })).count
    : 0;
  if (count === 0) return { ok: false, error: 'Linked asset not found', status: 404 };
  return { ok: true };
}

// ── Duplication ──────────────────────────────────────────────────────────

/**
 * The project's currently active broadcast, or null.
 * @param {import('./connection.js').Db} db
 * @returns {Promise<object|null>}
 */
export async function getActiveBroadcast(db, apiKey) {
  const id = await getActiveBroadcastId(db, apiKey);
  return id ? getBroadcast(db, apiKey, id) : null;
}

/** @param {import('./connection.js').Db} db */
export async function activateBroadcast(db, apiKey, id) {
  const existing = await getRow(db, apiKey, id);
  if (!existing) return { ok: false, error: 'Broadcast not found', status: 404 };
  if (existing.status === 'archived') return { ok: false, error: 'Cannot activate an archived broadcast', status: 409 };
  await setActiveBroadcastId(db, apiKey, id);
  return { ok: true, broadcast: await getBroadcast(db, apiKey, id) };
}

/** @param {import('./connection.js').Db} db */
export async function deactivateBroadcast(db, apiKey) {
  await setActiveBroadcastId(db, apiKey, null);
  return { ok: true };
}

/**
 * Duplicate a broadcast within the same project. Copies title (suffixed
 * "(copy)"), description, and the reusable-asset links. Never copies produced
 * content (youtube ids, actual_start/end, session records, caption files). The
 * clone starts as a fresh draft. Cross-project deep-copy (targetApiKey) is a
 * follow-up — see plan_broadcasts.md.
 * @param {import('./connection.js').Db} db
 * @returns {Promise<{ ok: true, broadcast: object }|{ ok: false, error: string, status?: number }>}
 */
export async function duplicateBroadcast(db, apiKey, id) {
  const source = await getRow(db, apiKey, id);
  if (!source) return { ok: false, error: 'Broadcast not found', status: 404 };

  const newId = randomUUID();
  await db.$transaction(async (tx) => {
    await tx.broadcasts.create({
      data: {
        id: newId, api_key: apiKey, status: 'draft',
        title: `${source.title || 'Broadcast'} (copy)`, description: source.description ?? null,
      },
    });
    const links = await tx.broadcast_assets.findMany({ where: { broadcast_id: id }, orderBy: { id: 'asc' } });
    for (const l of links) {
      await tx.broadcast_assets.create({
        data: { broadcast_id: newId, asset_type: l.asset_type, asset_ref: l.asset_ref, sort_order: l.sort_order },
      });
    }
    const fileLinks = await tx.broadcast_files.findMany({ where: { broadcast_id: id }, orderBy: { id: 'asc' } });
    for (const l of fileLinks) {
      await tx.broadcast_files.create({ data: { broadcast_id: newId, file_id: l.file_id } });
    }
  });
  return { ok: true, broadcast: await getBroadcast(db, apiKey, newId) };
}

// ── Session-lifecycle binding ────────────────────────────────────────────

/**
 * Auto-create a `live` broadcast for an ad-hoc session (POST /live without a
 * broadcastId). Title is a timestamp (editable later).
 * @param {import('./connection.js').Db} db
 * @returns {Promise<object>} the created broadcast (formatted)
 */
export async function autoCreateForSession(db, apiKey, { startedAt, recordEnabled = false } = {}) {
  const id = randomUUID();
  const when = startedAt ? new Date(startedAt) : new Date();
  const title = `Broadcast ${when.toISOString().slice(0, 16).replace('T', ' ')}`;
  await db.broadcasts.create({
    data: {
      id, api_key: apiKey, title, status: 'live',
      actual_start: when.toISOString(), record_enabled: recordEnabled ? 1 : 0,
    },
  });
  return getBroadcast(db, apiKey, id);
}

/**
 * Bind a starting session to an existing broadcast: transition to `live` and
 * stamp actual_start. Rejects if the broadcast is already live (1:1 per run).
 * @param {import('./connection.js').Db} db
 * @returns {Promise<{ ok: true, broadcast: object }|{ ok: false, error: string, status?: number }>}
 */
export async function bindSessionStart(db, apiKey, id, { startedAt, recordEnabled } = {}) {
  const existing = await getRow(db, apiKey, id);
  if (!existing) return { ok: false, error: 'Broadcast not found', status: 404 };
  if (existing.status === 'live') {
    return { ok: false, error: 'Broadcast already has a live session', status: 409 };
  }
  if (existing.status !== 'draft' && existing.status !== 'scheduled') {
    return { ok: false, error: `Cannot bind a session to a ${existing.status} broadcast`, status: 409 };
  }
  const data = {
    status: 'live',
    actual_start: existing.actual_start ?? (startedAt ? new Date(startedAt) : new Date()).toISOString(),
    updated_at: sqlNow(),
  };
  if (recordEnabled !== undefined) data.record_enabled = recordEnabled ? 1 : 0;
  await db.broadcasts.updateMany({ where: { api_key: apiKey, id }, data });
  return { ok: true, broadcast: await getBroadcast(db, apiKey, id) };
}

/**
 * Complete a broadcast when its session ends: transition to `completed`, stamp
 * actual_end, and record the YouTube video id(s) the cast produced. Best-effort
 * and id-only (no apiKey scope) since the session end path already trusts its
 * own session record.
 * @param {import('./connection.js').Db} db
 * @param {string[]} [youtubeVideoIds]
 * @returns {Promise<void>}
 */
export async function completeBroadcast(db, id, { youtubeVideoIds, endedAt } = {}) {
  if (!id) return;
  const row = await db.broadcasts.findUnique({ where: { id }, select: { status: true } });
  if (!row) return;
  const data = {
    armed: 0,
    actual_end: (endedAt ? new Date(endedAt) : new Date()).toISOString(),
    updated_at: sqlNow(),
  };
  if (row.status !== 'archived') data.status = 'completed';
  let videoIds = Array.isArray(youtubeVideoIds) ? youtubeVideoIds : [];
  if (!videoIds.length) videoIds = await platformVideoIds(db, id);
  if (videoIds.length) data.youtube_video_ids = JSON.stringify(videoIds);
  await db.broadcasts.updateMany({ where: { id }, data });
}

/**
 * Video ids the platform links recorded for a broadcast (YouTube's broadcast
 * id is also its watch-page video id). Used when the session did not carry any.
 */
async function platformVideoIds(db, id) {
  try {
    const links = await db.broadcast_platform_links.findMany({
      where: { broadcast_id: id, platform: 'youtube' },
      select: { external_broadcast_id: true, external_video_ids: true },
    });
    const ids = [];
    for (const l of links) {
      let list = [];
      try { list = l.external_video_ids ? JSON.parse(l.external_video_ids) : []; } catch { list = []; }
      if (!list.length && l.external_broadcast_id) list = [l.external_broadcast_id];
      for (const v of list) if (v && !ids.includes(v)) ids.push(v);
    }
    return ids;
  } catch {
    return [];
  }
}
