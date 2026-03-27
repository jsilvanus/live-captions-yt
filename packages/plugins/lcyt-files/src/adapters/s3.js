/**
 * S3-compatible storage adapter for caption files.
 *
 * Uses @aws-sdk/client-s3 and @aws-sdk/lib-storage for multipart uploads.
 * The upload is started when openAppend() is called and completed when close() is called.
 * This matches the session lifecycle: a file handle is opened once per session and
 * closed when the session ends.
 *
 * Works with AWS S3, Cloudflare R2, MinIO, Backblaze B2, and any S3-compatible endpoint.
 *
 * Imported dynamically so the AWS SDK is only required when FILE_STORAGE=s3.
 */

import { PassThrough } from 'node:stream';

/**
 * Create an S3 storage adapter.
 *
 * @param {{
 *   bucket: string,
 *   prefix?: string,
 *   region?: string,
 *   endpoint?: string,
 *   credentials?: { accessKeyId: string, secretAccessKey: string }
 * }} opts
 * @returns {Promise<import('./types.js').StorageAdapter>}
 */
export async function createS3Adapter({ bucket, prefix = 'captions', region = 'auto', endpoint, credentials }) {
  const { S3Client, GetObjectCommand, DeleteObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const { Upload } = await import('@aws-sdk/lib-storage');

  const clientConfig = { region };
  if (endpoint) {
    clientConfig.endpoint = endpoint;
    clientConfig.forcePathStyle = true;
  }
  if (credentials) {
    clientConfig.credentials = credentials;
  }
  const client = new S3Client(clientConfig);

  /**
   * Compute the per-key S3 key prefix.
   * @param {string} apiKey
   * @returns {string}
   */
  function keyDir(apiKey) {
    const safe = apiKey.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 40);
    return `${prefix}/${safe}`;
  }

  /**
   * Open an append-mode write handle backed by S3 multipart upload.
   * The upload streams data as it is written; close() completes the upload.
   *
   * @param {string} apiKey
   * @param {string} filename
   * @returns {import('./types.js').AppendHandle}
   */
  function openAppend(apiKey, filename) {
    const objectKey = `${keyDir(apiKey)}/${filename}`;
    const pass = new PassThrough();
    let totalBytes = 0;

    const upload = new Upload({
      client,
      params: { Bucket: bucket, Key: objectKey, Body: pass, ContentType: 'text/plain' },
    });

    // Track the upload promise so close() can await it
    const uploadDone = upload.done();

    return {
      /** The S3 object key — stored as `filename` in DB for S3 adapter. */
      storedKey: objectKey,

      write(chunk) {
        const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        totalBytes += buf.byteLength;
        return new Promise((resolve, reject) => {
          pass.write(buf, err => (err ? reject(err) : resolve()));
        });
      },

      async close() {
        pass.end();
        await uploadDone;
      },

      sizeBytes() {
        return totalBytes;
      },
    };
  }

  /**
   * Open a read stream from S3 for download.
   *
   * @param {string} _apiKey
   * @param {string} storedKey  S3 object key as stored in DB
   * @param {string} format
   * @returns {Promise<{ stream: Readable, contentType: string, size: number|null }>}
   */
  async function openRead(_apiKey, storedKey, format) {
    const contentType = format === 'vtt' ? 'text/vtt' : 'text/plain';
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: storedKey }));
    return {
      stream: res.Body,
      contentType: res.ContentType || contentType,
      size: res.ContentLength ?? null,
    };
  }

  /**
   * Delete an S3 object.
   *
   * @param {string} _apiKey
   * @param {string} storedKey
   */
  async function deleteFile(_apiKey, storedKey) {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: storedKey })).catch(() => {});
  }

  // ── Future HLS / live-stream use ────────────────────────────────────────────
  // putObject() and publicUrl() share the same credentials and bucket as caption
  // files and are intended for HLS segment/playlist publishing.  Each call is a
  // single PutObject request (overwrite semantics), which is what HLS needs:
  // playlists are rewritten every few seconds under the same key, and segments
  // are written once and then deleted when they fall outside the rolling window.
  //
  // CDN note: publicUrl() returns the direct S3/endpoint URL.  In production you
  // will typically put a CDN (CloudFront, Cloudflare, BunnyCDN) in front and
  // rewrite the host portion to the CDN domain.  The HLS manager is responsible
  // for that substitution — this method just returns what the adapter knows.
  // For R2 + Cloudflare CDN, the public custom domain is configured separately
  // and is not the same as the R2 API endpoint stored here.

  /**
   * Write or overwrite a discrete S3 object (HLS segment, playlist, thumbnail, …).
   *
   * Uses PutObject (single request, not multipart) because segments are small
   * enough and overwrite semantics are required.  For large objects use
   * openAppend() + close() which uses multipart upload.
   *
   * objectKey may contain path separators (e.g. 'hls/segment-001.ts').
   *
   * @param {string} apiKey
   * @param {string} objectKey  Relative key within the per-key prefix
   * @param {Buffer|string} buffer
   * @param {string} [contentType]  e.g. 'application/x-mpegURL', 'video/MP2T'
   * @returns {Promise<{ storedKey: string }>}
   */
  async function putObject(apiKey, objectKey, buffer, contentType = 'application/octet-stream') {
    const fullKey = `${keyDir(apiKey)}/${objectKey}`;
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: fullKey,
      Body: buffer,
      ContentType: contentType,
    }));
    return { storedKey: fullKey };
  }

  /**
   * Return the public HTTP URL for an S3 object.
   *
   * For standard AWS S3 this is the virtual-hosted bucket URL.
   * For custom endpoints (R2, MinIO, Backblaze B2) it is path-style using the
   * configured endpoint as the base.
   *
   * If you have a CDN in front of S3, swap the origin for the CDN domain at the
   * HLS manager level — this method returns the origin (S3) URL only.
   *
   * @param {string} apiKey
   * @param {string} objectKey
   * @returns {string}
   */
  function publicUrl(apiKey, objectKey) {
    const fullKey = `${keyDir(apiKey)}/${objectKey}`;
    if (endpoint) {
      // Custom endpoint (R2, MinIO, Backblaze B2) — always path style
      return `${endpoint.replace(/\/$/, '')}/${bucket}/${fullKey}`;
    }
    // Standard AWS: virtual-hosted style
    const r = region === 'auto' ? 'us-east-1' : region;
    return `https://${bucket}.s3.${r}.amazonaws.com/${fullKey}`;
  }

  /** Human-readable description for startup log. */
  function describe() {
    const ep = endpoint ? `, endpoint: ${endpoint}` : '';
    return `✓ File storage: S3 (bucket: ${bucket}, prefix: ${prefix}${ep})`;
  }

  return { keyDir, openAppend, openRead, deleteFile, putObject, publicUrl, describe };
}
