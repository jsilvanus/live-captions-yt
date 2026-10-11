/**
 * Unified audit log helpers (plan_metering_audit §5).
 *
 * One table for admin actions, semantic auth events, and the generic
 * write-audit middleware. Rows are immutable; writes are swallowed on error
 * so auditing can never break a request.
 */
import { normalizeDateFilter } from './usage-rollups.js';
import { getDialect } from './connection.js';
import { num } from './helpers.js';

/** Positional placeholder for the current dialect ($n on PostgreSQL, ? on SQLite). */
const ph = (i) => (getDialect() === 'postgres' ? `$${i}` : '?');

/**
 * Write a single audit log entry.
 *
 * `org_id` is denormalized at write time (point-in-time attribution): when not
 * supplied it is resolved from api_keys.org_id for the given project.
 *
 * @param {import('./connection.js').Db} db
 * @param {{ actor: string, action: string, targetType?: string|null, targetId?: string|null, details?: object|string|null, ip?: string|null, actorKind?: string, actorId?: string|null, userId?: number|null, apiKey?: string|null, orgId?: number|null }} entry
 * @returns {Promise<void>}
 */
export async function writeAuditLog(db, { actor, action, targetType = null, targetId = null, details = null, ip = null, actorKind = 'admin', actorId = null, userId = null, apiKey = null, orgId = null }) {
  try {
    let resolvedOrgId = orgId;
    if (resolvedOrgId == null && apiKey) {
      const k = await db.api_keys.findUnique({ where: { key: apiKey }, select: { org_id: true } });
      resolvedOrgId = k?.org_id ?? null;
    }
    await db.audit_log.create({
      data: {
        actor,
        actor_kind: actorKind,
        actor_id: actorId ?? null,
        user_id: userId ?? null,
        api_key: apiKey ?? null,
        org_id: resolvedOrgId,
        action,
        target_type: targetType ?? null,
        target_id: targetId ?? null,
        details: details != null && typeof details !== 'string' ? JSON.stringify(details) : details,
        ip: ip ?? null,
      },
    });
  } catch {
    // Audit log writes must never break the request — swallow silently.
  }
}

/**
 * Query the audit log with optional filters.
 *
 * @param {import('./connection.js').Db} db
 * @param {{ q?: string, action?: string, targetType?: string, actor?: string, actorKind?: string, apiKey?: string, orgId?: number|string, from?: string, to?: string, limit?: number, offset?: number }} opts
 * @returns {Promise<{ rows: Array, total: number }>}
 */
export async function queryAuditLog(db, { q = '', action = '', targetType = '', actor = '', actorKind = '', apiKey = '', orgId = '', from = '', to = '', limit = 50, offset = 0 } = {}) {
  const conditions = [];
  const params = [];

  if (q) {
    const like = `%${q}%`;
    // LOWER() on both sides keeps LIKE case-insensitive on PostgreSQL as it is on SQLite.
    const terms = ['actor', 'actor_id', 'action', 'target_id', 'details']
      .map((c, i) => `LOWER(${c}) LIKE LOWER(${ph(params.length + 1 + i)})`);
    conditions.push(`(${terms.join(' OR ')})`);
    params.push(like, like, like, like, like);
  }
  if (action) {
    conditions.push(`action = ${ph(params.length + 1)}`);
    params.push(action);
  }
  if (targetType) {
    conditions.push(`target_type = ${ph(params.length + 1)}`);
    params.push(targetType);
  }
  if (actor) {
    conditions.push(`LOWER(actor) LIKE LOWER(${ph(params.length + 1)})`);
    params.push(`%${actor}%`);
  }
  if (actorKind) {
    conditions.push(`actor_kind = ${ph(params.length + 1)}`);
    params.push(actorKind);
  }
  if (apiKey) {
    conditions.push(`api_key = ${ph(params.length + 1)}`);
    params.push(apiKey);
  }
  if (orgId !== '' && orgId != null) {
    conditions.push(`org_id = ${ph(params.length + 1)}`);
    params.push(Number(orgId));
  }
  if (from) {
    conditions.push(`created_at >= ${ph(params.length + 1)}`);
    params.push(from);
  }
  if (to) {
    conditions.push(`created_at <= ${ph(params.length + 1)}`);
    params.push(normalizeDateFilter(to, { dateOnly: true }));
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const n = params.length;
  const rows = await db.$queryRawUnsafe(
    `SELECT id, actor, actor_kind, actor_id, user_id, api_key, org_id, action, target_type, target_id, details, ip, created_at FROM audit_log ${where} ORDER BY id DESC LIMIT ${ph(n + 1)} OFFSET ${ph(n + 2)}`,
    ...params, Number(limit), Number(offset),
  );

  const [{ count }] = await db.$queryRawUnsafe(`SELECT COUNT(*) as count FROM audit_log ${where}`, ...params);

  return {
    rows: rows.map((r) => ({ ...r, id: num(r.id), user_id: num(r.user_id), org_id: num(r.org_id) })),
    total: num(count),
  };
}

/**
 * Delete audit rows older than `retentionDays`.
 * @param {import('./connection.js').Db} db
 * @param {number} retentionDays
 * @returns {Promise<{ count: number }>}
 */
export async function deleteAuditLogOlderThan(db, retentionDays) {
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const info = await db.audit_log.deleteMany({ where: { created_at: { lt: cutoff } } });
  return { count: info.count };
}
