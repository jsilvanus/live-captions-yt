import { mkdirSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getMetricsInstance } from '../metrics/index.js';
import logger from 'lcyt/logger';
import { sqlNow, num } from './helpers.js';

/** BigInt columns only take whole numbers; round floats and keep null/undefined. */
function toBig(v) {
  return v == null ? v : Math.round(Number(v));
}

function safeSlug(value) {
  const input = String(value || 'project').toLowerCase();
  let slug = '';
  for (const char of input) {
    if ((char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || char === '.' || char === '_' || char === '-') {
      slug += char;
    } else {
      slug += '-';
    }
  }
  return slug.replace(/-+/g, '-').replace(/^-|-$/g, '') || 'project';
}

export function buildVideoStorageKey(apiKey, videoId, storageKey = null) {
  if (storageKey) return storageKey;
  // The API key is a credential and must not end up in object keys or URLs: key by video id only.
  return `videos/${videoId}`;
}

export function getVideosStorageRoot() {
  return process.env.VIDEOS_STORAGE_DIR || join(process.cwd(), 'recordings');
}

export function getVideoStorageDir(apiKey, videoId) {
  return join(getVideosStorageRoot(), safeSlug(apiKey), String(videoId));
}

/** Key of a video's files inside a local recordings store (the on-disk layout, unlike the S3 key, includes the key slug). */
export function localVideoPrefix(apiKey, videoId) {
  return `${safeSlug(apiKey)}/${videoId}`;
}

function ensureVideoDir(apiKey, videoId) {
  const dir = getVideoStorageDir(apiKey, videoId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function formatRow(row) {
  return {
    id: row.id,
    broadcastId: row.broadcast_id ?? null,
    title: row.title,
    status: row.status,
    storageType: row.storage_type,
    storageKey: row.storage_key ?? null,
    durationMs: num(row.duration_ms) ?? null,
    sizeBytes: num(row.size_bytes) ?? 0,
    startedAt: row.started_at ?? null,
    endedAt: row.ended_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @param {{ status?: string, broadcastId?: string }} [opts]
 * @returns {Promise<object[]>}
 */
export async function listVideos(db, apiKey, { status, broadcastId } = {}) {
  const where = { api_key: apiKey };
  if (status) where.status = status;
  if (broadcastId) where.broadcast_id = broadcastId;
  const rows = await db.videos.findMany({ where, orderBy: { created_at: 'desc' } });
  return rows.map(formatRow);
}

/**
 * @param {import('./connection.js').Db} db
 * @returns {Promise<object|null>}
 */
export async function getVideo(db, apiKey, id) {
  const row = await db.videos.findFirst({ where: { api_key: apiKey, id } });
  return row ? formatRow(row) : null;
}

/**
 * @param {import('./connection.js').Db} db
 * @returns {Promise<{ ok: true, video: object }>}
 */
export async function createVideo(db, apiKey, fields = {}) {
  const {
    id = randomUUID(),
    broadcastId = null,
    title = 'Recorded broadcast',
    status = 'recording',
    storageType = 'local',
    storageKey = null,
    durationMs = null,
    sizeBytes = 0,
    startedAt = null,
    endedAt = null,
  } = fields;

  const resolvedStorageKey = storageKey ?? (storageType === 's3' ? buildVideoStorageKey(apiKey, id) : null);

  ensureVideoDir(apiKey, id);
  await db.videos.create({
    data: {
      id,
      api_key: apiKey,
      broadcast_id: broadcastId,
      title,
      status,
      storage_type: storageType,
      storage_key: resolvedStorageKey,
      duration_ms: toBig(durationMs),
      size_bytes: toBig(sizeBytes) ?? 0,
      started_at: startedAt,
      ended_at: endedAt,
    },
  });
  getMetricsInstance()?.count('videos.created', 1, { project: apiKey });
  return { ok: true, video: await getVideo(db, apiKey, id) };
}

/**
 * @param {import('./connection.js').Db} db
 * @returns {Promise<{ ok: true, video: object }|{ ok: false, error: string, status?: number }>}
 */
export async function updateVideo(db, apiKey, id, patch = {}) {
  const existing = await getVideo(db, apiKey, id);
  if (!existing) return { ok: false, error: 'Video not found', status: 404 };

  const data = {};
  const updatable = {
    title: 'title',
    status: 'status',
    storageType: 'storage_type',
    storageKey: 'storage_key',
    durationMs: 'duration_ms',
    sizeBytes: 'size_bytes',
    startedAt: 'started_at',
    endedAt: 'ended_at',
  };
  for (const [key, column] of Object.entries(updatable)) {
    if (patch[key] !== undefined) {
      data[column] = (key === 'durationMs' || key === 'sizeBytes') ? toBig(patch[key]) : patch[key];
    }
  }
  if (Object.keys(data).length === 0) return { ok: true, video: existing };

  data.updated_at = sqlNow();
  await db.videos.updateMany({ where: { api_key: apiKey, id }, data });
  return { ok: true, video: await getVideo(db, apiKey, id) };
}

/**
 * @param {import('./connection.js').Db} db
 */
export async function deleteVideo(db, apiKey, id, { recordingsStore = null } = {}) {
  const video = await getVideo(db, apiKey, id);
  if (!video) return { ok: false, error: 'Video not found', status: 404 };
  const dir = getVideoStorageDir(apiKey, id);
  if (video.storageType === 's3' && recordingsStore) {
    const prefix = video.storageKey || buildVideoStorageKey(apiKey, id);
    await recordingsStore.deletePrefix(prefix).catch((err) => {
      logger.warn(`[videos] Failed to delete recording prefix ${prefix}: ${err?.message}`);
    });
  }
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  await db.videos.deleteMany({ where: { api_key: apiKey, id } });
  return { ok: true };
}

/** @param {import('./connection.js').Db} db */
export async function startVideoRecording(db, apiKey, fields = {}) {
  const startedAt = fields.startedAt || new Date().toISOString();
  return createVideo(db, apiKey, {
    title: fields.title || 'Recorded broadcast',
    broadcastId: fields.broadcastId ?? null,
    status: 'recording',
    storageType: fields.storageType || 'local',
    storageKey: fields.storageKey || null,
    startedAt,
  });
}

/** @param {import('./connection.js').Db} db */
export async function finishVideoRecording(db, apiKey, id, fields = {}) {
  const sizeBytes = Number(fields.sizeBytes ?? 0);
  if (sizeBytes > 0) getMetricsInstance()?.count('videos.bytes', sizeBytes, { project: apiKey });
  return updateVideo(db, apiKey, id, {
    status: fields.status || 'completed',
    endedAt: fields.endedAt || new Date().toISOString(),
    sizeBytes: fields.sizeBytes ?? 0,
    durationMs: fields.durationMs ?? null,
  });
}

/**
 * Upload a finished recording's local artifacts to S3 when the video row
 * is marked `storage_type='s3'`. MediaMTX writes recordings to local disk
 * unconditionally, so this is what actually makes that flag true; on
 * upload failure the row is downgraded to `storage_type='local'` so
 * playback still works from the (already-written) local files instead of
 * 404ing forever against an S3 location nothing populated.
 *
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @param {string} videoId
 */
function listLocalFilesRecursive(rootDir, currentDir = rootDir, out = []) {
  const entries = readdirSync(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      listLocalFilesRecursive(rootDir, fullPath, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const rel = relative(rootDir, fullPath).split('\\').join('/');
    const st = statSync(fullPath);
    out.push({ fullPath, relativePath: rel, size: st.size });
  }
  return out;
}

// MediaMTX may still be flushing its last segment when the upload starts. Wait until the
// directory listing (names and sizes) is identical on two scans `settleMs` apart.
async function waitForStableDirectory(dir, { settleMs, maxWaitMs }) {
  const snapshot = () => {
    if (!existsSync(dir)) return '';
    return listLocalFilesRecursive(dir).map((f) => `${f.relativePath}:${f.size}`).sort().join('|');
  };
  let previous = snapshot();
  const deadline = Date.now() + maxWaitMs;
  while (settleMs > 0 && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, settleMs));
    const current = snapshot();
    if (current === previous) return;
    previous = current;
  }
}

export async function syncVideoRecordingToStorage(db, apiKey, videoId, {
  recordingsStore = null,
  maxConcurrency = 4,
  settleMs = 1000,
  maxWaitMs = 30000,
} = {}) {
  const video = await getVideo(db, apiKey, videoId);
  if (!video || video.storageType !== 's3') return;
  if (!recordingsStore) {
    logger.warn(`[videos] recording ${videoId} is marked s3 but no recordingsStore is configured; falling back to local`);
    await updateVideo(db, apiKey, videoId, { storageType: 'local' });
    return;
  }
  const dir = getVideoStorageDir(apiKey, videoId);
  const prefix = video.storageKey || buildVideoStorageKey(apiKey, videoId);
  try {
    await waitForStableDirectory(dir, { settleMs, maxWaitMs });
    const files = listLocalFilesRecursive(dir);
    let cursor = 0;
    let totalBytes = 0;

    async function uploadNext() {
      while (cursor < files.length) {
        const idx = cursor++;
        const file = files[idx];
        const objectKey = `${prefix}/${file.relativePath}`;
        const uploaded = await recordingsStore.putFile(objectKey, file.fullPath);
        const remoteSize = Number(uploaded?.size ?? 0);
        if (remoteSize !== file.size) {
          throw new Error(`size verification failed for ${objectKey}: local=${file.size}, remote=${remoteSize}`);
        }
        totalBytes += file.size;
      }
    }

    const workerCount = Math.max(1, Math.min(Number(maxConcurrency) || 1, files.length || 1));
    await Promise.all(Array.from({ length: workerCount }, uploadNext));

    await updateVideo(db, apiKey, videoId, { sizeBytes: totalBytes });
    if (totalBytes > 0) getMetricsInstance()?.count('videos.bytes', totalBytes, { project: apiKey });
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    logger.warn(`[videos] S3 upload failed for recording ${videoId}, falling back to local storage: ${err?.message}`);
    // Do not leave a half-uploaded copy behind; the local files stay the source of truth.
    try { await recordingsStore.deletePrefix?.(prefix); } catch { /* best effort */ }
    await updateVideo(db, apiKey, videoId, { storageType: 'local' });
  }
}

export function resolveVideoAssetPath(apiKey, videoId, relativePath = 'playlist.m3u8') {
  const root = resolve(getVideoStorageDir(apiKey, videoId));
  const target = resolve(root, relativePath);
  const rel = relative(root, target);
  if (rel.startsWith('..') || rel === '') {
    return null;
  }
  return target;
}
