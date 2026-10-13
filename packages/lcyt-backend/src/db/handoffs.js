import { sqlNow } from './helpers.js';

/** Handoff of a broadcast to Saarnavideo: id is the feed group id. Status: pending, ready, sent, failed. */
function parse(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function formatRow(row) {
  return {
    id: row.id,
    broadcastId: row.broadcast_id ?? null,
    status: row.status,
    manifest: parse(row.manifest_json),
    error: row.error ?? null,
    sentAt: row.sent_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** @param {import('./connection.js').Db} db */
export async function getHandoff(db, apiKey, id) {
  const row = await db.handoffs.findFirst({ where: { api_key: apiKey, id } });
  return row ? formatRow(row) : null;
}

/** Handoff by id for a signed-URL download (the token has been checked by the caller). */
export async function getHandoffById(db, id) {
  const row = await db.handoffs.findUnique({ where: { id } });
  return row ? { ...formatRow(row), apiKey: row.api_key } : null;
}

export async function listHandoffs(db, apiKey, { broadcastId } = {}) {
  const where = { api_key: apiKey };
  if (broadcastId) where.broadcast_id = broadcastId;
  const rows = await db.handoffs.findMany({ where, orderBy: { created_at: 'desc' } });
  return rows.map(formatRow);
}

export async function upsertHandoff(db, apiKey, id, { broadcastId = null, status, manifest, error = null }) {
  const data = {
    broadcast_id: broadcastId,
    status,
    manifest_json: manifest ? JSON.stringify(manifest) : null,
    error,
    updated_at: sqlNow(),
  };
  await db.handoffs.upsert({
    where: { id },
    create: { id, api_key: apiKey, ...data },
    update: data,
  });
  return getHandoff(db, apiKey, id);
}

export async function markHandoffSent(db, apiKey, id) {
  await db.handoffs.updateMany({ where: { api_key: apiKey, id }, data: { status: 'sent', sent_at: sqlNow(), error: null, updated_at: sqlNow() } });
}

export async function markHandoffFailed(db, apiKey, id, error) {
  await db.handoffs.updateMany({ where: { api_key: apiKey, id }, data: { status: 'failed', error: String(error).slice(0, 500), updated_at: sqlNow() } });
}
