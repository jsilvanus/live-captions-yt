import fs from 'fs';
import path from 'path';

// Lazy-loading S3 client and mime to avoid hard dependency at module import time
export function createS3UploadFn({ bucket = process.env.S3_BUCKET, maxRetries = 3, baseKey = '' } = {}) {
  let client = null;
  let PutObjectCommand = null;
  let mimeMod = null;

  async function ensureClient() {
    if (client) return true;
    const endpoint = process.env.S3_ENDPOINT;
    const region = process.env.S3_REGION || 'us-east-1';
    const accessKey = process.env.S3_ACCESS_KEY;
    const secret = process.env.S3_SECRET_KEY;
    if (!endpoint || !accessKey || !secret || !bucket) return false;
    try {
      const mod = await import('@aws-sdk/client-s3');
      const mm = await import('mime');
      const S3Client = mod.S3Client;
      PutObjectCommand = mod.PutObjectCommand;
      mimeMod = mm.default || mm;
      client = new S3Client({ region, endpoint, credentials: { accessKeyId: accessKey, secretAccessKey: secret }, forcePathStyle: true });
      return true;
    } catch (e) {
      console.warn('S3 SDK not available or failed to load:', e && e.message ? e.message : e);
      return false;
    }
  }

  return async function upload(localPath, remotePath) {
    const has = await ensureClient();
    if (!has) {
      console.warn('S3 not configured or SDK missing; skipping upload for', remotePath);
      return { skipped: true };
    }

    const key = baseKey ? `${baseKey.replace(/\/$/, '')}/${remotePath.replace(/^\/+/, '')}` : remotePath.replace(/^\/+/, '');
    const contentType = (mimeMod && mimeMod.getType) ? mimeMod.getType(localPath) || 'application/octet-stream' : 'application/octet-stream';

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const body = fs.createReadStream(localPath);
        const cmd = new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType });
        await client.send(cmd);
        return { ok: true, key };
      } catch (err) {
        const isLast = attempt === maxRetries;
        const backoff = Math.min(1000 * Math.pow(2, attempt), 10000);
        console.error(`S3 upload failed attempt=${attempt} key=${key} error=`, err && err.message ? err.message : err);
        if (isLast) throw err;
        await new Promise(r => setTimeout(r, backoff));
      }
    }
  };
}

export default createS3UploadFn;
