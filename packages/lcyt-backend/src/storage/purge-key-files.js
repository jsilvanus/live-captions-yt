import { existsSync, unlinkSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { safeApiKey } from '../db.js';
import { iconKeySegment } from '../routes/icons.js';
import { listVideos, deleteVideo } from '../db/videos.js';

/**
 * Remove every stored file that belongs to one API key (project): graphics,
 * icons, DSK template thumbnails, recordings and caption files. Works for both
 * the local and the S3 object stores. Best effort: each step logs and carries
 * on, so a missing object never blocks deleting the key itself.
 *
 * Call it before the key (and with it the rows that name the files) is deleted.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {{ mediaStores?: object, resolveStorage?: Function, imageRows?: Array<{ filename: string }> }} deps
 * @returns {Promise<{ failures: string[] }>}
 */
export async function purgeKeyFiles(db, apiKey, { mediaStores = null, resolveStorage = null, imageRows = [] } = {}) {
  const failures = [];
  const step = async (label, fn) => {
    try { await fn(); } catch (err) {
      failures.push(label);
      console.warn(`[keys] Could not delete ${label} for key ${apiKey}: ${err?.message}`);
    }
  };

  if (!mediaStores?.graphicsStore) {
    // No object store wired (tests, embedded use): plain files under GRAPHICS_DIR.
    const baseDir = resolve(process.env.GRAPHICS_DIR || '/data/images');
    await step('graphics', async () => {
      for (const row of imageRows) {
        const filepath = join(baseDir, safeApiKey(apiKey), basename(row.filename));
        if (existsSync(filepath)) unlinkSync(filepath);
      }
    });
  } else {
    const seg = safeApiKey(apiKey);
    await step('graphics', async () => {
      await mediaStores.graphicsStore.deletePrefix(seg);
      for (const row of imageRows) await mediaStores.graphicsStore.delete(`${seg}/${row.filename}`).catch(() => {});
    });
  }
  if (mediaStores?.iconsStore) {
    await step('icons', () => mediaStores.iconsStore.deletePrefix(iconKeySegment(apiKey)));
  }
  if (mediaStores?.dskThumbnailsStore) {
    const seg = String(apiKey || 'default').replace(/[^a-zA-Z0-9._-]+/g, '_');
    await step('DSK thumbnails', () => mediaStores.dskThumbnailsStore.deletePrefix(seg));
  }

  await step('recordings', async () => {
    for (const video of await listVideos(db, apiKey)) {
      await deleteVideo(db, apiKey, video.id, { recordingsStore: mediaStores?.recordingsStore ?? null });
    }
  });

  if (resolveStorage) {
    await step('caption files', async () => {
      const storage = await resolveStorage(apiKey);
      const rows = await db.caption_files.findMany({ where: { api_key: apiKey }, select: { filename: true } });
      for (const row of rows) await storage.deleteFile(apiKey, row.filename).catch(() => {});
    });
  }

  return { failures };
}
