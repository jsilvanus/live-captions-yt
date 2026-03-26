/**
 * Storage adapter factory.
 *
 * Reads FILE_STORAGE env var and returns the appropriate adapter:
 *   local (default) — writes to FILES_DIR on the local filesystem
 *   s3              — writes to an S3-compatible bucket
 */

import { resolve } from 'node:path';

/**
 * Create and return a storage adapter based on environment configuration.
 *
 * @returns {Promise<import('./adapters/types.js').StorageAdapter>}
 */
export async function createStorageAdapter() {
  const mode = process.env.FILE_STORAGE || 'local';

  if (mode === 's3') {
    const bucket = process.env.S3_BUCKET;
    if (!bucket) throw new Error('S3_BUCKET must be set when FILE_STORAGE=s3');

    const region   = process.env.S3_REGION    || 'auto';
    const endpoint = process.env.S3_ENDPOINT  || undefined;
    const prefix   = process.env.S3_PREFIX    || 'captions';
    const credentials = process.env.S3_ACCESS_KEY_ID ? {
      accessKeyId:     process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
    } : undefined;

    const { createS3Adapter } = await import('./adapters/s3.js');
    return createS3Adapter({ bucket, prefix, region, endpoint, credentials });
  }

  // Default: local filesystem
  const baseDir = resolve(process.env.FILES_DIR || '/data/files');
  const { createLocalAdapter } = await import('./adapters/local.js');
  return createLocalAdapter(baseDir);
}
