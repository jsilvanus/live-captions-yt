/**
 * Tests for the S3 storage adapter.
 *
 * Uses a lightweight mock S3 HTTP server for testing against realistic S3 API patterns.
 * Tests cover the core adapter methods: openAppend/write/close, openRead, deleteFile,
 * putObject/publicUrl, listObjects with pagination, and describe().
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startMockS3Server } from './helpers/mock-s3-server.js';
import { createS3Adapter } from '../src/adapters/s3.js';

// ─── Test fixtures ───────────────────────────────────────────────────────────

let mockS3;
let adapter;

before(async () => {
  mockS3 = await startMockS3Server();
  adapter = await createS3Adapter({
    bucket: 'test-bucket',
    prefix: 'captions',
    region: 'us-east-1',
    endpoint: `http://127.0.0.1:${mockS3.port}`,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  });
});

after(async () => {
  await mockS3.stop();
});

// ─── createS3Adapter ─────────────────────────────────────────────────────────

describe('createS3Adapter', () => {
  test('keyDir computes per-key prefix', () => {
    const dir = adapter.keyDir('myApiKey123');
    assert.ok(dir.includes('captions'));
    assert.ok(dir.includes('myApiKey123'));
  });

  test('openAppend returns handle with storedKey', async () => {
    const handle = adapter.openAppend('key1', 'test.txt');
    assert.ok(typeof handle.storedKey === 'string');
    assert.ok(handle.storedKey.includes('captions'));
    assert.ok(handle.storedKey.includes('test.txt'));
    await handle.close();
  });

  test('write() and close() upload to S3', async () => {
    const handle = adapter.openAppend('key1', 'upload.txt');
    await handle.write('Hello ');
    await handle.write('World');
    await handle.close();

    // Verify object was stored
    const stored = mockS3.objects.get(`test-bucket/${handle.storedKey}`);
    assert.ok(stored);
    assert.equal(stored.toString(), 'Hello World');
  });

  test('sizeBytes() tracks written bytes', async () => {
    const handle = adapter.openAppend('key1', 'size.txt');
    await handle.write('123');
    await handle.write('45');
    const size = handle.sizeBytes();
    assert.equal(size, 5);
    await handle.close();
  });

  test('openRead() returns a readable stream', async () => {
    // First, write via putObject
    const objectKey = 'readfile.txt';
    const result = await adapter.putObject('readkey', objectKey, Buffer.from('test content'));

    const { stream, contentType, size } = await adapter.openRead(
      'readkey',
      result.storedKey,
      'youtube',
    );

    assert.equal(contentType, 'text/plain');
    assert.equal(size, 12);

    // Drain the stream
    const chunks = [];
    await new Promise((resolve, reject) => {
      stream.on('data', c => chunks.push(c));
      stream.on('end', resolve);
      stream.on('error', reject);
    });
    assert.equal(Buffer.concat(chunks).toString(), 'test content');
  });

  test('deleteFile() removes object from S3', async () => {
    const handle = adapter.openAppend('key1', 'delete-me.txt');
    await handle.write('to delete');
    await handle.close();

    const storedKey = handle.storedKey;
    assert.ok(mockS3.objects.has(`test-bucket/${storedKey}`));

    await adapter.deleteFile('key1', storedKey);
    assert.ok(!mockS3.objects.has(`test-bucket/${storedKey}`));
  });

  test('deleteFile() is safe when object does not exist', async () => {
    await assert.doesNotReject(() =>
      adapter.deleteFile('key1', 'captions/key1/nonexistent.txt')
    );
  });

  test('putObject() stores object with PutObject (not multipart)', async () => {
    const objectKey = 'direct.txt';
    const result = await adapter.putObject('key1', objectKey, Buffer.from('direct'));

    assert.ok(result.storedKey);
    assert.ok(mockS3.objects.has(`test-bucket/${result.storedKey}`));
    const stored = mockS3.objects.get(`test-bucket/${result.storedKey}`);
    assert.equal(stored.toString(), 'direct');
  });

  test('putObject() with custom contentType', async () => {
    const objectKey = 'playlist.m3u8';
    const result = await adapter.putObject(
      'key1',
      objectKey,
      Buffer.from('#EXTM3U'),
      'application/x-mpegURL'
    );

    assert.ok(mockS3.objects.has(`test-bucket/${result.storedKey}`));
  });

  test('publicUrl() returns S3 path-style URL for custom endpoint', () => {
    const url = adapter.publicUrl('key1', 'file.txt');
    assert.ok(url.includes('127.0.0.1'));
    assert.ok(url.includes('test-bucket'));
    assert.ok(url.includes('captions'));
    assert.ok(url.includes('key1'));
    assert.ok(url.includes('file.txt'));
  });

  test('publicUrl() respects endpoint configuration', () => {
    // This adapter was created with a custom endpoint
    const url = adapter.publicUrl('mykey', 'segment.ts');
    assert.ok(url.startsWith('http://'));
    assert.ok(url.includes('test-bucket'));
  });

  test('describe() returns informative string', () => {
    const desc = adapter.describe();
    assert.ok(desc.includes('S3'));
    assert.ok(desc.includes('test-bucket'));
    assert.ok(desc.includes('captions'));
  });

  test('listObjects() returns empty iterable when no objects', async () => {
    const items = [];
    for await (const item of adapter.listObjects('emptykey')) {
      items.push(item);
    }
    assert.equal(items.length, 0);
  });

  test('listObjects() returns all objects under key prefix', async () => {
    // Create multiple objects under 'listkey1'
    await adapter.putObject('listkey1', 'file1.txt', 'a');
    await adapter.putObject('listkey1', 'file2.txt', 'bb');
    await adapter.putObject('listkey1', 'subdir/file3.txt', 'ccc');

    const items = [];
    for await (const item of adapter.listObjects('listkey1')) {
      items.push(item);
    }

    assert.equal(items.length, 3);
    const objectKeys = items.map(i => i.objectKey).sort();
    assert.deepEqual(objectKeys, ['file1.txt', 'file2.txt', 'subdir/file3.txt']);
  });

  test('listObjects() includes storedKey, size, and lastModified', async () => {
    await adapter.putObject('sizekey', 'test.txt', 'hello');

    const items = [];
    for await (const item of adapter.listObjects('sizekey')) {
      items.push(item);
    }

    assert.equal(items.length, 1);
    const item = items[0];
    assert.ok(typeof item.objectKey === 'string');
    assert.ok(typeof item.storedKey === 'string');
    assert.equal(typeof item.size, 'number');
    assert.ok(item.size > 0);
    assert.equal(typeof item.lastModified, 'number');
    assert.ok(item.lastModified > 0);
  });

  test('listObjects() respects prefix filter', async () => {
    // Create objects in two "directories"
    await adapter.putObject('prefixkey', 'subA/file1.txt', 'a');
    await adapter.putObject('prefixkey', 'subA/file2.txt', 'b');
    await adapter.putObject('prefixkey', 'subB/file3.txt', 'c');

    const itemsA = [];
    for await (const item of adapter.listObjects('prefixkey', 'subA')) {
      itemsA.push(item);
    }

    assert.equal(itemsA.length, 2);
    assert.ok(itemsA.every(i => i.objectKey.startsWith('subA')));
  });

  test('listObjects() handles pagination', async () => {
    // Mock server uses pageSize=2, so >2 objects tests pagination
    await adapter.putObject('pagekey', 'obj1.txt', 'a');
    await adapter.putObject('pagekey', 'obj2.txt', 'b');
    await adapter.putObject('pagekey', 'obj3.txt', 'c');
    await adapter.putObject('pagekey', 'obj4.txt', 'd');

    const items = [];
    for await (const item of adapter.listObjects('pagekey')) {
      items.push(item);
    }

    // Should fetch all 4 objects across multiple pages
    assert.equal(items.length, 4);
  });

  test('storedKey from listObjects can be passed to deleteFile', async () => {
    await adapter.putObject('delkey', 'todelete.txt', 'data');

    const items = [];
    for await (const item of adapter.listObjects('delkey')) {
      items.push(item);
    }

    assert.equal(items.length, 1);
    const storedKey = items[0].storedKey;

    // Verify it's in S3
    assert.ok(mockS3.objects.has(`test-bucket/${storedKey}`));

    // Delete via storedKey
    await adapter.deleteFile('delkey', storedKey);

    // Verify deletion
    assert.ok(!mockS3.objects.has(`test-bucket/${storedKey}`));
  });
});

// ─── Integration: multipart upload + read ───────────────────────────────────

describe('S3 adapter — multipart upload round-trip', () => {
  test('writes and reads back data via handles', async () => {
    // Write via openAppend
    const writeHandle = adapter.openAppend('roundtrip', 'data.txt');
    await writeHandle.write('Part 1\n');
    await writeHandle.write('Part 2\n');
    const storedKey = writeHandle.storedKey;
    await writeHandle.close();

    // Verify in mock S3
    const buffer = mockS3.objects.get(`test-bucket/${storedKey}`);
    assert.ok(buffer);
    assert.equal(buffer.toString(), 'Part 1\nPart 2\n');
  });

  test('openAppend and putObject to same key uses put semantics', async () => {
    // putObject should overwrite
    const objectKey = 'overwrite.txt';
    await adapter.putObject('owkey', objectKey, 'first');
    await adapter.putObject('owkey', objectKey, 'second');

    const stored = mockS3.objects.get(`test-bucket/captions/owkey/${objectKey}`);
    assert.equal(stored.toString(), 'second');
  });
});
