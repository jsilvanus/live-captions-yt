import { createHash, randomBytes } from 'node:crypto';

/**
 * Personal MCP access tokens (plan/mcp).
 *
 * Raw token format: `lcytmcp_<64 hex chars>`. Only the SHA-256 hex digest is
 * stored (`token_hash`); the raw token is returned exactly once at creation.
 */

function hashToken(rawToken) {
  return createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Create a new MCP token for a project.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {string} label — e.g. "Alice's Claude Desktop"
 * @returns {{ id: number, token: string }} — raw token, shown once
 */
export function createMcpToken(db, apiKey, label) {
  const token = `lcytmcp_${randomBytes(32).toString('hex')}`;
  const info = db.prepare(
    'INSERT INTO mcp_tokens (api_key, label, token_hash) VALUES (?, ?, ?)'
  ).run(apiKey, label, hashToken(token));
  return { id: Number(info.lastInsertRowid), token };
}

/**
 * List a project's MCP tokens. Never returns the hash or raw token.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {Array<{ id, label, createdAt, lastUsedAt, revokedAt }>}
 */
export function listMcpTokens(db, apiKey) {
  return db.prepare(
    'SELECT id, label, created_at, last_used_at, revoked_at FROM mcp_tokens WHERE api_key = ? ORDER BY id'
  ).all(apiKey).map((row) => ({
    id: row.id,
    label: row.label,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  }));
}

/**
 * Revoke an MCP token (sets revoked_at; the row stays for the audit list).
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey — owning project; a token can only be revoked by its owner
 * @param {number} id
 * @returns {boolean} — false when no matching active token exists
 */
export function revokeMcpToken(db, apiKey, id) {
  const info = db.prepare(
    "UPDATE mcp_tokens SET revoked_at = datetime('now') WHERE id = ? AND api_key = ? AND revoked_at IS NULL"
  ).run(id, apiKey);
  return info.changes > 0;
}

/**
 * Resolve a raw MCP token to its owning api_key. Updates last_used_at on hit.
 * Returns null for unknown or revoked tokens. Callers must still validate the
 * resolved api_key itself (active/expiry) via validateApiKey().
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} rawToken
 * @returns {{ apiKey: string, id: number, label: string } | null}
 */
export function verifyMcpToken(db, rawToken) {
  if (!rawToken || typeof rawToken !== 'string') return null;
  const row = db.prepare(
    'SELECT id, api_key, label FROM mcp_tokens WHERE token_hash = ? AND revoked_at IS NULL'
  ).get(hashToken(rawToken));
  if (!row) return null;
  db.prepare("UPDATE mcp_tokens SET last_used_at = datetime('now') WHERE id = ?").run(row.id);
  return { apiKey: row.api_key, id: row.id, label: row.label };
}
