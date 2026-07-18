/**
 * Tests for HLS manager storage publishing (Item 1).
 *
 * Tests cover:
 *   - Constructor accepts resolveStorage parameter
 *   - getPublicUrl() delegates to storage adapter
 *   - getPublicUrl() returns null when resolveStorage is absent
 *   - Cleanup on stop()
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { HlsManager } from '../src/hls-manager.js';

// Mock storage adapter
function createMockAdapter() {
  const objects = new Map();
  return {
    putObject: async (apiKey, objectKey, buffer, contentType = 'application/octet-stream') => {
      objects.set(`${apiKey}/${objectKey}`, { buffer, contentType });
      return { storedKey: `${apiKey}/${objectKey}` };
    },
    publicUrl: (apiKey, objectKey) => {
      if (!objects.has(`${apiKey}/${objectKey}`)) return null;
      return `https://storage.example.com/${apiKey}/${objectKey}`;
    },
    objects,
  };
}

// Mock resolveStorage factory
function createMockResolveStorage(adapter) {
  return async (apiKey) => adapter;
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('HlsManager constructor', () => {
  test('accepts resolveStorage parameter', () => {
    const adapter = createMockAdapter();
    const resolveStorage = createMockResolveStorage(adapter);
    const mgr = new HlsManager({ localRtmp: null, resolveStorage });

    assert.equal(mgr._resolveStorage, resolveStorage);
  });

  test('resolveStorage is optional and defaults to null', () => {
    const mgr = new HlsManager({ localRtmp: null });
    assert.equal(mgr._resolveStorage, null);
  });

  test('initializes empty watchers and debounce maps', () => {
    const mgr = new HlsManager({ localRtmp: null });
    assert.ok(mgr._watchers instanceof Map);
    assert.ok(mgr._publishDebounce instanceof Map);
    assert.equal(mgr._watchers.size, 0);
    assert.equal(mgr._publishDebounce.size, 0);
  });
});

describe('HlsManager.getPublicUrl()', () => {
  test('returns storage public URL when object exists', async () => {
    const adapter = createMockAdapter();
    const resolveStorage = createMockResolveStorage(adapter);
    const mgr = new HlsManager({ localRtmp: null, resolveStorage });

    // Manually seed an object in the adapter
    await adapter.putObject('mykey', 'segment.ts', Buffer.from('data'));

    const url = await mgr.getPublicUrl('mykey', 'segment.ts');
    assert.equal(url, 'https://storage.example.com/mykey/segment.ts');
  });

  test('returns null when resolveStorage is absent', async () => {
    const mgr = new HlsManager({ localRtmp: null, resolveStorage: null });
    const url = await mgr.getPublicUrl('testkey', 'segment.ts');
    assert.equal(url, null);
  });

  test('returns null when storage returns null', async () => {
    const adapter = createMockAdapter();
    const resolveStorage = createMockResolveStorage(adapter);
    const mgr = new HlsManager({ localRtmp: null, resolveStorage });

    // Don't seed an object, so publicUrl returns null
    const url = await mgr.getPublicUrl('testkey', 'nonexistent.ts');
    assert.equal(url, null);
  });

  test('handles resolveStorage errors gracefully', async () => {
    const resolveStorage = async () => {
      throw new Error('storage unavailable');
    };
    const mgr = new HlsManager({ localRtmp: null, resolveStorage });

    const url = await mgr.getPublicUrl('testkey', 'segment.ts');
    assert.equal(url, null);
  });
});

describe('HlsManager._publishToStorage()', () => {
  test('calls storage.putObject with correct parameters', async () => {
    const adapter = createMockAdapter();
    const resolveStorage = createMockResolveStorage(adapter);
    const mgr = new HlsManager({ localRtmp: null, resolveStorage });

    // Write a temporary file and publish it
    const { writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');

    const tmpFile = path.default.join(tmpdir(), `test-${Date.now()}.ts`);
    writeFileSync(tmpFile, Buffer.from('test data'));

    await mgr._publishToStorage('mykey', 'test.ts', tmpFile, 'video/MP2T');

    assert.ok(adapter.objects.has('mykey/test.ts'));
    const published = adapter.objects.get('mykey/test.ts');
    assert.equal(published.contentType, 'video/MP2T');
    assert.equal(published.buffer.toString(), 'test data');
  });

  test('handles file read errors gracefully', async () => {
    const adapter = createMockAdapter();
    const resolveStorage = createMockResolveStorage(adapter);
    const mgr = new HlsManager({ localRtmp: null, resolveStorage });

    // Non-existent file path
    const result = await mgr._publishToStorage('mykey', 'missing.ts', '/nonexistent/path.ts', 'video/MP2T');

    // Should not throw, just log a warning
    assert.equal(result, undefined);
  });

  test('is non-fatal when resolveStorage is absent', async () => {
    const mgr = new HlsManager({ localRtmp: null, resolveStorage: null });

    const result = await mgr._publishToStorage('mykey', 'test.ts', '/any/path', 'video/MP2T');

    // Should be a no-op
    assert.equal(result, undefined);
  });
});

describe('HlsManager stop() cleanup', () => {
  test('removes watcher from map', async () => {
    const mgr = new HlsManager({ localRtmp: null });

    // Manually add a mock watcher
    const mockWatcher = { close: () => {} };
    mgr._watchers.set('testkey', mockWatcher);

    await mgr.stop('testkey');

    assert.ok(!mgr._watchers.has('testkey'));
  });

  test('clears debounce timer', async () => {
    const mgr = new HlsManager({ localRtmp: null });

    // Manually add a mock timer
    const timer = setTimeout(() => {}, 10000);
    mgr._publishDebounce.set('testkey', timer);

    await mgr.stop('testkey');

    assert.ok(!mgr._publishDebounce.has('testkey'));
  });

  test('closes watcher safely', async () => {
    const mgr = new HlsManager({ localRtmp: null });

    let closeCalled = false;
    const mockWatcher = {
      close: () => {
        closeCalled = true;
      },
    };
    mgr._watchers.set('testkey', mockWatcher);

    await mgr.stop('testkey');

    assert.ok(closeCalled);
  });
});
