import { Readable } from 'stream';
import fs from 'fs';

function toLowerKeyMap(headers) {
  const out = {};
  if (!headers) return out;
  for (const k of Object.keys(headers || {})) {
    out[k.toLowerCase()] = headers[k];
  }
  return out;
}

async function streamFromWhatwg(rs) {
  if (typeof Readable.fromWeb === 'function') return Readable.fromWeb(rs);
  // Fallback: async iterator bridge
  const reader = rs.getReader();
  const asyncIterable = {
    async *[Symbol.asyncIterator]() {
      while (true) {
        const { value, done } = await reader.read();
        if (done) return;
        yield Buffer.from(value);
      }
    }
  };
  return Readable.from(asyncIterable);
}

export async function coercePreviewResponse(resp) {
  // Accept: Buffer, Uint8Array, ArrayBuffer, Node Readable, WHATWG ReadableStream,
  // or { headers, body } where body is one of the above.
  let headers = {};
  let body = resp;

  if (resp && typeof resp === 'object' && ('headers' in resp || 'body' in resp)) {
    headers = toLowerKeyMap(resp.headers || {});
    body = resp.body;
  }

  // Normalize typed arrays / ArrayBuffer
  if (body instanceof ArrayBuffer) body = Buffer.from(new Uint8Array(body));
  if (ArrayBuffer.isView(body) && !(body instanceof Buffer)) body = Buffer.from(body);

  // Buffer
  if (Buffer.isBuffer(body)) {
    const stream = Readable.from(body);
    return { stream, headers };
  }

  // Node Readable
  if (body && typeof body.pipe === 'function') {
    return { stream: body, headers };
  }

  // WHATWG ReadableStream (browser-like)
  if (body && typeof body.getReader === 'function') {
    const stream = await streamFromWhatwg(body);
    return { stream, headers };
  }

  // If it's a file path (string), create a fs stream
  if (typeof body === 'string') {
    try {
      await fs.promises.access(body, fs.constants.R_OK);
      const stream = fs.createReadStream(body);
      return { stream, headers };
    } catch (err) {
      throw Object.assign(new Error('preview file not found'), { code: 'ENOENT' });
    }
  }

  throw new Error('unsupported preview response type');
}

export default coercePreviewResponse;
