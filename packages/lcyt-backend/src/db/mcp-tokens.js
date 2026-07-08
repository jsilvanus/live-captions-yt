import { createHash, randomBytes } from 'node:crypto';

/**
 * External access tokens (formerly MCP access tokens).
 *
 * Named, individually-revocable bearer tokens a project owner generates and
 * pastes into a local client config (Claude Desktop, Claude Code, or similar).
 * Raw token format: `lcytmcp_<64 hex chars>`. Only the SHA-256 hex digest is
 * stored (`token_hash`); the raw token is returned exactly once at creation.
 *
 * `active` is a soft on/off toggle (a deactivated token stops authenticating
 * but stays listed); `revoked_at` is permanent — a revoked token is dropped
 * from listMcpTokens entirely, it's not just hidden.
 */

function hashToken(rawToken) {
  return createHash('sha256').update(rawToken).digest('hex');
}

function serializeScopes(scopes) {
  if (Array.isArray(scopes)) {
    return JSON.stringify(scopes.filter(Boolean));
  }
  if (typeof scopes === 'string' && scopes.trim()) {
    return scopes.trim();
  }
  return null;
}

export function tokenHasScope(scopes, scope) {
  if (!scope) return true;
  if (!scopes || (Array.isArray(scopes) && scopes.length === 0)) return true;
  const normalized = Array.isArray(scopes) ? scopes : (typeof scopes === 'string' ? scopes.split(',') : []);
  const patterns = normalized.map((entry) => String(entry).trim()).filter(Boolean);
  if (patterns.length === 0) return true;
  return patterns.some((pattern) => {
    if (pattern === '*') return true;
    if (pattern === scope) return true;
    const [resource, verb] = pattern.split(':');
    if (!resource || !verb) return false;
    if (resource === '*' && verb === '*') return true;
    if (resource === '*' && verb === scope.split(':')[1]) return true;
    if (resource === scope.split(':')[0] && (verb === '*' || verb === scope.split(':')[1])) return true;
    return false;
  });
}

/**
 * Create a new external token for a project.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {{ label: string, active?: boolean, createdByName?: string, createdByEmail?: string, createdByUserId?: number|null, userId?: number|null, projectId?: string|null, scopes?: string[]|string|null }} opts
 * @returns {{ id: number, token: string, label: string, active: boolean, createdByName: string }} — raw token, shown once
 */
export function createMcpToken(db, apiKey, opts = {}) {
  const label = (opts.label || '').trim();
  if (!label) throw new Error('label is required');
  const token = `lcytmcp_${randomBytes(32).toString('hex')}`;
  const active = opts.active === undefined ? 1 : (opts.active ? 1 : 0);
  const createdByName = (opts.createdByName || '').trim() || (opts.createdByEmail || '').trim() || 'Unknown';
  const createdByUserId = opts.createdByUserId ?? null;
  const userId = opts.userId ?? createdByUserId ?? null;
  const projectId = opts.projectId ?? apiKey ?? null;
  const scopes = serializeScopes(opts.scopes);

  const info = db.prepare(`
    INSERT INTO mcp_tokens (api_key, label, token_hash, active, created_by_user_id, created_by_name, user_id, project_id, scopes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(apiKey, label, hashToken(token), active, createdByUserId, createdByName, userId, projectId, scopes);

  return { id: Number(info.lastInsertRowid), token, label, active: active === 1, createdByName };
}

/**
 * List a project's non-revoked external tokens (both active and deactivated).
 * Never returns the hash or raw token.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {Array<{ id, label, active, createdByName, createdAt, lastUsedAt, revokedAt }>}
 */
export function listMcpTokens(db, apiKey) {
  return db.prepare(`
    SELECT id, label, active, created_by_name, created_at, last_used_at, revoked_at
    FROM mcp_tokens
    WHERE api_key = ? AND revoked_at IS NULL
    ORDER BY id
  `).all(apiKey).map((row) => ({
    id: row.id,
    label: row.label,
    active: row.active === 1,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  }));
}

/**
 * Update an external token's label, soft active/inactive state, or creator attribution.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey — owning project; a token can only be updated by its owner
 * @param {number} id
 * @param {{ label?: string, active?: boolean, createdByName?: string, userId?: number|null, projectId?: string|null, scopes?: string[]|string|null }} opts
 * @returns {object|null} — the updated token row, or null when not found/already revoked
 */
export function updateMcpToken(db, apiKey, id, opts = {}) {
  const existing = db.prepare('SELECT id FROM mcp_tokens WHERE api_key = ? AND id = ? AND revoked_at IS NULL').get(apiKey, id);
  if (!existing) return null;

  const parts = [];
  const values = [];
  if (opts.label !== undefined) { parts.push('label = ?'); values.push((opts.label || '').trim()); }
  if (opts.active !== undefined) { parts.push('active = ?'); values.push(opts.active ? 1 : 0); }
  if (opts.createdByName !== undefined) { parts.push('created_by_name = ?'); values.push((opts.createdByName || '').trim()); }
  if (opts.userId !== undefined) { parts.push('user_id = ?'); values.push(opts.userId ?? null); }
  if (opts.projectId !== undefined) { parts.push('project_id = ?'); values.push(opts.projectId ?? null); }
  if (opts.scopes !== undefined) { parts.push('scopes = ?'); values.push(serializeScopes(opts.scopes)); }
  if (parts.length === 0) return listMcpTokens(db, apiKey).find((t) => t.id === id) || null;

  values.push(apiKey, id);
  db.prepare(`UPDATE mcp_tokens SET ${parts.join(', ')} WHERE api_key = ? AND id = ?`).run(...values);
  return listMcpTokens(db, apiKey).find((t) => t.id === id) || null;
}

/**
 * Permanently revoke an external token (sets revoked_at + active=0; the row stays
 * in the table for audit purposes but drops out of listMcpTokens).
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey — owning project; a token can only be revoked by its owner
 * @param {number} id
 * @returns {boolean} — false when no matching non-revoked token exists
 */
export function revokeMcpToken(db, apiKey, id) {
  const info = db.prepare(
    "UPDATE mcp_tokens SET revoked_at = datetime('now'), active = 0 WHERE id = ? AND api_key = ? AND revoked_at IS NULL"
  ).run(id, apiKey);
  return info.changes > 0;
}

/**
 * Resolve a raw external token to its owning api_key. Updates last_used_at on hit.
 * Returns null for unknown, deactivated, or revoked tokens. Callers must
 * still validate the resolved api_key itself (active/expiry) via
 * validateApiKey().
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} rawToken
 * @returns {{ apiKey: string, id: number, label: string, userId: number|null, projectId: string|null, scopes: string[]|null } | null}
 */
export function verifyMcpToken(db, rawToken) {
  if (!rawToken || typeof rawToken !== 'string') return null;
  const row = db.prepare(
    'SELECT id, api_key, label, user_id, project_id, scopes FROM mcp_tokens WHERE token_hash = ? AND active = 1 AND revoked_at IS NULL'
  ).get(hashToken(rawToken));
  if (!row) return null;
  db.prepare("UPDATE mcp_tokens SET last_used_at = datetime('now') WHERE id = ?").run(row.id);
  return {
    apiKey: row.api_key,
    id: row.id,
    label: row.label,
    userId: row.user_id ?? null,
    projectId: row.project_id ?? null,
    scopes: row.scopes ? JSON.parse(row.scopes) : null,
  };
}

export const createExternalToken = createMcpToken;
export const listExternalTokens = listMcpTokens;
export const updateExternalToken = updateMcpToken;
export const revokeExternalToken = revokeMcpToken;
export const verifyExternalToken = verifyMcpToken;
