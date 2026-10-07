import { resolve } from 'node:path';
import { createLocalObjectStore } from './local.js';
import { createS3ObjectStore } from './s3.js';

export { createLocalObjectStore, createS3ObjectStore };

export async function createObjectStoreFromEnv({
  settings = null,
  localBaseDir,
  s3Prefix = '',
} = {}) {
  const mode = settings ? settings.get('storage.file_storage') : (process.env.FILE_STORAGE || 'local');
  if (mode === 's3') {
    const bucket = settings ? settings.get('storage.s3_bucket') : process.env.S3_BUCKET;
    if (!bucket) throw new Error('S3_BUCKET must be set when FILE_STORAGE=s3');
    const region = (settings ? settings.get('storage.s3_region') : process.env.S3_REGION) || 'auto';
    const endpoint = (settings ? settings.get('storage.s3_endpoint') : process.env.S3_ENDPOINT) || undefined;
    const accessKeyId = settings ? settings.get('storage.s3_access_key_id') : process.env.S3_ACCESS_KEY_ID;
    const credentials = accessKeyId ? {
      accessKeyId,
      secretAccessKey: (settings ? settings.get('storage.s3_secret_access_key') : process.env.S3_SECRET_ACCESS_KEY) || '',
    } : undefined;
    return createS3ObjectStore({
      bucket,
      region,
      endpoint,
      credentials,
      prefix: s3Prefix,
    });
  }

  if (!localBaseDir) throw new Error('localBaseDir is required when FILE_STORAGE=local');
  return createLocalObjectStore({ baseDir: resolve(localBaseDir) });
}
