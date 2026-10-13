import { existsSync, readdirSync, statSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFile } from 'node:child_process';
import { spawnFfmpeg } from 'lcyt-compute/ffmpeg';
import logger from 'lcyt/logger';
import { getVideoStorageDir, getVideosStorageRoot, getVideo, updateVideo, deleteVideo, syncVideoRecordingToStorage } from '../db/videos.js';
import { getVideoFeed, updateVideoFeedMeta } from '../db/video-feeds.js';

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


/** Duration of a media file in ms (ffprobe), or null when it cannot be read. */
export function probeDurationMs(file) {
  return new Promise((resolve) => {
    execFile('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { timeout: 30000 }, (err, stdout) => {
      const sec = Number(String(stdout).trim());
      resolve(err || !Number.isFinite(sec) ? null : Math.round(sec * 1000));
    });
  });
}

/** Width, height and frame rate of the first video stream, or null. */
export function probeVideo(file) {
  return new Promise((resolve) => {
    execFile('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate', '-of', 'json', file], { timeout: 30000 }, (err, stdout) => {
      if (err) return resolve(null);
      try {
        const st = JSON.parse(stdout).streams?.[0];
        if (!st) return resolve(null);
        const [n, d] = String(st.r_frame_rate || '0/1').split('/').map(Number);
        resolve({ width: st.width, height: st.height, fps: d ? Math.round((n / d) * 100) / 100 : null });
      } catch { resolve(null); }
    });
  });
}

/** Run ffmpeg to completion (local, stream copy jobs). */
export { runFfmpeg };

/**
 * Start time (epoch ms) in a MediaMTX segment name `2026-10-12_08-00-04-123456.mp4`. MediaMTX names
 * segments by their start time; whether that is UTC or local time is set with MEDIAMTX_RECORD_TZ
 * (`utc` default, or `local`). Only differences between segments are used, so a wrong choice
 * shifts every feed alike.
 */
export function segmentWallMs(name, tz = process.env.MEDIAMTX_RECORD_TZ || 'utc') {
  const m = /(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})(?:-(\d{1,6}))?/.exec(String(name).split('/').pop());
  if (!m) return null;
  const [, y, mo, d, h, mi, se, us = '0'] = m;
  const ms = Math.floor(Number(us.padEnd(6, '0')) / 1000);
  const parts = [Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se), ms];
  return tz === 'local' ? new Date(...parts).getTime() : Date.UTC(...parts);
}

/**
 * Split time-ordered segments into continuous parts. A gap (the encoder dropped and came back)
 * starts a new part; without it the playback timeline would silently close the gap.
 * `segments`: [{ wallMs, durationMs }]. Returns parts with `startMs` (real time since the first
 * segment) and `playlistStartMs` (position inside the gap-collapsed HLS VOD).
 */
export function groupParts(segments, { toleranceMs = 2000 } = {}) {
  const parts = [];
  if (segments.length === 0) return parts;
  const origin = segments[0].wallMs;
  let playlistMs = 0;
  let current = null;
  let expectedNext = null;
  for (const seg of segments) {
    const dur = seg.durationMs ?? 0;
    if (!current || seg.wallMs == null || expectedNext == null || Math.abs(seg.wallMs - expectedNext) > toleranceMs) {
      current = { startMs: seg.wallMs == null ? playlistMs : seg.wallMs - origin, playlistStartMs: playlistMs, durationMs: 0, segments: 0 };
      parts.push(current);
    }
    current.durationMs += dur;
    current.segments += 1;
    playlistMs += dur;
    expectedNext = seg.wallMs == null ? null : seg.wallMs + dur;
  }
  return parts;
}

/** Segment list with duration and start time, ready for `groupParts`. */
export async function analyzeSegments(dir) {
  const segments = listRecordedSegments(dir);
  const out = [];
  for (const s of segments) {
    out.push({ ...s, wallMs: segmentWallMs(s.rel), durationMs: await probeDurationMs(s.full) });
  }
  return out;
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
 * After MediaMTX stopped recording: wait for the last segment, work out the continuous parts,
 * build the HLS VOD, upload it to S3 when the video is stored there, and mark the video
 * `completed`. A clean feed with nothing recorded is `failed`; a program or dsk feed with nothing
 * recorded is normal (no DSK that day) and its rows are removed. Never throws.
 */
export async function finalizeVideoRecording(db, apiKey, videoId, {
  recordingsStore = null,
  settleMs = 1000,
  maxWaitMs = 30000,
} = {}) {
  try {
    const video = await getVideo(db, apiKey, videoId);
    if (!video) return { ok: false, error: 'Video not found' };
    const feed = await getVideoFeed(db, videoId);
    const dir = getVideoStorageDir(apiKey, videoId);
    await waitForStable(dir, { settleMs, maxWaitMs });
    const analyzed = await analyzeSegments(dir);
    const made = analyzed.length > 0 && await buildHlsFromSegments(dir);
    if (!made) {
      if (feed && feed.role !== 'clean') {
        await deleteVideo(db, apiKey, videoId, { recordingsStore });
        return { ok: true, empty: true };
      }
      logger.warn(`[recording] no recorded segments for video ${videoId}`);
      await updateVideo(db, apiKey, videoId, { status: 'failed' });
      return { ok: false, error: 'No recorded segments' };
    }
    const parts = groupParts(analyzed);
    const durationMs = analyzed.reduce((sum, s) => sum + (s.durationMs ?? 0), 0);
    if (feed) {
      await updateVideoFeedMeta(db, videoId, { parts, firstSegmentWallMs: analyzed[0].wallMs, durationMs });
    }
    const localBytes = listFiles(dir).reduce((sum, f) => sum + f.size, 0);
    await updateVideo(db, apiKey, videoId, { status: 'completed', sizeBytes: localBytes, ...(durationMs > 0 ? { durationMs } : {}) });
    await syncVideoRecordingToStorage(db, apiKey, videoId, { recordingsStore, settleMs: 0 });
    return { ok: true, parts };
  } catch (err) {
    logger.warn(`[recording] finalize failed (videoId=${videoId}): ${err?.message}`);
    try { await updateVideo(db, apiKey, videoId, { status: 'failed' }); } catch { /* best effort */ }
    return { ok: false, error: err?.message };
  }
}
