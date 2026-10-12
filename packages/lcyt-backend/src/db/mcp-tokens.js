import { createHash, randomBytes } from 'node:crypto';
import { topicMatches } from 'lcyt/event-bus';
import { sqlNow } from './helpers.js';

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

/**
 * Serialize a scopes input to canonical JSON for storage. Always emits a
 * JSON array string (or null for empty/full-access) — a bare or
 * comma-joined string input (e.g. `"dsk:read"` or `"dsk:read,events:read"`)
 * is normalized into an array rather than stored as-is, so every *new* row
 * is unambiguous JSON. `parseScopes()` below still tolerates a raw
 * non-JSON string on read, for any row written before this normalization
 * existed — this only stops the ambiguity from growing.
 */
function serializeScopes(scopes) {
  if (Array.isArray(scopes)) {
    return JSON.stringify(scopes.filter(Boolean));
  }
  if (typeof scopes === 'string' && scopes.trim()) {
    const trimmed = scopes.trim();
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return JSON.stringify(parsed.filter(Boolean));
    } catch {
      // Not JSON — fall through to comma/bare-string normalization below.
    }
    return JSON.stringify(trimmed.split(',').map((entry) => entry.trim()).filter(Boolean));
  }
  return null;
}

function parseScopes(value) {
  if (!value) return null;
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [trimmed];
    } catch {
      return trimmed.split(',').map((entry) => entry.trim()).filter(Boolean);
    }
  }
  return null;
}

/**
 * Does a token's scope set permit subscribing to an event-bus `topic`?
 *
 * Distinct from `tokenHasScope` (which matches `resource:verb` scopes): event
 * topics are dotted (`dsk.graphics_changed`, `cue.fired`), so their scope
 * patterns are dotted too — an exact topic, a `<domain>.*` wildcard, or a bare
 * `*`. Semantics:
 *   - empty / NULL scopes            → full access (all topics), like tokenHasScope
 *   - scopes with only `resource:verb` entries and no dotted-topic pattern
 *                                     → no topic restriction declared → allow
 *   - one or more dotted-topic patterns → allow iff one matches `topic`
 *
 * The wildcard matching reuses the bus's own `topicMatches`, so the endpoint and
 * the bus agree on what `dsk.*` means.
 * @param {string[]|string|null} scopes
 * @param {string} topic
 * @returns {boolean}
 */
export function tokenAllowsTopic(scopes, topic) {
  const normalized = Array.isArray(scopes) ? scopes : parseScopes(scopes);
  if (!normalized || normalized.length === 0) return true;
  // A topic pattern is any scope entry that isn't a `resource:verb` scope.
  const topicPatterns = normalized.filter((s) => !String(s).includes(':'));
  if (topicPatterns.length === 0) return true;
  return topicMatches(topicPatterns, topic);
}

export function tokenHasScope(scopes, scope) {
  if (!scope) return true;
  const normalized = Array.isArray(scopes) ? scopes : parseScopes(scopes);
  if (!normalized || normalized.length === 0) return true;
  return normalized.some((pattern) => {
    if (pattern === '*') return true;
    if (pattern === scope) return true;
    const [resource, verb] = String(pattern).split(':');
    if (!resource || !verb) return false;
    const [scopeResource, scopeVerb] = String(scope).split(':');
    if (resource === '*' && verb === '*') return true;
    if (resource === '*' && verb === scopeVerb) return true;
    if (resource === scopeResource && (verb === '*' || verb === scopeVerb)) return true;
    return false;
  });
}

/**
 * Create a new external token for a project.
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @param {{ label: string, active?: boolean, createdByName?: string, createdByEmail?: string, createdByUserId?: number|null, userId?: number|null, projectId?: string|null, scopes?: string[]|string|null }} opts
 * @returns {Promise<{ id: number, token: string, label: string, active: boolean, createdByName: string, scopes: string[]|null }>} — raw token, shown once
 */
export async function createMcpToken(db, apiKey, opts = {}) {
  const label = (opts.label || '').trim();
  if (!label) throw new Error('label is required');
  const token = `lcytmcp_${randomBytes(32).toString('hex')}`;
  const active = opts.active === undefined ? 1 : (opts.active ? 1 : 0);
  const createdByName = (opts.createdByName || '').trim() || (opts.createdByEmail || '').trim() || 'Unknown';
  const createdByUserId = opts.createdByUserId ?? null;
  const userId = opts.userId ?? createdByUserId ?? null;
  const projectId = opts.projectId ?? apiKey ?? null;
  const scopes = serializeScopes(opts.scopes);

  const created = await db.mcp_tokens.create({
    data: {
      api_key: apiKey,
      label,
      token_hash: hashToken(token),
      active,
      created_by_user_id: createdByUserId,
      created_by_name: createdByName,
      user_id: userId,
      project_id: projectId,
      scopes,
      created_at: sqlNow(),
    },
    select: { id: true },
  });

  return { id: created.id, token, label, active: active === 1, createdByName, scopes: parseScopes(scopes) };
}

/**
 * List a project's non-revoked external tokens (both active and deactivated).
 * Never returns the hash or raw token.
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @returns {Promise<Array<{ id, label, active, createdByName, createdAt, lastUsedAt, revokedAt }>>}
 */
export async function listMcpTokens(db, apiKey) {
  const rows = await db.mcp_tokens.findMany({
    where: { api_key: apiKey, revoked_at: null },
    select: { id: true, label: true, active: true, created_by_name: true, created_at: true, last_used_at: true, revoked_at: true },
    orderBy: { id: 'asc' },
  });
  return rows.map((row) => ({
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
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey — owning project; a token can only be updated by its owner
 * @param {number} id
 * @param {{ label?: string, active?: boolean, createdByName?: string, userId?: number|null, projectId?: string|null, scopes?: string[]|string|null }} opts
 * @returns {Promise<object|null>} — the updated token row, or null when not found/already revoked
 */
export async function updateMcpToken(db, apiKey, id, opts = {}) {
  const existing = await db.mcp_tokens.findFirst({ where: { api_key: apiKey, id, revoked_at: null }, select: { id: true } });
  if (!existing) return null;

  const data = {};
  if (opts.label !== undefined) data.label = (opts.label || '').trim();
  if (opts.active !== undefined) data.active = opts.active ? 1 : 0;
  if (opts.createdByName !== undefined) data.created_by_name = (opts.createdByName || '').trim();
  if (opts.userId !== undefined) data.user_id = opts.userId ?? null;
  if (opts.projectId !== undefined) data.project_id = opts.projectId ?? null;
  if (opts.scopes !== undefined) data.scopes = serializeScopes(opts.scopes);
  if (Object.keys(data).length > 0) {
    await db.mcp_tokens.updateMany({ where: { api_key: apiKey, id }, data });
  }
  return (await listMcpTokens(db, apiKey)).find((t) => t.id === id) || null;
}

/**
 * Permanently revoke an external token (sets revoked_at + active=0; the row stays
 * in the table for audit purposes but drops out of listMcpTokens).
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey — owning project; a token can only be revoked by its owner
 * @param {number} id
 * @returns {Promise<boolean>} — false when no matching non-revoked token exists
 */
export async function revokeMcpToken(db, apiKey, id) {
  const info = await db.mcp_tokens.updateMany({
    where: { id, api_key: apiKey, revoked_at: null },
    data: { revoked_at: sqlNow(), active: 0 },
  });
  return info.count > 0;
}

/**
 * Resolve a raw external token to its owning api_key. Updates last_used_at on hit.
 * Returns null for unknown, deactivated, or revoked tokens. Callers must
 * still validate the resolved api_key itself (active/expiry) via
 * validateApiKey().
 *
 * @param {import('./connection.js').Db} db
 * @param {string} rawToken
 * @returns {Promise<{ apiKey: string, id: number, label: string, userId: number|null, projectId: string|null, scopes: string[]|null } | null>}
 */
export async function verifyMcpToken(db, rawToken) {
  if (!rawToken || typeof rawToken !== 'string') return null;
  const row = await db.mcp_tokens.findFirst({
    where: { token_hash: hashToken(rawToken), active: 1, revoked_at: null },
    select: { id: true, api_key: true, label: true, user_id: true, project_id: true, scopes: true },
  });
  if (!row) return null;
  await db.mcp_tokens.updateMany({ where: { id: row.id }, data: { last_used_at: sqlNow() } });
  return {
    apiKey: row.api_key,
    id: row.id,
    label: row.label,
    userId: row.user_id ?? null,
    projectId: row.project_id ?? null,
    scopes: parseScopes(row.scopes),
  };
}

export const createExternalToken = createMcpToken;
export const listExternalTokens = listMcpTokens;
export const updateExternalToken = updateMcpToken;
export const revokeExternalToken = revokeMcpToken;
export const verifyExternalToken = verifyMcpToken;
