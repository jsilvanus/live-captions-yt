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

export const BROADCAST_STATUSES = new Set([
  'draft', 'scheduled', 'live', 'completed', 'archived',
]);

export const BROADCAST_ASSET_TYPES = new Set([
  'graphic', 'cue', 'action', 'icon', 'target', 'rundown',
]);

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
    sizeBytes: row.size_bytes ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function clearActiveBroadcastIfMatches(db, apiKey, id) {
  if (getActiveBroadcastId(db, apiKey) === id) setActiveBroadcastId(db, apiKey, null);
}

/**
 * List broadcasts for a project.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {{ status?: string, includeArchived?: boolean, from?: string, to?: string }} [opts]
 * @returns {object[]}
 */
export function listBroadcasts(db, apiKey, { status, includeArchived = false, from, to } = {}) {
  const clauses = ['api_key = ?'];
  const params = [apiKey];
  if (status) {
    clauses.push('status = ?');
    params.push(status);
  } else if (!includeArchived) {
    clauses.push("status != 'archived'");
  }
  // Calendar range filter on the scheduled window (overlap semantics).
  if (from) { clauses.push('(scheduled_start IS NOT NULL AND COALESCE(scheduled_end, scheduled_start) >= ?)'); params.push(from); }
  if (to)   { clauses.push('(scheduled_start IS NOT NULL AND scheduled_start <= ?)'); params.push(to); }

  const rows = db.prepare(
    `SELECT * FROM broadcasts WHERE ${clauses.join(' AND ')}
     ORDER BY COALESCE(scheduled_start, created_at) DESC`
  ).all(...params);
  return rows.map(formatRow);
}

/**
 * Get the raw row for a broadcast, scoped to a project (internal use).
 * @returns {object|null}
 */
function getRow(db, apiKey, id) {
  return db.prepare('SELECT * FROM broadcasts WHERE api_key = ? AND id = ?').get(apiKey, id) ?? null;
}

/**
 * Get one broadcast + its linked assets.
 * @returns {object|null}
 */
export function getBroadcast(db, apiKey, id) {
  const row = getRow(db, apiKey, id);
  if (!row) return null;
  const assets = db.prepare(
    'SELECT * FROM broadcast_assets WHERE broadcast_id = ? ORDER BY sort_order, id'
  ).all(id).map(formatAsset);
  const files = db.prepare(`
    SELECT bf.id AS link_id, bf.file_id, cf.filename, cf.lang, cf.format, cf.type, cf.size_bytes, cf.created_at, cf.updated_at
    FROM broadcast_files bf
    JOIN caption_files cf ON cf.id = bf.file_id
    WHERE bf.broadcast_id = ? AND cf.api_key = ?
    ORDER BY bf.created_at DESC, bf.id DESC
  `).all(id, apiKey).map(formatBroadcastFile);
  return { ...formatRow(row), assets, files };
}

/**
 * Create a broadcast.
 * @param {{ title?, description?, status?, scheduledStart?, scheduledEnd?, id?, actualStart?, youtubeBroadcastId?, rundownFileId? }} fields
 * @returns {{ ok: true, broadcast: object }|{ ok: false, error: string }}
 */
export function createBroadcast(db, apiKey, fields = {}) {
  const {
    id = randomUUID(),
    title = '', description = null,
    status = 'draft',
    scheduledStart = null, scheduledEnd = null, actualStart = null,
    youtubeBroadcastId = null, rundownFileId = null, recordEnabled = false,
  } = fields;

  if (!BROADCAST_STATUSES.has(status)) {
    return { ok: false, error: `Invalid status: ${status}` };
  }

  db.prepare(`
    INSERT INTO broadcasts
      (id, api_key, title, description, status, scheduled_start, scheduled_end, actual_start, youtube_broadcast_id, rundown_file_id, record_enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, apiKey, title, description, status,
    scheduledStart, scheduledEnd, actualStart,
    youtubeBroadcastId, rundownFileId, recordEnabled ? 1 : 0,
  );
  return { ok: true, broadcast: getBroadcast(db, apiKey, id) };
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
};

/**
 * Update editable fields on a broadcast. Only provided keys change.
 * @returns {{ ok: true, broadcast: object }|{ ok: false, error: string, status?: number }}
 */
export function updateBroadcast(db, apiKey, id, patch = {}) {
  const existing = getRow(db, apiKey, id);
  if (!existing) return { ok: false, error: 'Broadcast not found', status: 404 };

  if (patch.status !== undefined && !BROADCAST_STATUSES.has(patch.status)) {
    return { ok: false, error: `Invalid status: ${patch.status}` };
  }

  const sets = [];
  const params = [];
  for (const [key, col] of Object.entries(UPDATABLE)) {
    if (patch[key] !== undefined) {
      sets.push(`${col} = ?`);
      params.push(key === 'recordEnabled' ? (patch[key] ? 1 : 0) : patch[key]);
    }
  }
  if (sets.length === 0) return { ok: true, broadcast: getBroadcast(db, apiKey, id) };

  sets.push("updated_at = datetime('now')");
  params.push(apiKey, id);
  db.prepare(`UPDATE broadcasts SET ${sets.join(', ')} WHERE api_key = ? AND id = ?`).run(...params);
  return { ok: true, broadcast: getBroadcast(db, apiKey, id) };
}

/**
 * Archive (soft-delete) a broadcast.
 * @returns {{ ok: true, broadcast: object }|{ ok: false, error: string, status?: number }}
 */
export function archiveBroadcast(db, apiKey, id) {
  const existing = getRow(db, apiKey, id);
  if (!existing) return { ok: false, error: 'Broadcast not found', status: 404 };
  if (existing.status === 'live') {
    return { ok: false, error: 'Cannot archive a live broadcast', status: 409 };
  }
  db.prepare(
    "UPDATE broadcasts SET status = 'archived', archived_at = datetime('now'), updated_at = datetime('now') WHERE api_key = ? AND id = ?"
  ).run(apiKey, id);
  clearActiveBroadcastIfMatches(db, apiKey, id);
  return { ok: true, broadcast: getBroadcast(db, apiKey, id) };
}

/**
 * Restore an archived broadcast back to draft.
 * @returns {{ ok: true, broadcast: object }|{ ok: false, error: string, status?: number }}
 */
export function restoreBroadcast(db, apiKey, id) {
  const existing = getRow(db, apiKey, id);
  if (!existing) return { ok: false, error: 'Broadcast not found', status: 404 };
  if (existing.status !== 'archived') {
    return { ok: false, error: 'Broadcast is not archived', status: 409 };
  }
  db.prepare(
    "UPDATE broadcasts SET status = 'draft', archived_at = NULL, updated_at = datetime('now') WHERE api_key = ? AND id = ?"
  ).run(apiKey, id);
  return { ok: true, broadcast: getBroadcast(db, apiKey, id) };
}

/**
 * Permanently delete a broadcast. Only permitted once it has been archived for
 * at least archiveMinAgeDays(); otherwise blocked. Produced content survives —
 * broadcast_id is nulled on sessions / session_stats / caption_files, and
 * broadcast_assets cascade-drop via FK.
 * @returns {{ ok: true }|{ ok: false, error: string, status?: number, archive?: object }}
 */
export function deleteBroadcast(db, apiKey, id) {
  const existing = getRow(db, apiKey, id);
  if (!existing) return { ok: false, error: 'Broadcast not found', status: 404 };

  if (existing.status !== 'archived') {
    // First delete archives instead of hard-deleting.
    const archived = archiveBroadcast(db, apiKey, id);
    return archived.ok
      ? { ok: false, error: 'Broadcast archived; delete again after the cooling-off window to remove permanently', status: 202, archive: archived.broadcast }
      : archived;
  }

  // Already archived — enforce cooling-off window before permanent delete.
  const minDays = archiveMinAgeDays();
  const eligible = db.prepare(
    "SELECT (archived_at IS NOT NULL AND archived_at <= datetime('now', ?)) AS ok FROM broadcasts WHERE api_key = ? AND id = ?"
  ).get(`-${minDays} days`, apiKey, id);
  if (!eligible || eligible.ok !== 1) {
    return { ok: false, error: `Archived broadcast cannot be permanently deleted until ${minDays} days after archiving`, status: 409 };
  }

  const tx = db.transaction(() => {
    clearActiveBroadcastIfMatches(db, apiKey, id);
    db.prepare('UPDATE sessions       SET broadcast_id = NULL WHERE broadcast_id = ?').run(id);
    db.prepare('UPDATE session_stats  SET broadcast_id = NULL WHERE broadcast_id = ?').run(id);
    db.prepare('UPDATE caption_files  SET broadcast_id = NULL WHERE broadcast_id = ?').run(id);
    db.prepare('DELETE FROM broadcasts WHERE api_key = ? AND id = ?').run(apiKey, id);
  });
  tx();
  return { ok: true };
}

// ── Asset linkage ──────────────────────────────────────────────────────────

/**
 * List files linked to a broadcast.
 * @returns {object[]|null} null if the broadcast does not exist for this project.
 */
export function listBroadcastFiles(db, apiKey, id) {
  const existing = getRow(db, apiKey, id);
  if (!existing) return null;
  return db.prepare(`
    SELECT bf.id AS link_id, bf.file_id, cf.filename, cf.lang, cf.format, cf.type, cf.size_bytes, cf.created_at, cf.updated_at
    FROM broadcast_files bf
    JOIN caption_files cf ON cf.id = bf.file_id
    WHERE bf.broadcast_id = ? AND cf.api_key = ?
    ORDER BY bf.created_at DESC, bf.id DESC
  `).all(id, apiKey).map(formatBroadcastFile);
}

/**
 * Link a file to a broadcast.
 * @returns {{ ok: true, file: object }|{ ok: false, error: string, status?: number }}
 */
export function linkBroadcastFile(db, apiKey, id, fileId) {
  const existing = getRow(db, apiKey, id);
  if (!existing) return { ok: false, error: 'Broadcast not found', status: 404 };

  const parsedFileId = Number(fileId);
  if (!Number.isInteger(parsedFileId) || parsedFileId <= 0) {
    return { ok: false, error: 'fileId must be a positive integer', status: 400 };
  }

  const file = getCaptionFile(db, parsedFileId, apiKey);
  if (!file) return { ok: false, error: 'File not found', status: 404 };

  try {
    db.prepare('INSERT INTO broadcast_files (broadcast_id, file_id) VALUES (?, ?)').run(id, parsedFileId);
    const row = db.prepare(`
      SELECT bf.id AS link_id, bf.file_id, cf.filename, cf.lang, cf.format, cf.type, cf.size_bytes, cf.created_at, cf.updated_at
      FROM broadcast_files bf
      JOIN caption_files cf ON cf.id = bf.file_id
      WHERE bf.broadcast_id = ? AND bf.file_id = ?
    `).get(id, parsedFileId);
    return { ok: true, file: formatBroadcastFile(row) };
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return { ok: false, error: 'File already linked to this broadcast', status: 409 };
    }
    throw e;
  }
}

/**
 * Unlink a file from a broadcast.
 * @returns {{ ok: true }|{ ok: false, error: string, status?: number }}
 */
export function unlinkBroadcastFile(db, apiKey, id, fileId) {
  const existing = getRow(db, apiKey, id);
  if (!existing) return { ok: false, error: 'Broadcast not found', status: 404 };

  const parsedFileId = Number(fileId);
  if (!Number.isInteger(parsedFileId) || parsedFileId <= 0) {
    return { ok: false, error: 'fileId must be a positive integer', status: 400 };
  }

  const result = db.prepare('DELETE FROM broadcast_files WHERE broadcast_id = ? AND file_id = ?').run(id, parsedFileId);
  if (result.changes === 0) return { ok: false, error: 'Linked file not found', status: 404 };
  return { ok: true };
}

/**
 * Link a reusable asset to a broadcast.
 * @returns {{ ok: true, asset: object }|{ ok: false, error: string, status?: number }}
 */
export function linkAsset(db, apiKey, id, { assetType, assetRef, sortOrder } = {}) {
  const existing = getRow(db, apiKey, id);
  if (!existing) return { ok: false, error: 'Broadcast not found', status: 404 };
  if (!BROADCAST_ASSET_TYPES.has(assetType)) {
    return { ok: false, error: `Invalid asset type: ${assetType}` };
  }
  if (assetRef === undefined || assetRef === null || assetRef === '') {
    return { ok: false, error: 'assetRef is required' };
  }
  const ref = String(assetRef);
  const order = Number.isFinite(Number(sortOrder))
    ? Number(sortOrder)
    : (db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM broadcast_assets WHERE broadcast_id = ?').get(id).m + 1);
  try {
    const info = db.prepare(
      'INSERT INTO broadcast_assets (broadcast_id, asset_type, asset_ref, sort_order) VALUES (?, ?, ?, ?)'
    ).run(id, assetType, ref, order);
    const asset = db.prepare('SELECT * FROM broadcast_assets WHERE id = ?').get(info.lastInsertRowid);
    return { ok: true, asset: formatAsset(asset) };
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return { ok: false, error: 'Asset already linked to this broadcast', status: 409 };
    }
    throw e;
  }
}

/**
 * Unlink an asset from a broadcast.
 * @returns {{ ok: true }|{ ok: false, error: string, status?: number }}
 */
export function unlinkAsset(db, apiKey, id, assetRowId) {
  const existing = getRow(db, apiKey, id);
  if (!existing) return { ok: false, error: 'Broadcast not found', status: 404 };
  const result = db.prepare('DELETE FROM broadcast_assets WHERE broadcast_id = ? AND id = ?').run(id, assetRowId);
  if (result.changes === 0) return { ok: false, error: 'Linked asset not found', status: 404 };
  return { ok: true };
}

// ── Duplication ──────────────────────────────────────────────────────────

/**
 * Duplicate a broadcast within the same project. Copies title (suffixed
 * "(copy)"), description, and the reusable-asset links. Never copies produced
 * content (youtube ids, actual_start/end, session records, caption files). The
 * clone starts as a fresh draft. Cross-project deep-copy (targetApiKey) is a
 * follow-up — see plan_broadcasts.md.
 * @returns {{ ok: true, broadcast: object }|{ ok: false, error: string, status?: number }}
 */
export function getActiveBroadcast(db, apiKey) {
  const id = getActiveBroadcastId(db, apiKey);
  return id ? getBroadcast(db, apiKey, id) : null;
}

export function activateBroadcast(db, apiKey, id) {
  const existing = getRow(db, apiKey, id);
  if (!existing) return { ok: false, error: 'Broadcast not found', status: 404 };
  if (existing.status === 'archived') return { ok: false, error: 'Cannot activate an archived broadcast', status: 409 };
  setActiveBroadcastId(db, apiKey, id);
  return { ok: true, broadcast: getBroadcast(db, apiKey, id) };
}

export function deactivateBroadcast(db, apiKey) {
  setActiveBroadcastId(db, apiKey, null);
  return { ok: true };
}

export function duplicateBroadcast(db, apiKey, id) {
  const source = getRow(db, apiKey, id);
  if (!source) return { ok: false, error: 'Broadcast not found', status: 404 };

  const newId = randomUUID();
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO broadcasts (id, api_key, title, description, status)
      VALUES (?, ?, ?, ?, 'draft')
    `).run(newId, apiKey, `${source.title || 'Broadcast'} (copy)`, source.description ?? null);

    const links = db.prepare('SELECT asset_type, asset_ref, sort_order FROM broadcast_assets WHERE broadcast_id = ?').all(id);
    const ins = db.prepare('INSERT INTO broadcast_assets (broadcast_id, asset_type, asset_ref, sort_order) VALUES (?, ?, ?, ?)');
    for (const l of links) ins.run(newId, l.asset_type, l.asset_ref, l.sort_order);

    const fileLinks = db.prepare('SELECT file_id FROM broadcast_files WHERE broadcast_id = ?').all(id);
    const insFile = db.prepare('INSERT INTO broadcast_files (broadcast_id, file_id) VALUES (?, ?)');
    for (const l of fileLinks) insFile.run(newId, l.file_id);
  });
  tx();
  return { ok: true, broadcast: getBroadcast(db, apiKey, newId) };
}

// ── Session-lifecycle binding ────────────────────────────────────────────

/**
 * Auto-create a `live` broadcast for an ad-hoc session (POST /live without a
 * broadcastId). Title is a timestamp (editable later).
 * @returns {object} the created broadcast (formatted)
 */
export function autoCreateForSession(db, apiKey, { startedAt, recordEnabled = false } = {}) {
  const id = randomUUID();
  const when = startedAt ? new Date(startedAt) : new Date();
  const title = `Broadcast ${when.toISOString().slice(0, 16).replace('T', ' ')}`;
  db.prepare(`
    INSERT INTO broadcasts (id, api_key, title, status, actual_start, record_enabled)
    VALUES (?, ?, ?, 'live', ?, ?)
  `).run(id, apiKey, title, when.toISOString(), recordEnabled ? 1 : 0);
  return getBroadcast(db, apiKey, id);
}

/**
 * Bind a starting session to an existing broadcast: transition to `live` and
 * stamp actual_start. Rejects if the broadcast is already live (1:1 per run).
 * @returns {{ ok: true, broadcast: object }|{ ok: false, error: string, status?: number }}
 */
export function bindSessionStart(db, apiKey, id, { startedAt, recordEnabled } = {}) {
  const existing = getRow(db, apiKey, id);
  if (!existing) return { ok: false, error: 'Broadcast not found', status: 404 };
  if (existing.status === 'live') {
    return { ok: false, error: 'Broadcast already has a live session', status: 409 };
  }
  if (existing.status !== 'draft' && existing.status !== 'scheduled') {
    return { ok: false, error: `Cannot bind a session to a ${existing.status} broadcast`, status: 409 };
  }
  const sets = ["status = 'live'", "actual_start = COALESCE(actual_start, ?)", "updated_at = datetime('now')"];
  const params = [(startedAt ? new Date(startedAt) : new Date()).toISOString()];
  if (recordEnabled !== undefined) {
    sets.push('record_enabled = ?');
    params.push(recordEnabled ? 1 : 0);
  }
  params.push(apiKey, id);
  db.prepare(`UPDATE broadcasts SET ${sets.join(', ')} WHERE api_key = ? AND id = ?`).run(...params);
  return { ok: true, broadcast: getBroadcast(db, apiKey, id) };
}

/**
 * Complete a broadcast when its session ends: transition to `completed`, stamp
 * actual_end, and record the YouTube video id(s) the cast produced. Best-effort
 * and id-only (no apiKey scope) since the session end path already trusts its
 * own session record.
 * @param {string[]} [youtubeVideoIds]
 */
export function completeBroadcast(db, id, { youtubeVideoIds, endedAt } = {}) {
  if (!id) return;
  const row = db.prepare("SELECT status FROM broadcasts WHERE id = ?").get(id);
  if (!row) return;
  const ids = Array.isArray(youtubeVideoIds) && youtubeVideoIds.length
    ? JSON.stringify(youtubeVideoIds)
    : null;
  db.prepare(`
    UPDATE broadcasts
    SET status = CASE WHEN status = 'archived' THEN status ELSE 'completed' END,
        actual_end = ?,
        youtube_video_ids = COALESCE(?, youtube_video_ids),
        updated_at = datetime('now')
    WHERE id = ?
  `).run((endedAt ? new Date(endedAt) : new Date()).toISOString(), ids, id);
}
