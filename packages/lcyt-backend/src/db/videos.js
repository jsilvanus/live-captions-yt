import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getMetricsInstance } from '../metrics/index.js';
import { uploadDirectoryToS3 } from '../storage/s3.js';
import logger from 'lcyt/logger';

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
  return `${safeSlug(apiKey)}/${videoId}`;
}

export function getVideosStorageRoot() {
  return process.env.VIDEOS_STORAGE_DIR || join(process.cwd(), 'recordings');
}

export function getVideoStorageDir(apiKey, videoId) {
  return join(getVideosStorageRoot(), safeSlug(apiKey), String(videoId));
}

function ensureVideoArtifacts(apiKey, videoId) {
  const dir = getVideoStorageDir(apiKey, videoId);
  mkdirSync(dir, { recursive: true });
  const playlistPath = join(dir, 'playlist.m3u8');
  if (!existsSync(playlistPath)) {
    writeFileSync(playlistPath, `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXTINF:1.0,placeholder\nsegment0.ts\n#EXT-X-ENDLIST\n`);
  }
  const segmentPath = join(dir, 'segment0.ts');
  if (!existsSync(segmentPath)) {
    writeFileSync(segmentPath, '');
  }
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
    durationMs: row.duration_ms ?? null,
    sizeBytes: row.size_bytes ?? 0,
    startedAt: row.started_at ?? null,
    endedAt: row.ended_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listVideos(db, apiKey, { status, broadcastId } = {}) {
  const clauses = ['api_key = ?'];
  const params = [apiKey];
  if (status) {
    clauses.push('status = ?');
    params.push(status);
  }
  if (broadcastId) {
    clauses.push('broadcast_id = ?');
    params.push(broadcastId);
  }
  const rows = db.prepare(`SELECT * FROM videos WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC`).all(...params);
  return rows.map(formatRow);
}

export function getVideo(db, apiKey, id) {
  const row = db.prepare('SELECT * FROM videos WHERE api_key = ? AND id = ?').get(apiKey, id);
  return row ? formatRow(row) : null;
}

export function createVideo(db, apiKey, fields = {}) {
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

  ensureVideoArtifacts(apiKey, id);
  db.prepare(`
    INSERT INTO videos (
      id, api_key, broadcast_id, title, status, storage_type, storage_key,
      duration_ms, size_bytes, started_at, ended_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    apiKey,
    broadcastId,
    title,
    status,
    storageType,
    resolvedStorageKey,
    durationMs,
    sizeBytes,
    startedAt,
    endedAt,
  );
  getMetricsInstance()?.count('videos.created', 1, { project: apiKey });
  return { ok: true, video: getVideo(db, apiKey, id) };
}

export function updateVideo(db, apiKey, id, patch = {}) {
  const existing = getVideo(db, apiKey, id);
  if (!existing) return { ok: false, error: 'Video not found', status: 404 };

  const sets = [];
  const params = [];
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
      sets.push(`${column} = ?`);
      params.push(patch[key]);
    }
  }
  if (sets.length === 0) return { ok: true, video: existing };

  sets.push("updated_at = datetime('now')");
  params.push(apiKey, id);
  db.prepare(`UPDATE videos SET ${sets.join(', ')} WHERE api_key = ? AND id = ?`).run(...params);
  return { ok: true, video: getVideo(db, apiKey, id) };
}

export function deleteVideo(db, apiKey, id) {
  const video = getVideo(db, apiKey, id);
  if (!video) return { ok: false, error: 'Video not found', status: 404 };
  const dir = getVideoStorageDir(apiKey, id);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  db.prepare('DELETE FROM videos WHERE api_key = ? AND id = ?').run(apiKey, id);
  return { ok: true };
}

export function startVideoRecording(db, apiKey, fields = {}) {
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

export function finishVideoRecording(db, apiKey, id, fields = {}) {
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
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {string} videoId
 */
export async function syncVideoRecordingToStorage(db, apiKey, videoId) {
  const video = getVideo(db, apiKey, videoId);
  if (!video || video.storageType !== 's3') return;
  const dir = getVideoStorageDir(apiKey, videoId);
  try {
    const { totalBytes } = await uploadDirectoryToS3(dir, video.storageKey || buildVideoStorageKey(apiKey, videoId));
    updateVideo(db, apiKey, videoId, { sizeBytes: totalBytes });
  } catch (err) {
    logger.warn(`[videos] S3 upload failed for recording ${videoId}, falling back to local storage: ${err?.message}`);
    updateVideo(db, apiKey, videoId, { storageType: 'local' });
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
