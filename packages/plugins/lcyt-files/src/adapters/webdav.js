/**
 * WebDAV storage adapter for caption files.
 *
 * Uses the `webdav` npm package (imported dynamically — only required when
 * a WebDAV config is active).
 *
 * WebDAV does not support native append, so openAppend() buffers all writes
 * in memory and performs a single PUT on close(). Caption files are small
 * text (a few KB), so this is fine.
 *
 * Tested with Nextcloud, ownCloud, Apache mod_dav, and nginx-dav-ext-module.
 */

export async function createWebDavAdapter({ url, prefix = 'captions', username, password }) {
  // Dynamic import so webdav package is not required when using local/S3
  const { createClient } = await import('webdav');

  // Build client config — credentials are optional (allow anonymous/token-auth servers)
  const clientConfig = {};
  if (username) {
    clientConfig.username = username;
    clientConfig.password = password || '';
  }
  const client = createClient(url, clientConfig);

  /**
   * Per-key path prefix (safe characters only).
   */
  function keyDir(apiKey) {
    const safe = apiKey.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 40);
    return `${prefix}/${safe}`;
  }

  /**
   * Ensure a remote directory path exists.
   * createDirectory with recursive:true is safe to call on existing dirs.
   */
  async function ensureDir(remotePath) {
    await client.createDirectory(remotePath, { recursive: true }).catch(() => {});
  }

  /**
   * Open an in-memory append handle.
   * All writes are buffered; close() performs a single PUT.
   */
  function openAppend(apiKey, filename) {
    const objectPath = `${keyDir(apiKey)}/${filename}`;
    const chunks = [];
    let totalBytes = 0;

    return {
      storedKey: objectPath,

      write(chunk) {
        const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        totalBytes += buf.byteLength;
        chunks.push(buf);
        return Promise.resolve();
      },

      async close() {
        const full = Buffer.concat(chunks);
        // Ensure parent directory exists before writing
        await ensureDir(keyDir(apiKey));
        await client.putFileContents(objectPath, full, { overwrite: true });
      },

      sizeBytes() {
        return totalBytes;
      },
    };
  }

  /**
   * Open a read stream from WebDAV for download.
   */
  async function openRead(_apiKey, storedKey, format) {
    const contentType = format === 'vtt' ? 'text/vtt' : 'text/plain';
    let size = null;
    try {
      const stat = await client.stat(storedKey);
      size = stat.size ?? null;
    } catch {
      // stat failed — size unknown, stream will still work
    }
    const stream = client.createReadStream(storedKey);
    return { stream, contentType, size };
  }

  /**
   * Delete a WebDAV resource.
   */
  async function deleteFile(_apiKey, storedKey) {
    await client.deleteFile(storedKey).catch(() => {});
  }

  /**
   * Write or overwrite a discrete object (HLS segment, playlist, thumbnail).
   */
  async function putObject(apiKey, objectKey, buffer, contentType = 'application/octet-stream') {
    const fullPath = `${keyDir(apiKey)}/${objectKey}`;
    // Ensure any intermediate directories exist
    const lastSlash = fullPath.lastIndexOf('/');
    if (lastSlash > 0) await ensureDir(fullPath.slice(0, lastSlash));
    await client.putFileContents(fullPath, buffer, { overwrite: true });
    return { storedKey: fullPath };
  }

  /**
   * WebDAV resources are served over HTTP, but typically require auth.
   * Returns null — the operator is responsible for setting up public access
   * or a reverse-proxy if HLS players need direct URL access.
   */
  function publicUrl(_apiKey, _objectKey) {
    return null;
  }

  function describe() {
    const auth = username ? `, user: ${username}` : '';
    return `✓ File storage: WebDAV (url: ${url}, prefix: ${prefix}${auth})`;
  }

  return { keyDir, openAppend, openRead, deleteFile, putObject, publicUrl, describe };
}
