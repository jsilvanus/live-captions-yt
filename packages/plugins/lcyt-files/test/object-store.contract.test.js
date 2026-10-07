import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createLocalObjectStore } from '../src/object-store/local.js';
import { createS3ObjectStore } from '../src/object-store/s3.js';
import { startMockS3Server } from './helpers/mock-s3-server.js';

async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function defineContractSuite(label, setupStore) {
  describe(label, () => {
    let store;
    let cleanup;

    before(async () => {
      const result = await setupStore();
      store = result.store;
      cleanup = result.cleanup;
    });

    after(async () => {
      if (cleanup) await cleanup();
    });

    test('put + stat + exists round-trip', async () => {
      await store.put('graphics/demo/hello.txt', 'hello world', { contentType: 'text/plain' });
      const meta = await store.stat('graphics/demo/hello.txt');
      assert.equal(meta.key, 'graphics/demo/hello.txt');
      assert.equal(meta.size, 11);
      assert.equal(await store.exists('graphics/demo/hello.txt'), true);
      assert.equal(await store.exists('graphics/demo/missing.txt'), false);
    });

    test('stream supports byte ranges', async () => {
      await store.put('recordings/demo/clip.bin', Buffer.from('0123456789'));
      const ranged = await store.stream('recordings/demo/clip.bin', { range: 'bytes=2-5' });
      const body = await readAll(ranged.stream);
      assert.equal(body.toString('utf8'), '2345');
      assert.equal(ranged.contentLength, 4);
      assert.ok(ranged.contentRange);
    });

    test('list supports pagination cursor', async () => {
      await store.put('icons/demo/a.txt', 'a');
      await store.put('icons/demo/b.txt', 'b');
      await store.put('icons/demo/c.txt', 'c');

      const first = await store.list('icons/demo', { limit: 2 });
      assert.equal(first.items.length, 2);
      assert.ok(first.nextCursor);

      const second = await store.list('icons/demo', { limit: 2, cursor: first.nextCursor });
      assert.equal(second.items.length, 1);
      assert.equal(second.nextCursor, null);
      const keys = [...first.items, ...second.items].map((item) => item.key).sort();
      assert.deepEqual(keys, ['icons/demo/a.txt', 'icons/demo/b.txt', 'icons/demo/c.txt']);
    });

    test('deletePrefix removes all matching objects', async () => {
      await store.put('thumbnails/keyA/one.png', '1');
      await store.put('thumbnails/keyA/two.png', '2');
      await store.put('thumbnails/keyB/other.png', '3');
      await store.deletePrefix('thumbnails/keyA');
      assert.equal(await store.exists('thumbnails/keyA/one.png'), false);
      assert.equal(await store.exists('thumbnails/keyA/two.png'), false);
      assert.equal(await store.exists('thumbnails/keyB/other.png'), true);
    });

    test('materialize downloads object into a local file path', async () => {
      const materializeDir = await mkdtemp(join(tmpdir(), 'lcyt-materialize-'));
      try {
        await store.put('captions/project/file.vtt', 'WEBVTT\n\n');
        const localPath = await store.materialize('captions/project/file.vtt', materializeDir);
        const content = await fs.promises.readFile(localPath, 'utf8');
        assert.equal(content, 'WEBVTT\n\n');
      } finally {
        await rm(materializeDir, { recursive: true, force: true });
      }
    });

    test('putFile uploads existing local file', async () => {
      const srcDir = await mkdtemp(join(tmpdir(), 'lcyt-source-file-'));
      const srcFile = join(srcDir, 'in.txt');
      try {
        await writeFile(srcFile, 'from-file');
        const meta = await store.putFile('backups/2026-10-11/lcyt-backend.db', srcFile);
        assert.equal(meta.size, 9);
        const streamed = await store.stream('backups/2026-10-11/lcyt-backend.db');
        const body = await readAll(streamed.stream);
        assert.equal(body.toString('utf8'), 'from-file');
      } finally {
        await rm(srcDir, { recursive: true, force: true });
      }
    });

    test('put accepts readable streams', async () => {
      await store.put('graphics/streamed/object.txt', Readable.from(['aa', 'bb', 'cc']));
      const streamed = await store.stream('graphics/streamed/object.txt');
      const body = await readAll(streamed.stream);
      assert.equal(body.toString('utf8'), 'aabbcc');
    });
  });
}

defineContractSuite('object-store contract (local)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lcyt-object-store-local-'));
  return {
    store: createLocalObjectStore({ baseDir: dir }),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
});

defineContractSuite('object-store contract (s3)', async () => {
  const mockS3 = await startMockS3Server();
  try {
    const store = await createS3ObjectStore({
      bucket: 'contract-bucket',
      prefix: 'media',
      region: 'auto',
      endpoint: `http://127.0.0.1:${mockS3.port}`,
      credentials: { accessKeyId: 'x', secretAccessKey: 'y' },
    });
    return {
      store,
      cleanup: () => mockS3.stop(),
    };
  } catch (err) {
    await mockS3.stop();
    throw err;
  }
});
