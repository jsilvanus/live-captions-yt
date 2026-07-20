/**
 * Minimal mock S3 server for testing PutObject-only upload flows.
 *
 * Implements just the S3 REST API subset needed by `storage/s3.js`'s
 * `uploadDirectoryToS3`: PUT /:bucket/:key — store object. Path-style URLs
 * only (forcePathStyle: true), matching the client config used there.
 */

import { createServer } from 'node:http';
import { URL } from 'node:url';

/**
 * Start a mock S3 server.
 *
 * @returns {Promise<{ port: number, stop: () => Promise<void>, objects: Map<string, Buffer> }>}
 */
export async function startMockS3Server() {
  const objects = new Map(); // 'bucket/key' → Buffer

  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const [, bucket, ...keyParts] = url.pathname.split('/');
    const objectKey = keyParts.join('/');

    if (req.method === 'PUT' && bucket && objectKey) {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        objects.set(`${bucket}/${objectKey}`, Buffer.concat(chunks));
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        res.end('<?xml version="1.0" encoding="UTF-8"?><PutObjectOutput/>');
      });
      return;
    }

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
