import fs from 'fs';
import path from 'path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import mime from 'mime';

function buildClient() {
  const endpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION || 'us-east-1';
  const accessKey = process.env.S3_ACCESS_KEY;
  const secret = process.env.S3_SECRET_KEY;
  if (!endpoint || !accessKey || !secret || !process.env.S3_BUCKET) {
    return null;
  }
  const client = new S3Client({
    region,
    endpoint,
    credentials: { accessKeyId: accessKey, secretAccessKey: secret },
    forcePathStyle: true
  });
  return client;
}

export function createS3UploadFn({ bucket = process.env.S3_BUCKET, maxRetries = 3, baseKey = '' } = {}) {
  const client = buildClient();
  if (!client) {
    return async (localPath, remotePath) => {
      console.warn('S3 not configured; skipping upload for', remotePath);
      return { skipped: true };
    };
  }

  return async function upload(localPath, remotePath) {
    const key = baseKey ? `${baseKey.replace(/\/$/, '')}/${remotePath.replace(/^\/+/, '')}` : remotePath.replace(/^\/+/, '');
    const contentType = mime.getType(localPath) || 'application/octet-stream';
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
