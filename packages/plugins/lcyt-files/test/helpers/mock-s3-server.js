/**
 * Minimal mock S3 server for testing S3 adapter.
 *
 * Implements just the S3 REST API subset needed by the adapter:
 * - PUT /:bucket/:key — store object
 * - GET /:bucket/:key — retrieve object or 404
 * - DELETE /:bucket/:key — delete object
 * - GET /:bucket?list-type=2&prefix=... — list objects with XML response + pagination
 *
 * Path-style URL format only (forcePathStyle: true), matching adapter config.
 */

import { createServer } from 'node:http';
import { URL } from 'node:url';

/**
 * Start a mock S3 server.
 *
 * @returns {Promise<{ port: number, stop: () => Promise<void>, objects: Map<string, Buffer> }>}
 */
export async function startMockS3Server() {
  const objects = new Map(); // key → Buffer

  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;
    const [, bucket, ...keyParts] = pathname.split('/');
    const objectKey = keyParts.join('/');

    // Set CORS headers for all responses
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Handle OPTIONS (CORS preflight)
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // PUT /:bucket/:key — store object
    if (req.method === 'PUT' && bucket && objectKey) {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        const buffer = Buffer.concat(chunks);
        objects.set(`${bucket}/${objectKey}`, buffer);
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        res.end('<?xml version="1.0" encoding="UTF-8"?><PutObjectOutput/>');
      });
      return;
    }

    // GET /:bucket/:key — retrieve object or 404
    if (req.method === 'GET' && bucket && objectKey && !url.searchParams.has('list-type')) {
      const key = `${bucket}/${objectKey}`;
      const buffer = objects.get(key);
      if (!buffer) {
        res.writeHead(404, { 'Content-Type': 'application/xml' });
        res.end(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message></Error>`);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': buffer.length });
      res.end(buffer);
      return;
    }

    // GET /:bucket?list-type=2&prefix=... — list objects with pagination
    if (req.method === 'GET' && bucket && url.searchParams.get('list-type') === '2') {
      const prefix = url.searchParams.get('prefix') || '';
      const continuationToken = url.searchParams.get('continuation-token');

      // Filter objects matching the prefix
      const allMatching = Array.from(objects.entries())
        .filter(([key]) => key.startsWith(`${bucket}/${prefix}`))
        .sort(([a], [b]) => a.localeCompare(b));

      // Simple pagination: 2 items per page for testing
      const pageSize = 2;
      const startIndex = continuationToken ? parseInt(continuationToken, 10) : 0;
      const pageItems = allMatching.slice(startIndex, startIndex + pageSize);
      const hasMore = startIndex + pageSize < allMatching.length;
      const nextToken = hasMore ? String(startIndex + pageSize) : '';

      // Build XML response
      const contents = pageItems.map(([key, buffer]) => {
        const objectKey = key.slice(`${bucket}/`.length);
        const lastModified = new Date().toISOString(); // All objects have same timestamp for simplicity
        return `<Contents><Key>${escapeXml(objectKey)}</Key><Size>${buffer.length}</Size><LastModified>${lastModified}</LastModified></Contents>`;
      }).join('\n');

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult>
  <Name>${escapeXml(bucket)}</Name>
  <Prefix>${escapeXml(prefix)}</Prefix>
  <IsTruncated>${hasMore ? 'true' : 'false'}</IsTruncated>
  ${pageItems.length > 0 ? contents : ''}
  ${hasMore ? `<NextContinuationToken>${escapeXml(nextToken)}</NextContinuationToken>` : ''}
</ListBucketResult>`;

      res.writeHead(200, { 'Content-Type': 'application/xml' });
      res.end(xml);
      return;
    }

    // DELETE /:bucket/:key — delete object (204, even if not found)
    if (req.method === 'DELETE' && bucket && objectKey) {
      const key = `${bucket}/${objectKey}`;
      objects.delete(key);
      res.writeHead(204);
      res.end();
      return;
    }

    // Fallback: 404
    res.writeHead(404);
    res.end('Not Found');
  });

  return new Promise((resolve) => {
    server.listen(0, () => {
      const port = server.address().port;
      resolve({
        port,
        stop: () => new Promise((done) => server.close(done)),
        objects,
      });
    });
  });
}

/**
 * Escape special XML characters.
 * @private
 */
function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
