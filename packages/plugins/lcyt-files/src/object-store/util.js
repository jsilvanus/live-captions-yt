import { extname } from 'node:path';

const CONTENT_TYPES = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.mp4': 'video/mp4',
  '.m4s': 'video/iso.segment',
  '.m4a': 'audio/mp4',
  '.vtt': 'text/vtt',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

export function guessContentType(key, fallback = 'application/octet-stream') {
  return CONTENT_TYPES[extname(String(key || '')).toLowerCase()] || fallback;
}

export function normalizeObjectKey(key) {
  const normalized = String(key || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized) throw new Error('Object key is required');
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length === 0) throw new Error('Object key is required');
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error('Invalid object key');
  }
  return segments.join('/');
}

export function parseRangeHeaderValue(rangeValue, size) {
  if (!rangeValue || typeof rangeValue !== 'string' || !rangeValue.startsWith('bytes=')) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeValue.trim());
  if (!match) return null;
  const startRaw = match[1];
  const endRaw = match[2];
  if (!startRaw && !endRaw) return null;

  if (!startRaw) {
    const suffixLen = Number(endRaw);
    if (!Number.isFinite(suffixLen) || suffixLen <= 0) return null;
    const len = Math.min(size, suffixLen);
    return { start: Math.max(0, size - len), end: size - 1 };
  }

  const start = Number(startRaw);
  const requestedEnd = endRaw ? Number(endRaw) : (size - 1);
  if (!Number.isFinite(start) || !Number.isFinite(requestedEnd)) return null;
  if (start < 0 || start >= size) return null;
  const end = Math.min(size - 1, requestedEnd);
  if (end < start) return null;
  return { start, end };
}

export function makeWeakEtag(size, mtimeMs) {
  return `W/"${size}-${Math.floor(mtimeMs)}"`;
}
