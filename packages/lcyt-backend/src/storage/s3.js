import { readdir, readFile } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';

export function isS3Enabled() {
  return !!(process.env.S3_ENDPOINT && process.env.S3_BUCKET);
}

function sanitizeS3KeyPath(keyPath) {
  const normalized = String(keyPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = normalized.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error('Invalid S3 object key');
  }
  return segments.map((segment) => segment.replace(/[^A-Za-z0-9._-]/g, '-')).join('/');
}

export function buildS3Url(keyPath) {
  const endpoint = process.env.S3_ENDPOINT || '';
  const bucket = process.env.S3_BUCKET || '';
  if (!endpoint || !bucket) throw new Error('S3 not configured');
  const kp = sanitizeS3KeyPath(keyPath);
  return `${endpoint.replace(/\/$/, '')}/${bucket}/${kp}`;
}

const CONTENT_TYPES = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.mp4': 'video/mp4',
  '.m4s': 'video/iso.segment',
  '.m4a': 'audio/mp4',
};

function guessContentType(filePath) {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream';
}

async function walkFiles(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(fullPath, base));
    } else if (entry.isFile()) {
      files.push({ fullPath, relativePath: relative(base, fullPath).split('\\').join('/') });
    }
  }
  return files;
}

async function createS3Client() {
  const { S3Client } = await import('@aws-sdk/client-s3');
  const region = process.env.S3_REGION || 'auto';
  const endpoint = process.env.S3_ENDPOINT;
  const credentials = process.env.S3_ACCESS_KEY_ID ? {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
  } : undefined;
  return new S3Client({
    region,
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    ...(credentials ? { credentials } : {}),
  });
}

/**
 * Recursively upload every file under `localDir` to S3, keyed as
 * `${storageKeyPrefix}/<relative path>` — the same layout `buildS3Url`
 * expects on read (see `routes/videos.js`'s `streamVideoAsset`).
 *
 * Reads `S3_*` env vars fresh on every call (not cached) since the recording
 * lifecycle spans hours and config could plausibly change between calls.
 *
 * @param {string} localDir
 * @param {string} storageKeyPrefix
 * @returns {Promise<{ fileCount: number, totalBytes: number }>}
 */
export async function uploadDirectoryToS3(localDir, storageKeyPrefix) {
  if (!isS3Enabled()) throw new Error('S3 not configured');
  const bucket = process.env.S3_BUCKET;
  const [{ PutObjectCommand }, client, files] = await Promise.all([
    import('@aws-sdk/client-s3'),
    createS3Client(),
    walkFiles(localDir),
  ]);

  const UPLOAD_CONCURRENCY = 8;
  let totalBytes = 0;
  let cursor = 0;
  async function uploadNext() {
    while (cursor < files.length) {
      const { fullPath, relativePath } = files[cursor++];
      const body = await readFile(fullPath);
      const key = sanitizeS3KeyPath(`${storageKeyPrefix}/${relativePath}`);
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: guessContentType(fullPath),
      }));
      totalBytes += body.byteLength;
    }
  }
  await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, files.length) }, uploadNext));
  return { fileCount: files.length, totalBytes };
}

export default { isS3Enabled, buildS3Url, uploadDirectoryToS3 };
