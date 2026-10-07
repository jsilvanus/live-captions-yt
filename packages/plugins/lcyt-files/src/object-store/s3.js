import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { guessContentType, normalizeObjectKey } from './util.js';

export async function createS3ObjectStore({
  bucket,
  region = 'auto',
  endpoint,
  credentials,
  prefix = '',
}) {
  if (!bucket) throw new Error('bucket is required');

  const [
    {
      S3Client,
      PutObjectCommand,
      GetObjectCommand,
      HeadObjectCommand,
      DeleteObjectCommand,
      DeleteObjectsCommand,
      ListObjectsV2Command,
    },
    { Upload },
  ] = await Promise.all([
    import('@aws-sdk/client-s3'),
    import('@aws-sdk/lib-storage'),
  ]);

  const client = new S3Client({
    region,
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    ...(credentials ? { credentials } : {}),
  });

  function toStoredKey(key) {
    const normalized = normalizeObjectKey(key);
    const base = prefix ? `${normalizeObjectKey(prefix)}/` : '';
    return `${base}${normalized}`;
  }

  function fromStoredKey(storedKey) {
    if (!prefix) return storedKey;
    const normalizedPrefix = `${normalizeObjectKey(prefix)}/`;
    if (!storedKey.startsWith(normalizedPrefix)) return storedKey;
    return storedKey.slice(normalizedPrefix.length);
  }

  async function put(key, body, { contentType } = {}) {
    const normalizedKey = normalizeObjectKey(key);
    const storedKey = toStoredKey(normalizedKey);
    const upload = new Upload({
      client,
      params: {
        Bucket: bucket,
        Key: storedKey,
        Body: body,
        ContentType: contentType || guessContentType(normalizedKey),
      },
    });
    await upload.done();
    const meta = await statObject(normalizedKey);
    return meta;
  }

  async function putFile(key, localPath, meta = {}) {
    return put(key, createReadStream(localPath), meta);
  }

  async function statObject(key) {
    const normalizedKey = normalizeObjectKey(key);
    const storedKey = toStoredKey(normalizedKey);
    const res = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: storedKey }));
    return {
      key: normalizedKey,
      size: Number(res.ContentLength ?? 0),
      lastModified: res.LastModified ? res.LastModified.getTime() : 0,
      etag: res.ETag || null,
      contentType: res.ContentType || guessContentType(normalizedKey),
    };
  }

  async function exists(key) {
    try {
      await statObject(key);
      return true;
    } catch (err) {
      if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound' || err?.Code === 'NotFound') return false;
      throw err;
    }
  }

  async function stream(key, { range } = {}) {
    const normalizedKey = normalizeObjectKey(key);
    const storedKey = toStoredKey(normalizedKey);
    const res = await client.send(new GetObjectCommand({
      Bucket: bucket,
      Key: storedKey,
      ...(range ? { Range: range } : {}),
    }));
    return {
      stream: res.Body,
      size: Number(res.ContentLength ?? 0),
      contentType: res.ContentType || guessContentType(normalizedKey),
      etag: res.ETag || null,
      lastModified: res.LastModified ? res.LastModified.getTime() : 0,
      contentLength: Number(res.ContentLength ?? 0),
      contentRange: res.ContentRange || null,
    };
  }

  async function remove(key) {
    const storedKey = toStoredKey(key);
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: storedKey }));
  }

  async function deletePrefix(prefixValue) {
    const normalizedPrefix = normalizeObjectKey(prefixValue);
    let cursor = null;
    do {
      const page = await list(normalizedPrefix, { limit: 1000, cursor });
      cursor = page.nextCursor;
      if (page.items.length === 0) continue;
      const keys = page.items.map((item) => ({ Key: toStoredKey(item.key) }));
      await client.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: keys, Quiet: true },
      }));
    } while (cursor);
  }

  async function list(prefixValue = '', { limit = 1000, cursor = null } = {}) {
    const normalizedPrefix = prefixValue ? normalizeObjectKey(prefixValue) : '';
    const storedPrefix = normalizedPrefix ? toStoredKey(normalizedPrefix) : (prefix ? `${normalizeObjectKey(prefix)}/` : '');
    const res = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: storedPrefix,
      MaxKeys: limit,
      ...(cursor ? { ContinuationToken: cursor } : {}),
    }));

    const items = [];
    for (const obj of res.Contents || []) {
      if (!obj?.Key) continue;
      items.push({
        key: fromStoredKey(obj.Key),
        size: Number(obj.Size ?? 0),
        lastModified: obj.LastModified ? obj.LastModified.getTime() : 0,
        etag: obj.ETag || null,
        contentType: guessContentType(obj.Key),
      });
    }

    return { items, nextCursor: res.IsTruncated ? (res.NextContinuationToken || null) : null };
  }

  async function materialize(key, workDir) {
    const normalizedKey = normalizeObjectKey(key);
    const targetRoot = workDir || await mkdtemp(join(tmpdir(), 'lcyt-store-'));
    await mkdir(targetRoot, { recursive: true });
    const targetPath = join(targetRoot, `${randomUUID()}-${basename(normalizedKey)}`);
    const opened = await stream(normalizedKey);
    await pipeline(opened.stream, createWriteStream(targetPath));
    return targetPath;
  }

  return {
    type: 's3',
    put,
    putFile,
    stream,
    stat: statObject,
    exists,
    delete: remove,
    deletePrefix,
    list,
    materialize,
    close: () => client.destroy?.(),
  };
}
