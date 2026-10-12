/**
 * DB helpers for DSK thumbnails.
 *
 * Table: dsk_thumbnails
 *   id            INTEGER PK
 *   api_key       TEXT NOT NULL
 *   template_id   INTEGER NULL
 *   name          TEXT NOT NULL
 *   storage_path  TEXT NOT NULL
 *   width         INTEGER NOT NULL
 *   height        INTEGER NOT NULL
 *   size_bytes    BIGINT NOT NULL DEFAULT 0
 *   created_at    TEXT NOT NULL DEFAULT (datetime('now'))
 *   updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
 */

const num = (v) => (typeof v === 'bigint' ? Number(v) : v);
const THUMB_FIELDS = { id: true, template_id: true, name: true, storage_path: true, width: true, height: true, size_bytes: true, created_at: true, updated_at: true };
const shape = (r) => (r ? { ...r, size_bytes: num(r.size_bytes) } : null);

/**
 * Create a thumbnail row.
 * @param {import('lcyt-backend/db').Db} db Prisma client
 * @param {{ apiKey: string, templateId?: number|null, name: string, storagePath: string, width: number, height: number, sizeBytes?: number }} opts
 * @returns {Promise<number>}
 */
export async function createThumbnail(db, { apiKey, templateId = null, name, storagePath, width, height, sizeBytes = 0 }) {
  const now = db.$util.sqlNow();
  const row = await db.dsk_thumbnails.create({
    data: {
      api_key: apiKey, template_id: templateId ?? null, name, storage_path: storagePath,
      width, height, size_bytes: sizeBytes, created_at: now, updated_at: now,
    },
    select: { id: true },
  });
  return row.id;
}

/**
 * List thumbnails for an API key.
 * @param {import('lcyt-backend/db').Db} db Prisma client
 * @param {string} apiKey
 * @returns {Promise<Array<object>>}
 */
export async function listThumbnails(db, apiKey) {
  const rows = await db.dsk_thumbnails.findMany({
    where: { api_key: apiKey },
    select: THUMB_FIELDS,
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
  });
  return rows.map(shape);
}

/**
 * Get a thumbnail row for an API key.
 * @param {import('lcyt-backend/db').Db} db Prisma client
 * @param {number} id
 * @param {string} apiKey
 * @returns {Promise<object|null>}
 */
export async function getThumbnail(db, id, apiKey) {
  return shape(await db.dsk_thumbnails.findFirst({ where: { id, api_key: apiKey }, select: THUMB_FIELDS }));
}

/**
 * Update a thumbnail row.
 * @param {import('lcyt-backend/db').Db} db Prisma client
 * @param {number} id
 * @param {string} apiKey
 * @param {{ name?: string, templateId?: number|null, width?: number, height?: number, sizeBytes?: number, storagePath?: string }} patch
 * @returns {Promise<boolean>}
 */
export async function updateThumbnail(db, id, apiKey, patch = {}) {
  const data = {};
  if (patch.name != null) data.name = patch.name;
  if (patch.templateId != null) data.template_id = patch.templateId;
  if (patch.width != null) data.width = patch.width;
  if (patch.height != null) data.height = patch.height;
  if (patch.sizeBytes != null) data.size_bytes = patch.sizeBytes;
  if (patch.storagePath != null) data.storage_path = patch.storagePath;
  if (Object.keys(data).length === 0) return false;
  data.updated_at = db.$util.sqlNow();
  const res = await db.dsk_thumbnails.updateMany({ where: { id, api_key: apiKey }, data });
  return res.count > 0;
}

/**
 * Delete a thumbnail row.
 * @param {import('lcyt-backend/db').Db} db Prisma client
 * @param {number} id
 * @param {string} apiKey
 * @returns {Promise<boolean>}
 */
export async function deleteThumbnail(db, id, apiKey) {
  const res = await db.dsk_thumbnails.deleteMany({ where: { id, api_key: apiKey } });
  return res.count > 0;
}
