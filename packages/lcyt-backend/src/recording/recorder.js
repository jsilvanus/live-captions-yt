import { existsSync, readdirSync, statSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnFfmpeg } from 'lcyt-compute/ffmpeg';
import logger from 'lcyt/logger';
import { getVideoStorageDir, getVideosStorageRoot, getVideo, updateVideo, syncVideoRecordingToStorage } from '../db/videos.js';

/** Where MediaMTX sees the recordings root. Differs from `VIDEOS_STORAGE_DIR` when MediaMTX runs in a container. */
export function getMediaMtxRecordRoot() {
  return process.env.MEDIAMTX_RECORD_DIR || getVideosStorageRoot();
}

function slash(p) {
  return String(p).split('\\').join('/');
}

/**
 * MediaMTX `recordPath` template for one recording. MediaMTX requires %path and the time
 * variables in the template (a bare directory is rejected), and appends the extension itself.
 * Files end up in `<VIDEOS_STORAGE_DIR>/<slug>/<videoId>/<path name>/<time>.mp4`, which is
 * `getVideoStorageDir(apiKey, videoId)` as the backend sees it.
 */
export function mediaMtxRecordPath(apiKey, videoId) {
  const backendDir = getVideoStorageDir(apiKey, videoId);
  const rel = slash(relative(getVideosStorageRoot(), backendDir));
  return `${slash(getMediaMtxRecordRoot()).replace(/\/$/, '')}/${rel}/%path/%Y-%m-%d_%H-%M-%S-%f`;
}

/**
 * Turn MediaMTX recording on or off for one path. Never throws: a recording problem must not
 * break going live or ending a session.
 */
export async function configureMediaMtxRecording(mediamtxClient, { pathName, apiKey, videoId, enabled }) {
  if (!mediamtxClient || !pathName) return false;
  const config = enabled
    ? {
        record: true,
        recordFormat: 'fmp4',
        recordPath: mediaMtxRecordPath(apiKey, videoId),
        recordSegmentDuration: '4s',
        recordDeleteAfter: '0s',
      }
    : { record: false };
  try {
    try {
      await mediamtxClient.addPath(pathName, { source: 'publisher' });
    } catch (err) {
      // Path already exists or is not configured yet: continue to patch it.
      if (!(err?.statusCode && [400, 404, 409, 422].includes(err.statusCode))) throw err;
    }
    await mediamtxClient.patchPath(pathName, config);
    return true;
  } catch (err) {
    logger.warn(`[recording] MediaMTX recording ${enabled ? 'start' : 'stop'} failed for ${pathName}: ${err?.message}`);
    return false;
  }
}

function listFiles(root, dir = root, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) listFiles(root, full, out);
    else if (entry.isFile()) out.push({ full, rel: slash(relative(root, full)), size: statSync(full).size });
  }
  return out;
}

/** MediaMTX segment files (`*.mp4`) in time order. Names start with the UTC timestamp. */
export function listRecordedSegments(dir) {
  return listFiles(dir)
    .filter((f) => f.rel.endsWith('.mp4') && f.rel !== 'recording.mp4' && f.size > 0)
    .sort((a, b) => a.rel.split('/').pop().localeCompare(b.rel.split('/').pop()) || a.rel.localeCompare(b.rel));
}

async function waitForStable(dir, { settleMs, maxWaitMs }) {
  const snap = () => listFiles(dir).map((f) => `${f.rel}:${f.size}`).sort().join('|');
  let previous = snap();
  const deadline = Date.now() + maxWaitMs;
  while (settleMs > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, settleMs));
    const current = snap();
    if (current === previous) return;
    previous = current;
  }
}

function runFfmpeg(args, purpose) {
  return new Promise((resolve, reject) => {
    const proc = spawnFfmpeg(args, { purpose, runner: 'spawn', stdio: ['ignore', 'ignore', 'pipe'] });
    let tail = '';
    proc.stderr?.on('data', (d) => { tail = (tail + d).slice(-2000); });
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${tail.trim().split('\n').slice(-3).join(' | ')}`))));
  });
}

/** ffmpeg concat-demuxer list file contents; single quotes in paths are escaped. */
export function concatListText(paths) {
  return paths.map((p) => `file '${slash(p).replace(/'/g, "'\\''")}'`).join('\n') + '\n';
}

/**
 * Turn what MediaMTX wrote (many fMP4 segment files) into a playable VOD: a real HLS
 * `playlist.m3u8` with `.ts` segments, stream-copied (no re-encode). Removes the raw segments on
 * success. Returns true when a playlist was made.
 */
export async function buildHlsFromSegments(dir, { hlsSeconds = 6 } = {}) {
  const segments = listRecordedSegments(dir);
  if (segments.length === 0) return false;
  const listPath = join(dir, 'concat.txt');
  writeFileSync(listPath, concatListText(segments.map((s) => s.full)));
  try {
    await runFfmpeg([
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'concat', '-safe', '0', '-i', listPath,
      '-c', 'copy',
      '-f', 'hls', '-hls_time', String(hlsSeconds), '-hls_playlist_type', 'vod',
      '-hls_segment_filename', join(dir, 'segment%05d.ts'),
      join(dir, 'playlist.m3u8'),
    ], 'record-finalize');
  } finally {
    rmSync(listPath, { force: true });
  }
  for (const s of segments) rmSync(s.full, { force: true });
  return existsSync(join(dir, 'playlist.m3u8'));
}

/**
 * After MediaMTX stopped recording: wait for the last segment, build the HLS VOD, upload it to
 * S3 when the video is stored there, and mark the video `completed` (or `failed` when nothing was
 * recorded). Never throws.
 */
export async function finalizeVideoRecording(db, apiKey, videoId, {
  recordingsStore = null,
  settleMs = 1000,
  maxWaitMs = 30000,
} = {}) {
  try {
    const video = await getVideo(db, apiKey, videoId);
    if (!video) return { ok: false, error: 'Video not found' };
    const dir = getVideoStorageDir(apiKey, videoId);
    await waitForStable(dir, { settleMs, maxWaitMs });
    const made = await buildHlsFromSegments(dir);
    if (!made) {
      logger.warn(`[recording] no recorded segments for video ${videoId}`);
      await updateVideo(db, apiKey, videoId, { status: 'failed' });
      return { ok: false, error: 'No recorded segments' };
    }
    const localBytes = listFiles(dir).reduce((sum, f) => sum + f.size, 0);
    await updateVideo(db, apiKey, videoId, { status: 'completed', sizeBytes: localBytes });
    await syncVideoRecordingToStorage(db, apiKey, videoId, { recordingsStore, settleMs: 0 });
    return { ok: true };
  } catch (err) {
    logger.warn(`[recording] finalize failed (videoId=${videoId}): ${err?.message}`);
    try { await updateVideo(db, apiKey, videoId, { status: 'failed' }); } catch { /* best effort */ }
    return { ok: false, error: err?.message };
  }
}
