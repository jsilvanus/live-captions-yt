import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createS3ObjectStore } from '../src/object-store/s3.js';
import { createLocalObjectStore } from '../src/object-store/local.js';
import { startMockS3Server } from './helpers/mock-s3-server.js';

describe('S3 object store presign', () => {
  let mock;
  let store;

  before(async () => {
    mock = await startMockS3Server();
    store = await createS3ObjectStore({
      bucket: 'b',
      prefix: 'recordings',
      region: 'auto',
      endpoint: `http://127.0.0.1:${mock.port}`,
      credentials: { accessKeyId: 'x', secretAccessKey: 'y' },
    });
    await store.put('v/clip.mp4', 'video-bytes');
  });

  after(async () => {
    store.close?.();
    await mock.stop();
  });

  test('signs for the internal endpoint when no public endpoint is set, and the URL works', async () => {
    const url = await store.presign('v/clip.mp4', { expiresSeconds: 60 });
    const parsed = new URL(url);
    assert.equal(parsed.origin, `http://127.0.0.1:${mock.port}`);
    assert.equal(parsed.pathname, '/b/recordings/v/clip.mp4');
    assert.equal(parsed.searchParams.get('X-Amz-Expires'), '60');
    const res = await fetch(url);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'video-bytes');
  });

  test('signs for the public endpoint when it differs, never rewriting the host afterwards', async () => {
    const pub = await createS3ObjectStore({
      bucket: 'b',
      region: 'auto',
      endpoint: `http://127.0.0.1:${mock.port}`,
      publicEndpoint: 'https://files.example.test:9000',
      credentials: { accessKeyId: 'x', secretAccessKey: 'y' },
    });
    const parsed = new URL(await pub.presign('recordings/v/clip.mp4'));
    assert.equal(parsed.origin, 'https://files.example.test:9000');
    assert.equal(parsed.searchParams.get('X-Amz-SignedHeaders'), 'host');
    pub.close?.();
  });

  test('adds a download filename on request and the local store has no presign', async () => {
    const parsed = new URL(await store.presign('v/clip.mp4', { filename: 'a"b.mp4' }));
    assert.match(parsed.searchParams.get('response-content-disposition'), /attachment; filename="a_b\.mp4"/);
    assert.equal(createLocalObjectStore({ baseDir: '/tmp/x' }).presign, undefined);
  });
});
