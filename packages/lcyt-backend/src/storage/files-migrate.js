import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { buildVideoStorageKey, localVideoPrefix } from '../db/videos.js';
import { sqlNow } from '../db/helpers.js';

/**
 * Move stored files between the local filesystem and S3 (either direction).
 *
 * Every step is idempotent and resumable: an object is copied only when the
 * destination is missing or differs in size, the copy is verified by size before
 * anything refers to it, a database row is switched only after its files are
 * verified, and the source is removed (with `deleteSource`) only after both.
 * Missing source files are reported, never fatal.
 *
 * `from`/`to` are `{ stores, captions }`: `stores` maps the object-store areas
 * (graphics, icons, dskThumbnails, cameraThumbnails, recordings, backups) to
 * object stores that share the same key layout on both sides, `captions` is a
 * caption-file storage adapter (`openRead`/`openAppend`/`deleteFile`).
 */
export const MIGRATE_AREAS = ['graphics', 'icons', 'dskThumbnails', 'cameraThumbnails', 'recordings', 'captions', 'backups'];

const emptyStats = () => ({ copied: 0, skipped: 0, failed: 0, deleted: 0, bytes: 0 });

async function copyObject(src, dst, key, stats, { dryRun, deleteSource, log }, dstKey = key) {
  let srcMeta;
  try {
    srcMeta = await src.stat(key);
  } catch {
    stats.failed++;
    log(`missing source object ${key}`);
    return false;
  }
  let dstMeta = null;
  try { dstMeta = await dst.stat(dstKey); } catch { /* not there yet */ }
  if (dstMeta && dstMeta.size === srcMeta.size) {
    stats.skipped++;
  } else if (dryRun) {
    stats.copied++;
    stats.bytes += srcMeta.size;
    return true;
  } else {
    try {
      const opened = await src.stream(key);
      const stored = await dst.put(dstKey, opened.stream, { contentType: srcMeta.contentType });
      const verified = stored && stored.size != null ? stored : await dst.stat(dstKey);
      if (verified.size !== srcMeta.size) throw new Error(`size mismatch (${srcMeta.size} vs ${verified.size})`);
      stats.copied++;
      stats.bytes += srcMeta.size;
    } catch (err) {
      stats.failed++;
      log(`failed to copy ${key}: ${err?.message}`);
      return false;
    }
  }
  if (deleteSource && !dryRun) {
    await src.delete(key).then(() => { stats.deleted++; }).catch((err) => log(`could not delete source ${key}: ${err?.message}`));
  }
  return true;
}

async function listAll(store, prefix = '') {
  const keys = [];
  let cursor = null;
  do {
    const page = await store.list(prefix, { limit: 1000, cursor });
    for (const item of page.items) keys.push(item.key);
    cursor = page.nextCursor;
  } while (cursor);
  return keys;
}

async function migrateStoreArea(area, from, to, opts, stats) {
  const src = from.stores[area];
  const dst = to.stores[area];
  if (!src || !dst) return;
  for (const key of await listAll(src)) await copyObject(src, dst, key, stats, opts);
}

/** DSK thumbnail rows written before the object store hold absolute paths; store mode wants the key. */
async function fixThumbnailRows(db, baseDir, stats, { dryRun, log }) {
  if (!baseDir) return;
  const root = resolve(baseDir);
  // On SQLite the table belongs to the DSK plugin and exists once the backend has started once.
  let rows;
  try {
    rows = await db.dsk_thumbnails.findMany({ select: { id: true, storage_path: true } });
  } catch {
    return;
  }
  for (const row of rows) {
    if (!row.storage_path || !isAbsolute(row.storage_path)) continue;
    const rel = relative(root, resolve(row.storage_path));
    if (rel.startsWith('..') || isAbsolute(rel)) {
      log(`thumbnail ${row.id}: ${row.storage_path} is outside ${root}, left as is`);
      continue;
    }
    if (!dryRun) await db.dsk_thumbnails.updateMany({ where: { id: row.id }, data: { storage_path: rel.split(sep).join('/') } });
    stats.rowsUpdated = (stats.rowsUpdated || 0) + 1;
  }
}

async function migrateRecordings(db, direction, from, to, opts, stats) {
  const src = from.stores.recordings;
  const dst = to.stores.recordings;
  if (!src || !dst) return;
  const wantType = direction === 's3' ? 'local' : 's3';
  const videos = await db.videos.findMany({ where: { storage_type: wantType }, select: { id: true, api_key: true, storage_key: true } });
  for (const video of videos) {
    const s3Prefix = buildVideoStorageKey(video.api_key, video.id, video.storage_key);
    const localPrefix = localVideoPrefix(video.api_key, video.id);
    const srcPrefix = direction === 's3' ? localPrefix : s3Prefix;
    const dstPrefix = direction === 's3' ? s3Prefix : localPrefix;
    const keys = await listAll(src, `${srcPrefix}/`);
    if (keys.length === 0) {
      opts.log(`recording ${video.id}: no files under ${srcPrefix}, row left as is`);
      stats.failed++;
      continue;
    }
    let ok = true;
    const dstKeyOf = (key) => dstPrefix + key.slice(srcPrefix.length);
    for (const key of keys) ok = (await copyObject(src, dst, key, stats, { ...opts, deleteSource: false }, dstKeyOf(key))) && ok;
    if (!ok) continue; // never switch a row whose files are not all verified
    if (!opts.dryRun) {
      await db.videos.updateMany({
        where: { id: video.id },
        data: { storage_type: direction === 's3' ? 's3' : 'local', storage_key: direction === 's3' ? s3Prefix : null, updated_at: sqlNow() },
      });
    }
    stats.rowsUpdated = (stats.rowsUpdated || 0) + 1;
    if (opts.deleteSource && !opts.dryRun) {
      for (const key of keys) await src.delete(key).then(() => { stats.deleted++; }).catch(() => {});
    }
  }
}

async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function migrateCaptions(db, direction, from, to, opts, stats) {
  const src = from.captions;
  const dst = to.captions;
  if (!src || !dst) return;
  const rows = await db.caption_files.findMany({ select: { id: true, api_key: true, filename: true, format: true } });
  for (const row of rows) {
    // Local adapter stores absolute paths, the S3 adapter object keys.
    const isLocalRow = isAbsolute(row.filename);
    if ((direction === 's3') !== isLocalRow) { stats.skipped++; continue; }
    if (opts.dryRun) { stats.copied++; continue; }
    try {
      const opened = await src.openRead(row.api_key, row.filename, row.format);
      const body = await readAll(opened.stream);
      const handle = dst.openAppend(row.api_key, basename(row.filename));
      // The local adapter appends: a file already there (earlier run, kept source) must not be written twice.
      const existing = handle.sizeBytes();
      if (existing === 0) await handle.write(body);
      await handle.close();
      if (handle.sizeBytes() !== body.length) throw new Error(`size mismatch (${body.length} vs ${handle.sizeBytes()})`);
      await db.caption_files.updateMany({ where: { id: row.id }, data: { filename: handle.storedKey, updated_at: sqlNow() } });
      stats.copied++;
      stats.bytes += body.length;
      if (opts.deleteSource) {
        await src.deleteFile(row.api_key, row.filename).then(() => { stats.deleted++; }).catch(() => {});
      }
    } catch (err) {
      stats.failed++;
      opts.log(`caption file ${row.id} (${row.filename}): ${err?.message}`);
    }
  }
}

/**
 * @param {{ db: object, direction: 's3'|'local', from: object, to: object, areas?: string[],
 *   dryRun?: boolean, deleteSource?: boolean, thumbnailsBaseDir?: string, log?: Function }} args
 * @returns {Promise<Record<string, { copied: number, skipped: number, failed: number, deleted: number, bytes: number, rowsUpdated?: number }>>}
 */
export async function migrateFiles({
  db, direction, from, to, areas = MIGRATE_AREAS, dryRun = false, deleteSource = false,
  thumbnailsBaseDir = null, log = () => {},
}) {
  if (direction !== 's3' && direction !== 'local') throw new Error("direction must be 's3' or 'local'");
  const opts = { dryRun, deleteSource, log };
  const result = {};
  for (const area of areas) {
    if (!MIGRATE_AREAS.includes(area)) throw new Error(`Unknown area: ${area}`);
    const stats = result[area] = emptyStats();
    if (area === 'recordings') await migrateRecordings(db, direction, from, to, opts, stats);
    else if (area === 'captions') await migrateCaptions(db, direction, from, to, opts, stats);
    else {
      await migrateStoreArea(area, from, to, opts, stats);
      if (area === 'dskThumbnails') await fixThumbnailRows(db, thumbnailsBaseDir, stats, opts);
    }
  }
  return result;
}
