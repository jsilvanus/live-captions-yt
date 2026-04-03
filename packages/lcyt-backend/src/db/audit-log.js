/**
 * Admin audit log helpers.
 *
 * Writes immutable records for every admin-initiated mutation so operators
 * can see who changed what and when.
 */

/**
 * Write a single audit log entry.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ actor: string, action: string, targetType: string, targetId?: string|null, details?: object|null, ip?: string|null }} entry
 */
export function writeAuditLog(db, { actor, action, targetType, targetId = null, details = null, ip = null }) {
  try {
    db.prepare(`
      INSERT INTO admin_audit_log (actor, action, target_type, target_id, details, ip)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      actor,
      action,
      targetType,
      targetId ?? null,
      details != null ? JSON.stringify(details) : null,
      ip ?? null,
    );
  } catch {
    // Audit log writes must never break the request — swallow silently.
  }
}

/**
 * Query the audit log with optional filters.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ q?: string, action?: string, targetType?: string, actor?: string, from?: string, to?: string, limit?: number, offset?: number }} opts
 * @returns {{ rows: Array, total: number }}
 */
export function queryAuditLog(db, { q = '', action = '', targetType = '', actor = '', from = '', to = '', limit = 50, offset = 0 } = {}) {
  const conditions = [];
  const params = [];

  if (q) {
    conditions.push('(actor LIKE ? OR action LIKE ? OR target_id LIKE ? OR details LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  if (action) {
    conditions.push('action = ?');
    params.push(action);
  }
  if (targetType) {
    conditions.push('target_type = ?');
    params.push(targetType);
  }
  if (actor) {
    conditions.push('actor LIKE ?');
    params.push(`%${actor}%`);
  }
  if (from) {
    conditions.push('created_at >= ?');
    params.push(from);
  }
  if (to) {
    conditions.push('created_at <= ?');
    params.push(to + 'T23:59:59');
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = db.prepare(
    `SELECT id, actor, action, target_type, target_id, details, ip, created_at FROM admin_audit_log ${where} ORDER BY id DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  const { count } = db.prepare(
    `SELECT COUNT(*) as count FROM admin_audit_log ${where}`
  ).get(...params);

  return { rows, total: count };
}
