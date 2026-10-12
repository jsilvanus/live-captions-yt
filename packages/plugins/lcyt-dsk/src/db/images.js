// ─── Image / graphics helpers ─────────────────────────────────────────────────

import { createHash } from 'node:crypto';

/**
 * Derive a safe, collision-free per-key directory name component from an API key.
 *
 * Single source of truth for the graphics pipeline's per-project directory
 * segment: it is used as the subdirectory name under GRAPHICS_DIR by the write
 * (routes/images.js), serve, and delete paths — including the delete-on-key
 * path in lcyt-backend's keys.js, which imports this via `lcyt-dsk`. Every site
 * that touches a project's graphics directory must agree on it, so it lives here.
 *
 * The raw key is sanitized to `[a-zA-Z0-9-]` and capped at 40 chars, which is
 * lossy — two distinct keys can sanitize to the same string (by differing only
 * in stripped characters, or beyond the length cap) and would then share a
 * directory. To keep the mapping 1:1 a short hash of the full raw key is
 * appended whenever sanitization altered it. Any already-safe key ≤40 chars —
 * including every default `randomUUID()` key — is returned unchanged, matching
 * the historical output so existing on-disk paths are untouched.
 *
 * @param {string} apiKey
 * @returns {string}
 */
export function safeApiKey(apiKey) {
  const raw = String(apiKey ?? '');
  const safe = raw.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 40);
  if (safe === raw) return safe;
  const suffix = createHash('sha256').update(raw).digest('hex').slice(0, 8);
  return `${safe}-${suffix}`;
}

const num = (v) => (typeof v === 'bigint' ? Number(v) : v);

/** Prisma returns size_bytes as BigInt; callers want plain numbers. */
function shapeImage(row) {
  return row ? { ...row, size_bytes: num(row.size_bytes) } : null;
}

/**
 * Check whether graphics upload is enabled for an API key.
 * @param {import('lcyt-backend/db').Db} db Prisma client
 * @param {string} apiKey
 * @returns {Promise<boolean>}
 */
export async function isGraphicsEnabled(db, apiKey) {
  const row = await db.api_keys.findUnique({ where: { key: apiKey }, select: { graphics_enabled: true } });
  return row ? row.graphics_enabled === 1 : false;
}

/**
 * Register an uploaded image in caption_files.
 * @param {import('lcyt-backend/db').Db} db Prisma client
 * @param {{ apiKey: string, filename: string, shorthand: string, mimeType: string, sizeBytes: number }} data
 * @returns {Promise<number>} row id
 */
export async function registerImage(db, { apiKey, filename, shorthand, mimeType, sizeBytes }) {
  const row = await db.caption_files.create({
    data: {
      api_key: apiKey, filename, shorthand, mime_type: mimeType,
      size_bytes: sizeBytes ?? 0, type: 'image', format: 'image',
      created_at: db.$util.sqlNow(), updated_at: db.$util.sqlNow(),
    },
    select: { id: true },
  });
  return row.id;
}

/**
 * List all images for an API key.
 * @param {import('lcyt-backend/db').Db} db Prisma client
 * @param {string} apiKey
 * @returns {Promise<Array>}
 */
export async function listImages(db, apiKey) {
  const rows = await db.caption_files.findMany({
    where: { api_key: apiKey, type: 'image' },
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
  });
  return rows.map(shapeImage);
}

/**
 * Get a single image row by id (no api_key filter — for public DSK page serving).
 * @param {import('lcyt-backend/db').Db} db Prisma client
 * @param {number} id
 * @returns {Promise<object|null>}
 */
export async function getImage(db, id) {
  return shapeImage(await db.caption_files.findFirst({ where: { id, type: 'image' } }));
}

/**
 * Get a single image row by id, scoped to an API key.
 * @param {import('lcyt-backend/db').Db} db Prisma client
 * @param {number} id
 * @param {string} apiKey
 * @returns {Promise<object|null>}
 */
export async function getImageByKey(db, id, apiKey) {
  return shapeImage(await db.caption_files.findFirst({ where: { id, api_key: apiKey, type: 'image' } }));
}

/**
 * Get an image by shorthand name for a specific API key.
 * @param {import('lcyt-backend/db').Db} db Prisma client
 * @param {string} apiKey
 * @param {string} shorthand
 * @returns {Promise<object|null>}
 */
export async function getImageByShorthand(db, apiKey, shorthand) {
  return shapeImage(await db.caption_files.findFirst({ where: { api_key: apiKey, shorthand, type: 'image' } }));
}

/**
 * Check whether a shorthand name is already taken for an API key.
 * @param {import('lcyt-backend/db').Db} db Prisma client
 * @param {string} apiKey
 * @param {string} shorthand
 * @returns {Promise<boolean>}
 */
export async function isShorthandTaken(db, apiKey, shorthand) {
  const row = await db.caption_files.findFirst({ where: { api_key: apiKey, shorthand, type: 'image' }, select: { id: true } });
  return !!row;
}

/**
 * Delete an image row scoped to an API key.
 * @param {import('lcyt-backend/db').Db} db Prisma client
 * @param {number} id
 * @param {string} apiKey
 * @returns {Promise<object|null>} the deleted row (for disk cleanup), or null if not found
 */
export async function deleteImage(db, id, apiKey) {
  const row = await getImageByKey(db, id, apiKey);
  if (!row) return null;
  await db.caption_files.deleteMany({ where: { id } });
  return row;
}

/**
 * Update the settings_json column for an image scoped to an API key.
 * @param {import('lcyt-backend/db').Db} db Prisma client
 * @param {number} id
 * @param {string} apiKey
 * @param {object} settingsJson  parsed JS object — will be JSON-stringified
 * @returns {Promise<boolean>} true if a row was updated
 */
export async function updateImageSettings(db, id, apiKey, settingsJson) {
  const result = await db.caption_files.updateMany({
    where: { id, api_key: apiKey, type: 'image' },
    data: { settings_json: JSON.stringify(settingsJson) },
  });
  return result.count > 0;
}

/**
 * Delete all image rows for an API key (for hard-delete cascade).
 * @param {import('lcyt-backend/db').Db} db Prisma client
 * @param {string} apiKey
 * @returns {Promise<Array>} deleted rows (for disk cleanup)
 */
export async function deleteAllImages(db, apiKey) {
  const rows = await listImages(db, apiKey);
  await db.caption_files.deleteMany({ where: { api_key: apiKey, type: 'image' } });
  return rows;
}

/**
 * Get total image storage in bytes for an API key.
 * @param {import('lcyt-backend/db').Db} db Prisma client
 * @param {string} apiKey
 * @returns {Promise<number>}
 */
export async function getTotalImageStorageBytes(db, apiKey) {
  const agg = await db.caption_files.aggregate({ where: { api_key: apiKey, type: 'image' }, _sum: { size_bytes: true } });
  return num(agg._sum.size_bytes) ?? 0;
}
