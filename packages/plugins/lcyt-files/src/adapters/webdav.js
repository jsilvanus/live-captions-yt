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

  // ── Enumeration ─────────────────────────────────────────────────────────────

  /**
   * List all objects stored under a key's WebDAV directory.
   *
   * Returns an async iterable of `{ objectKey, storedKey, size, lastModified }` where:
   *   - `objectKey`  — path relative to the key's directory (suitable for putObject)
   *   - `storedKey`  — full WebDAV path as used by deleteFile
   *   - `size`       — file size in bytes
   *   - `lastModified` — Unix epoch milliseconds
   *
   * @param {string} apiKey
   * @param {string} [prefix]  Optional sub-path to restrict the listing
   * @returns {AsyncIterable<{ objectKey: string, storedKey: string, size: number, lastModified: number }>}
   */
  async function* listObjects(apiKey, prefix = '') {
    const dir = keyDir(apiKey);                          // e.g. 'captions/mykey'
    const remotePath = prefix ? `${dir}/${prefix}` : dir;

    let contents;
    try {
      contents = await client.getDirectoryContents(remotePath, { deep: true });
    } catch {
      return; // Directory doesn't exist — nothing to list
    }

    const items = Array.isArray(contents) ? contents : (contents?.data ?? []);
    // Build the prefix used to strip the key dir from filenames.
    // WebDAV servers may return filenames with a leading slash (e.g. '/captions/mykey/file.vtt')
    // while keyDir() returns a path without a leading slash (e.g. 'captions/mykey').
    // Normalise by removing the leading slash so both sides match consistently.
    const dirSlash = dir.replace(/^\//, '') + '/';      // e.g. 'captions/mykey/'

    for (const item of items) {
      if (item.type !== 'file') continue;

      // Normalise the filename (remove leading slash if present)
      const normalizedFilename = item.filename.startsWith('/')
        ? item.filename.slice(1)
        : item.filename;

      // storedKey is what deleteFile and putObject expect (no leading slash)
      const storedKey = normalizedFilename;

      // objectKey is the path relative to the key dir
      const objectKey = normalizedFilename.startsWith(dirSlash)
        ? normalizedFilename.slice(dirSlash.length)
        : normalizedFilename;

      yield {
        objectKey,
        storedKey,
        size: item.size ?? 0,
        lastModified: item.lastmod ? new Date(item.lastmod).getTime() : 0,
      };
    }
  }

  function describe() {
    const auth = username ? `, user: ${username}` : '';
    return `✓ File storage: WebDAV (url: ${url}, prefix: ${prefix}${auth})`;
  }

  return { keyDir, openAppend, openRead, deleteFile, putObject, publicUrl, listObjects, describe };
}
