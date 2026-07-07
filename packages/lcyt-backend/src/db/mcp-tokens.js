import { createHash, randomBytes } from 'node:crypto';

/**
 * Personal MCP access tokens (plan/mcp).
 *
 * Named, individually-revocable bearer tokens a project owner generates and
 * pastes into a local MCP client config (Claude Desktop, Claude Code).
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

/**
 * Create a new MCP token for a project.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {{ label: string, active?: boolean, createdByName?: string, createdByEmail?: string, createdByUserId?: number|null }} opts
 * @returns {{ id: number, token: string, label: string, active: boolean, createdByName: string }} — raw token, shown once
 */
export function createMcpToken(db, apiKey, opts = {}) {
  const label = (opts.label || '').trim();
  if (!label) throw new Error('label is required');
  const token = `lcytmcp_${randomBytes(32).toString('hex')}`;
  const active = opts.active === undefined ? 1 : (opts.active ? 1 : 0);
  const createdByName = (opts.createdByName || '').trim() || (opts.createdByEmail || '').trim() || 'Unknown';
  const createdByUserId = opts.createdByUserId ?? null;

  const info = db.prepare(`
    INSERT INTO mcp_tokens (api_key, label, token_hash, active, created_by_user_id, created_by_name)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(apiKey, label, hashToken(token), active, createdByUserId, createdByName);

  return { id: Number(info.lastInsertRowid), token, label, active: active === 1, createdByName };
}

/**
 * List a project's non-revoked MCP tokens (both active and deactivated).
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
 * Update a token's label, soft active/inactive state, or creator attribution.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey — owning project; a token can only be updated by its owner
 * @param {number} id
 * @param {{ label?: string, active?: boolean, createdByName?: string }} opts
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
  if (parts.length === 0) return listMcpTokens(db, apiKey).find((t) => t.id === id) || null;

  values.push(apiKey, id);
  db.prepare(`UPDATE mcp_tokens SET ${parts.join(', ')} WHERE api_key = ? AND id = ?`).run(...values);
  return listMcpTokens(db, apiKey).find((t) => t.id === id) || null;
}

/**
 * Permanently revoke an MCP token (sets revoked_at + active=0; the row stays
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
 * Resolve a raw MCP token to its owning api_key. Updates last_used_at on hit.
 * Returns null for unknown, deactivated, or revoked tokens. Callers must
 * still validate the resolved api_key itself (active/expiry) via
 * validateApiKey().
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} rawToken
 * @returns {{ apiKey: string, id: number, label: string } | null}
 */
export function verifyMcpToken(db, rawToken) {
  if (!rawToken || typeof rawToken !== 'string') return null;
  const row = db.prepare(
    'SELECT id, api_key, label FROM mcp_tokens WHERE token_hash = ? AND active = 1 AND revoked_at IS NULL'
  ).get(hashToken(rawToken));
  if (!row) return null;
  db.prepare("UPDATE mcp_tokens SET last_used_at = datetime('now') WHERE id = ?").run(row.id);
  return { apiKey: row.api_key, id: row.id, label: row.label };
}
