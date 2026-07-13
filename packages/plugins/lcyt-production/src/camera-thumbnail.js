/**
 * Camera thumbnail capture — grabs a still-frame JPEG for a camera's "picture"
 * and persists it to disk + a DB timestamp, so an operator can see what a
 * camera is pointed at without a live feed open.
 *
 * Two capture paths, depending on the camera's control type:
 *
 *   Path A — independent feed (webcam/mobile, camera.cameraKey set):
 *     fetches the camera's own MediaMTX preview directly.
 *
 *   Path B — program-feed capture (amx/visca-ip, no cameraKey):
 *     these cameras have no video path of their own — AMX/VISCA-IP are pure
 *     PTZ control protocols. The only feed ever available for them is the
 *     mixer's program output, and only while this camera is the mixer's
 *     currently active source. Caller must supply apiKey (the project's RTMP
 *     ingest key); liveness is checked via the DeviceRegistry before saving.
 *
 * Both paths fetch from the backend's already-public preview-JPEG endpoint
 * (`GET /preview/:key/incoming`, PreviewManager in lcyt-rtmp) over plain HTTP
 * — deliberately, not an in-process import of PreviewManager/MediaMtxClient,
 * same reasoning as lcyt-agent's VisionFrameFetcher (avoids new cross-plugin
 * coupling; this plugin's own MediaMtxClient copy has no getThumbnail method
 * at all). Requires RTMP_RELAY_ACTIVE=1 on this backend (that's what mounts
 * /preview) — without it every capture attempt fails with the same 409 a
 * genuinely-offline camera would produce.
 */

import * as fs from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

export const DEFAULT_THUMBNAILS_DIR = resolve(process.env.CAMERA_THUMBNAILS_DIR || '/data/camera-thumbnails');
export const DEFAULT_PREVIEW_BASE_URL = process.env.CAMERA_PREVIEW_BASE_URL
  || `http://localhost:${process.env.PORT || 3000}`;

/**
 * @param {string} cameraId
 * @param {string} [thumbnailsDir]
 * @returns {string} absolute path to the camera's stored thumbnail file
 */
export function thumbnailPath(cameraId, thumbnailsDir = DEFAULT_THUMBNAILS_DIR) {
  return join(thumbnailsDir, `${cameraId}.jpg`);
}

/**
 * Fetch a JPEG from the backend's public preview endpoint for the given key
 * (a camera_key or a project apiKey — the endpoint doesn't distinguish).
 *
 * @param {string} previewBaseUrl
 * @param {string} key
 * @returns {Promise<{ ok: true, buffer: Buffer } | { ok: false, error: string, status: number }>}
 */
async function fetchPreviewJpeg(previewBaseUrl, key) {
  const url = `${previewBaseUrl.replace(/\/$/, '')}/preview/${encodeURIComponent(key)}/incoming`;
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    return { ok: false, error: `Preview fetch failed: ${err.message}`, status: 502 };
  }
  if (res.status === 404) {
    return {
      ok: false,
      status: 409,
      error: 'No live preview available (not currently publishing, or RTMP_RELAY_ACTIVE is not set on this backend)',
    };
  }
  if (!res.ok) {
    return { ok: false, error: `Preview fetch failed: HTTP ${res.status}`, status: 502 };
  }
  return { ok: true, buffer: Buffer.from(await res.arrayBuffer()) };
}

/**
 * Atomically write a thumbnail buffer to disk for a camera.
 * @param {string} cameraId
 * @param {Buffer} buffer
 * @param {string} thumbnailsDir
 * @returns {{ ok: true } | { ok: false, error: string, status: number }}
 */
function writeThumbnailFile(cameraId, buffer, thumbnailsDir) {
  try {
    fs.mkdirSync(thumbnailsDir, { recursive: true });
  } catch (err) {
    return { ok: false, error: `Could not create thumbnails directory: ${err.message}`, status: 500 };
  }

  const finalPath = thumbnailPath(cameraId, thumbnailsDir);
  const tmpPath = join(thumbnailsDir, `.${cameraId}-${randomBytes(6).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(tmpPath, buffer);
    fs.renameSync(tmpPath, finalPath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    return { ok: false, error: `Could not write thumbnail file: ${err.message}`, status: 500 };
  }
  return { ok: true };
}

/**
 * Capture a still-frame thumbnail for a camera and persist it.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ id: string, cameraKey: string|null, mixerInput: number|null }} camera  parsed camera row
 * @param {import('./registry.js').DeviceRegistry} registry
 * @param {{ apiKey?: string, mixerId?: string, thumbnailsDir?: string, previewBaseUrl?: string }} [opts]
 * @returns {Promise<{ ok: true, thumbnailCapturedAt: string, sizeBytes: number }
 *                  | { ok: false, error: string, status: number }>}
 */
export async function captureCameraThumbnail(db, camera, registry, opts = {}) {
  const thumbnailsDir = opts.thumbnailsDir ?? DEFAULT_THUMBNAILS_DIR;
  const previewBaseUrl = opts.previewBaseUrl ?? DEFAULT_PREVIEW_BASE_URL;

  let fetchResult;

  if (camera.cameraKey) {
    // Path A — independent feed (webcam/mobile)
    fetchResult = await fetchPreviewJpeg(previewBaseUrl, camera.cameraKey);
  } else {
    // Path B — program-feed capture (amx/visca-ip, no independent feed)
    if (!opts.apiKey) {
      return {
        ok: false,
        status: 400,
        error: 'Camera has no camera_key; pass apiKey to capture from the current program feed instead',
      };
    }
    if (camera.mixerInput == null) {
      return {
        ok: false,
        status: 400,
        error: 'Camera has no mixer_input assigned — cannot determine when it is live on program',
      };
    }

    let mixerId = opts.mixerId ?? null;
    if (!mixerId) {
      const mixers = db.prepare('SELECT id FROM prod_mixers').all();
      if (mixers.length !== 1) {
        return {
          ok: false,
          status: 400,
          error: mixers.length === 0
            ? 'No mixer is configured — cannot determine program-feed liveness'
            : 'Multiple mixers are configured — pass mixerId to disambiguate',
        };
      }
      mixerId = mixers[0].id;
    }

    const activeSource = registry.getActiveSource(mixerId);
    if (activeSource !== camera.mixerInput) {
      return {
        ok: false,
        status: 409,
        error: 'Camera is not currently the active mixer source — switch to it before capturing',
      };
    }

    fetchResult = await fetchPreviewJpeg(previewBaseUrl, opts.apiKey);
  }

  if (!fetchResult.ok) return fetchResult;

  const writeResult = writeThumbnailFile(camera.id, fetchResult.buffer, thumbnailsDir);
  if (!writeResult.ok) return writeResult;

  const thumbnailCapturedAt = new Date().toISOString();
  db.prepare('UPDATE prod_cameras SET thumbnail_captured_at = ? WHERE id = ?').run(thumbnailCapturedAt, camera.id);

  return { ok: true, thumbnailCapturedAt, sizeBytes: fetchResult.buffer.length };
}

/**
 * Best-effort delete of a camera's thumbnail file. Never throws.
 * @param {string} cameraId
 * @param {string} [thumbnailsDir]
 */
export function deleteCameraThumbnailFile(cameraId, thumbnailsDir = DEFAULT_THUMBNAILS_DIR) {
  try {
    const p = thumbnailPath(cameraId, thumbnailsDir);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch { /* ignore, matches lcyt-dsk images.js's delete-route precedent */ }
}
