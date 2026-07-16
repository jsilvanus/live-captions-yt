/**
* Unified audit log helpers.
 *
* Writes immutable records for authenticated mutations and semantic auth events.
*/
import { normalizeDateFilter } from './usage-rollups.js';

/**
* Write a single audit log entry.
*
* @param {import('better-sqlite3').Database} db
* @param {{ actor: string, action: string, targetType?: string|null, targetId?: string|null, details?: object|null, ip?: string|null, actorKind?: string, actorId?: string|null, userId?: number|null, apiKey?: string|null, orgId?: number|null }} entry
*/
export function writeAuditLog(db, { actor, action, targetType = null, targetId = null, details = null, ip = null, actorKind = 'admin', actorId = null, userId = null, apiKey = null, orgId = null }) {
 try {
   db.prepare(`
     INSERT INTO audit_log (actor, actor_kind, actor_id, user_id, api_key, org_id, action, target_type, target_id, details, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   `).run(
     actor,
     actorKind,
     actorId ?? null,
     userId ?? null,
     apiKey ?? null,
     orgId ?? null,
     action,
     targetType ?? null,
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
 * @param {{ q?: string, action?: string, targetType?: string, actor?: string, actorKind?: string, apiKey?: string, orgId?: number, from?: string, to?: string, limit?: number, offset?: number }} opts
 * @returns {{ rows: Array, total: number }}
 */
export function queryAuditLog(db, { q = '', action = '', targetType = '', actor = '', actorKind = '', apiKey = '', orgId = '', from = '', to = '', limit = 50, offset = 0 } = {}) {
 const conditions = [];
 const params = [];

 if (q) {
   conditions.push('(actor LIKE ? OR actor_id LIKE ? OR action LIKE ? OR target_id LIKE ? OR details LIKE ?)');
   const like = `%${q}%`;
   params.push(like, like, like, like, like);
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
 if (actorKind) {
   conditions.push('actor_kind = ?');
   params.push(actorKind);
 }
 if (apiKey) {
   conditions.push('api_key = ?');
   params.push(apiKey);
 }
 if (orgId) {
   conditions.push('org_id = ?');
   params.push(orgId);
 }
 if (from) {
   conditions.push('created_at >= ?');
   params.push(from);
 }
 if (to) {
   conditions.push('created_at <= ?');
   params.push(normalizeDateFilter(to, { dateOnly: true }));
 }

 const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

 const rows = db.prepare(
   `SELECT id, actor, actor_kind, actor_id, user_id, api_key, org_id, action, target_type, target_id, details, ip, created_at FROM audit_log ${where} ORDER BY id DESC LIMIT ? OFFSET ?`
 ).all(...params, limit, offset);

 const { count } = db.prepare(
   `SELECT COUNT(*) as count FROM audit_log ${where}`
 ).get(...params);

 return { rows, total: count };
}
