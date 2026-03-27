/**
 * Local filesystem storage adapter for caption files.
 *
 * Wraps Node.js fs WriteStream (append mode) behind the common adapter interface
 * so the same write/read/delete path works for both local and S3 deployments.
 */

import { createWriteStream, createReadStream, mkdirSync, statSync, unlink, writeFile } from 'node:fs';
import { join, dirname } from 'node:path';
import { promisify } from 'node:util';

const unlinkAsync   = promisify(unlink);
const writeFileAsync = promisify(writeFile);

/**
 * Create a local filesystem storage adapter.
 *
 * @param {string} baseDir  Absolute path to the root files directory (e.g. /data/files)
 * @returns {import('./types.js').StorageAdapter}
 */
export function createLocalAdapter(baseDir) {
  /**
   * Compute a safe per-key subdirectory name and ensure it exists.
   * @param {string} apiKey
   * @returns {string} absolute path to the key's directory
   */
  function keyDir(apiKey) {
    const safe = apiKey.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 40);
    const dir = join(baseDir, safe);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  /**
   * Open an append-mode write handle for a new caption file.
   * Returns an object compatible with the AppendHandle interface.
   *
   * @param {string} apiKey
   * @param {string} filename  Bare filename (no directory component)
   * @returns {import('./types.js').AppendHandle}
   */
  function openAppend(apiKey, filename) {
    const dir = keyDir(apiKey);
    const filepath = join(dir, filename);
    const stream = createWriteStream(filepath, { flags: 'a' });

    return {
      /** The full filesystem path — used as `filename` stored in DB for local adapter. */
      storedKey: filepath,

      write(chunk) {
        return new Promise((resolve, reject) => {
          stream.write(chunk, err => (err ? reject(err) : resolve()));
        });
      },

      close() {
        return new Promise((resolve, reject) => {
          stream.end(err => (err ? reject(err) : resolve()));
        });
      },

      sizeBytes() {
        try { return statSync(filepath).size; } catch { return 0; }
      },
    };
  }

  /**
   * Open a read stream for download.
   *
   * @param {string} _apiKey  (unused for local adapter — path is in storedKey/filename)
   * @param {string} storedKey  Full filepath as stored in DB
   * @param {string} format  'vtt' | other
   * @returns {{ stream: import('node:fs').ReadStream, contentType: string, size: number|null }}
   */
  function openRead(_apiKey, storedKey, format) {
    const contentType = format === 'vtt' ? 'text/vtt' : 'text/plain';
    // statSync throws ENOENT for missing files — caught by the route handler which sends 404.
    // This prevents sending headers before discovering the file is absent.
    const { size } = statSync(storedKey);
    return { stream: createReadStream(storedKey), contentType, size };
  }

  /**
   * Delete a file.
   *
   * @param {string} _apiKey
   * @param {string} storedKey  Full filepath as stored in DB
   */
  async function deleteFile(_apiKey, storedKey) {
    await unlinkAsync(storedKey).catch(() => {});
  }

  // ── Future HLS / live-stream use ────────────────────────────────────────────
  // The two methods below are intentionally designed for HLS segment and playlist
  // publishing, where each write is a discrete object (overwrite semantics, not
  // append).  They share the same per-key directory layout as caption files so
  // all storage for a key lives under one prefix.  Example usage:
  //
  //   await storage.putObject(apiKey, 'hls/playlist.m3u8', playlistBuffer, 'application/x-mpegURL');
  //   await storage.putObject(apiKey, 'hls/segment-001.ts', segmentBuffer, 'video/MP2T');
  //   const url = storage.publicUrl(apiKey, 'hls/playlist.m3u8');
  //   // → null for local adapter (needs a static file server layer on top)

  /**
   * Write or overwrite a discrete object (HLS segment, playlist, thumbnail, …).
   *
   * Unlike openAppend(), this is a one-shot write with overwrite semantics —
   * ideal for HLS playlists (same key, new content every few seconds) and
   * individual segments.
   *
   * objectKey may contain path separators (e.g. 'hls/segment-001.ts').
   * Subdirectories are created automatically.
   *
   * @param {string} apiKey
   * @param {string} objectKey  Relative path within the key's directory
   * @param {Buffer|string} buffer
   * @param {string} [contentType]  Informational only for local adapter
   * @returns {Promise<{ storedKey: string }>}
   */
  async function putObject(apiKey, objectKey, buffer, _contentType) {
    const dir = keyDir(apiKey);
    const filepath = join(dir, objectKey);
    // Create any intermediate directories (e.g. the 'hls/' subdirectory)
    const subdir = dirname(filepath);
    if (subdir !== dir) mkdirSync(subdir, { recursive: true });
    await writeFileAsync(filepath, buffer);
    return { storedKey: filepath };
  }

  /**
   * Return the public HTTP URL for an object, or null if the adapter has no
   * built-in HTTP serving layer.
   *
   * For the local adapter this is always null — files live on the server's
   * filesystem and need an Express static-file route or nginx alias to be
   * reachable from browsers or HLS players.
   *
   * @param {string} _apiKey
   * @param {string} _objectKey
   * @returns {null}
   */
  function publicUrl(_apiKey, _objectKey) {
    return null;
  }

  /** Human-readable description for startup log. */
  function describe() {
    return `✓ File storage: local (dir: ${baseDir})`;
  }

  return { keyDir, openAppend, openRead, deleteFile, putObject, publicUrl, describe };
}
