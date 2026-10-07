import * as fs from 'node:fs';
import { mkdtemp, mkdir, readdir, rm, stat, unlink, copyFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { guessContentType, makeWeakEtag, normalizeObjectKey, parseRangeHeaderValue } from './util.js';

function resolveWithinBase(baseDir, key) {
  const normalizedKey = normalizeObjectKey(key);
  const root = resolve(baseDir);
  const fullPath = resolve(root, normalizedKey);
  const rel = relative(root, fullPath);
  if (rel.startsWith('..') || rel === '') throw new Error('Invalid object key');
  return { normalizedKey, fullPath, root };
}

async function* walkFiles(baseDir, currentDir = baseDir) {
  let entries;
  try {
    entries = await readdir(currentDir, { withFileTypes: true });
  } catch (err) {
    if (err?.code === 'ENOENT') return;
    throw err;
  }
  for (const entry of entries) {
    const fullPath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(baseDir, fullPath);
      continue;
    }
    if (!entry.isFile()) continue;
    const st = await stat(fullPath);
    yield { fullPath, size: st.size, lastModified: st.mtimeMs };
  }
}

function bodyToBuffer(body) {
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body);
  if (body instanceof Uint8Array) return Buffer.from(body);
  return null;
}

export function createLocalObjectStore({ baseDir }) {
  if (!baseDir || typeof baseDir !== 'string') throw new Error('baseDir is required');
  const root = resolve(baseDir);

  async function put(key, body, { contentType } = {}) {
    const { normalizedKey, fullPath } = resolveWithinBase(root, key);
    await mkdir(dirname(fullPath), { recursive: true });
    const inlineBuffer = bodyToBuffer(body);
    if (inlineBuffer) {
      await fs.promises.writeFile(fullPath, inlineBuffer);
    } else {
      const sourceStream = body?.pipe ? body : null;
      if (!sourceStream) throw new Error('body must be string, Buffer, Uint8Array, or stream');
      await pipeline(sourceStream, fs.createWriteStream(fullPath));
    }
    const st = await stat(fullPath);
    return {
      key: normalizedKey,
      size: st.size,
      lastModified: st.mtimeMs,
      etag: makeWeakEtag(st.size, st.mtimeMs),
      contentType: contentType || guessContentType(normalizedKey),
    };
  }

  async function putFile(key, localPath, meta = {}) {
    const { normalizedKey, fullPath } = resolveWithinBase(root, key);
    await mkdir(dirname(fullPath), { recursive: true });
    await copyFile(localPath, fullPath);
    const st = await stat(fullPath);
    return {
      key: normalizedKey,
      size: st.size,
      lastModified: st.mtimeMs,
      etag: makeWeakEtag(st.size, st.mtimeMs),
      contentType: meta.contentType || guessContentType(normalizedKey),
    };
  }

  async function statObject(key) {
    const { normalizedKey, fullPath } = resolveWithinBase(root, key);
    const st = await stat(fullPath);
    return {
      key: normalizedKey,
      size: st.size,
      lastModified: st.mtimeMs,
      etag: makeWeakEtag(st.size, st.mtimeMs),
      contentType: guessContentType(normalizedKey),
    };
  }

  async function exists(key) {
    try {
      await statObject(key);
      return true;
    } catch (err) {
      if (err?.code === 'ENOENT') return false;
      throw err;
    }
  }

  async function stream(key, { range } = {}) {
    const info = await statObject(key);
    const { fullPath } = resolveWithinBase(root, key);
    const requestedRange = parseRangeHeaderValue(range, info.size);
    if (!requestedRange) {
      return {
        stream: fs.createReadStream(fullPath),
        size: info.size,
        contentType: info.contentType,
        etag: info.etag,
        lastModified: info.lastModified,
        contentLength: info.size,
        contentRange: null,
      };
    }
    return {
      stream: fs.createReadStream(fullPath, { start: requestedRange.start, end: requestedRange.end }),
      size: info.size,
      contentType: info.contentType,
      etag: info.etag,
      lastModified: info.lastModified,
      contentLength: requestedRange.end - requestedRange.start + 1,
      contentRange: `bytes ${requestedRange.start}-${requestedRange.end}/${info.size}`,
    };
  }

  async function remove(key) {
    const { fullPath } = resolveWithinBase(root, key);
    try {
      await unlink(fullPath);
    } catch (err) {
      if (err?.code !== 'ENOENT') throw err;
    }
  }

  async function deletePrefix(prefix) {
    if (!prefix) {
      await rm(root, { recursive: true, force: true });
      await mkdir(root, { recursive: true });
      return;
    }
    const normalizedPrefix = normalizeObjectKey(prefix);
    const targetDir = resolveWithinBase(root, normalizedPrefix).fullPath;
    await rm(targetDir, { recursive: true, force: true });
  }

  async function list(prefix = '', { limit = 1000, cursor = null } = {}) {
    const normalizedPrefix = prefix ? normalizeObjectKey(prefix) : '';
    const all = [];
    for await (const entry of walkFiles(root)) {
      const key = relative(root, entry.fullPath).replace(/\\/g, '/');
      if (normalizedPrefix && !key.startsWith(normalizedPrefix)) continue;
      all.push({
        key,
        size: entry.size,
        lastModified: entry.lastModified,
        etag: makeWeakEtag(entry.size, entry.lastModified),
        contentType: guessContentType(key),
      });
    }
    all.sort((a, b) => a.key.localeCompare(b.key));
    const offset = cursor ? Number(cursor) : 0;
    const safeOffset = Number.isFinite(offset) && offset >= 0 ? offset : 0;
    const page = all.slice(safeOffset, safeOffset + limit);
    const nextCursor = safeOffset + limit < all.length ? String(safeOffset + limit) : null;
    return { items: page, nextCursor };
  }

  async function materialize(key, workDir) {
    const { normalizedKey, fullPath } = resolveWithinBase(root, key);
    const targetRoot = workDir || await mkdtemp(join(tmpdir(), 'lcyt-store-'));
    await mkdir(targetRoot, { recursive: true });
    const targetPath = join(targetRoot, `${randomUUID()}-${basename(normalizedKey)}`);
    await copyFile(fullPath, targetPath);
    return targetPath;
  }

  return {
    type: 'local',
    put,
    putFile,
    stream,
    stat: statObject,
    exists,
    delete: remove,
    deletePrefix,
    list,
    materialize,
  };
}
