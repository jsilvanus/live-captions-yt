import { Readable } from 'node:stream';

export async function coercePreviewResponse(resp) {
  if (resp == null) return null;

  let headers = {};
  let body = resp;

  if (typeof resp === 'object' && resp !== null && 'headers' in resp && 'body' in resp) {
    headers = resp.headers || {};
    body = resp.body;
  }

  // Buffer
  if (Buffer.isBuffer(body)) {
    return { stream: Readable.from([body]), headers: normalizeHeaders(headers, { 'content-type': headers['content-type'] || 'application/octet-stream', 'content-length': String(body.length) }) };
  }

  // Node Readable
  if (body && typeof body.pipe === 'function') {
    return { stream: body, headers: normalizeHeaders(headers, { 'content-type': headers['content-type'] || 'application/octet-stream' }) };
  }

  // WHATWG ReadableStream
  const isWebStream = body && typeof body.getReader === 'function';
  if (isWebStream && typeof Readable.fromWeb === 'function') {
    return { stream: Readable.fromWeb(body), headers: normalizeHeaders(headers, { 'content-type': headers['content-type'] || 'application/octet-stream' }) };
  }

  // Plain object with a buffer-like `data` field
  if (body && typeof body === 'object' && body.data && Buffer.isBuffer(body.data)) {
    return { stream: Readable.from([body.data]), headers: normalizeHeaders(headers, { 'content-type': headers['content-type'] || 'application/octet-stream' }) };
  }

  return null;
}

function normalizeHeaders(incoming = {}, defaults = {}) {
  const out = {};
  for (const [k, v] of Object.entries(incoming || {})) out[String(k).toLowerCase()] = String(v);
  for (const [k, v] of Object.entries(defaults || {})) if (!out[k.toLowerCase()]) out[k.toLowerCase()] = v;
  return out;
}
