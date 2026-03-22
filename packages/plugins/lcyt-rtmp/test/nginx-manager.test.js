/**
 * Unit tests for NginxManager.
 *
 * Tests cover:
 *   - keyToSlug() determinism and non-reversibility
 *   - addStream() / removeStream() in-memory tracking
 *   - getPublicUrl() output format
 *   - listStreams() shape
 *   - _buildConfig() output structure (slug present, api key NOT present in public location)
 *   - no-op mode (isEnabled=false): no file writes or nginx reloads
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { NginxManager } from '../src/nginx-manager.js';

// ─── keyToSlug ────────────────────────────────────────────────────────────────
describe('NginxManager.keyToSlug()', () => {
  test('returns a 16-char lowercase hex string', () => {
    const slug = NginxManager.keyToSlug('testkey');
    assert.match(slug, /^[0-9a-f]{16}$/);
  });

  test('is deterministic for the same input', () => {
    assert.equal(NginxManager.keyToSlug('abc'), NginxManager.keyToSlug('abc'));
  });

  test('different keys produce different slugs (collision resistance)', () => {
    const keys = ['key1', 'key2', 'KEY1', 'abc123', 'x'.repeat(64)];
    const slugs = keys.map(k => NginxManager.keyToSlug(k));
    const unique = new Set(slugs);
    assert.equal(unique.size, keys.length);
  });

  test('slug does not contain the original key', () => {
    const key = 'supersecretapikey';
    const slug = NginxManager.keyToSlug(key);
    assert.ok(!slug.includes(key));
    assert.ok(!slug.includes('secret'));
  });
});

// ─── no-op mode ───────────────────────────────────────────────────────────────
describe('NginxManager — no-op mode (enabled=false)', () => {
  test('isEnabled is false when enabled=false', () => {
    const mgr = new NginxManager({ enabled: false });
    assert.equal(mgr.isEnabled, false);
  });

  test('addStream() resolves without throwing and returns slug', async () => {
    const mgr = new NginxManager({ enabled: false });
    const slug = await mgr.addStream('myApiKey');
    assert.equal(slug, NginxManager.keyToSlug('myApiKey'));
  });

  test('removeStream() resolves without throwing', async () => {
    const mgr = new NginxManager({ enabled: false });
    await mgr.addStream('key1');
    await assert.doesNotReject(() => mgr.removeStream('key1'));
  });

  test('addStream() tracks stream in memory', async () => {
    const mgr = new NginxManager({ enabled: false });
    await mgr.addStream('key1');
    const streams = mgr.listStreams();
    assert.equal(streams.length, 1);
    assert.equal(streams[0].apiKey, 'key1');
    assert.equal(streams[0].slug, NginxManager.keyToSlug('key1'));
  });

  test('removeStream() removes from memory', async () => {
    const mgr = new NginxManager({ enabled: false });
    await mgr.addStream('key1');
    await mgr.removeStream('key1');
    assert.equal(mgr.listStreams().length, 0);
  });

  test('removeStream() on unknown key is a no-op', async () => {
    const mgr = new NginxManager({ enabled: false });
    await assert.doesNotReject(() => mgr.removeStream('not-registered'));
  });
});

// ─── getPublicUrl ─────────────────────────────────────────────────────────────
describe('NginxManager.getPublicUrl()', () => {
  test('returns slug-based URL, not key-based URL', () => {
    const mgr  = new NginxManager({ enabled: false, prefix: '/r' });
    const key  = 'secretapikey123';
    const url  = mgr.getPublicUrl(key, 'https://api.example.com');
    const slug = NginxManager.keyToSlug(key);

    assert.ok(url.startsWith('https://api.example.com/r/'));
    assert.ok(url.includes(slug));
    assert.ok(!url.includes(key));
  });

  test('URL ends with /index.m3u8', () => {
    const mgr = new NginxManager({ enabled: false });
    const url = mgr.getPublicUrl('mykey', 'https://api.example.com');
    assert.ok(url.endsWith('/index.m3u8'));
  });

  test('custom prefix is respected', () => {
    const mgr = new NginxManager({ enabled: false, prefix: '/streams' });
    const url = mgr.getPublicUrl('mykey', 'https://example.com');
    assert.ok(url.startsWith('https://example.com/streams/'));
  });
});

// ─── _buildConfig ─────────────────────────────────────────────────────────────
describe('NginxManager._buildConfig()', () => {
  test('empty streams produces a section with no location blocks', async () => {
    const mgr = new NginxManager({ enabled: false });
    const cfg = mgr._buildConfig();
    assert.ok(cfg.includes('BEGIN lcyt-radio-managed'));
    assert.ok(cfg.includes('END lcyt-radio-managed'));
    assert.ok(!cfg.includes('location'));
  });

  test('contains BEGIN/END markers', async () => {
    const mgr = new NginxManager({ enabled: false });
    await mgr.addStream('mykey');
    const cfg = mgr._buildConfig();
    assert.ok(cfg.includes('BEGIN lcyt-radio-managed'));
    assert.ok(cfg.includes('END lcyt-radio-managed'));
  });

  test('location block uses slug (not api key) as public path', async () => {
    const mgr  = new NginxManager({ enabled: false, mediamtxHlsBase: 'http://127.0.0.1:8080' });
    const key  = 'verysecretkey';
    const slug = NginxManager.keyToSlug(key);
    await mgr.addStream(key);
    const cfg = mgr._buildConfig();

    // Public location must use slug, not the key
    assert.ok(cfg.includes(`location /r/${slug}/`));
    // Internal proxy_pass must use the real key
    assert.ok(cfg.includes(`http://127.0.0.1:8080/${encodeURIComponent(key)}/`));
  });

  test('api key does NOT appear in any location directive', async () => {
    const mgr = new NginxManager({ enabled: false });
    const key = 'api-key-must-not-appear-here';
    await mgr.addStream(key);
    const cfg = mgr._buildConfig();
    // Split config by lines and check location lines only
    const locationLines = cfg.split('\n').filter(l => l.includes('location '));
    for (const line of locationLines) {
      assert.ok(!line.includes(key), `API key appeared in location line: ${line}`);
    }
  });

  test('multiple streams produce multiple location blocks', async () => {
    const mgr = new NginxManager({ enabled: false });
    await mgr.addStream('keyA');
    await mgr.addStream('keyB');
    const cfg = mgr._buildConfig();
    const locationCount = (cfg.match(/^\s+location /mg) || []).length;
    assert.equal(locationCount, 2);
  });

  test('includes CORS headers in proxy block', async () => {
    const mgr = new NginxManager({ enabled: false });
    await mgr.addStream('mykey');
    const cfg = mgr._buildConfig();
    assert.ok(cfg.includes('Access-Control-Allow-Origin'));
  });

  test('includes proxy_buffering off', async () => {
    const mgr = new NginxManager({ enabled: false });
    await mgr.addStream('mykey');
    const cfg = mgr._buildConfig();
    assert.ok(cfg.includes('proxy_buffering off'));
  });
});

// ─── listStreams ──────────────────────────────────────────────────────────────
describe('NginxManager.listStreams()', () => {
  test('returns empty array when no streams registered', () => {
    const mgr = new NginxManager({ enabled: false });
    assert.deepEqual(mgr.listStreams(), []);
  });

  test('entry has apiKey, slug, publicPath fields', async () => {
    const mgr = new NginxManager({ enabled: false, prefix: '/r' });
    await mgr.addStream('testkey');
    const [entry] = mgr.listStreams();
    assert.equal(entry.apiKey, 'testkey');
    assert.equal(entry.slug, NginxManager.keyToSlug('testkey'));
    assert.equal(entry.publicPath, `/r/${NginxManager.keyToSlug('testkey')}/`);
  });
});

// ─── getSlug ─────────────────────────────────────────────────────────────────
describe('NginxManager.getSlug()', () => {
  test('same as keyToSlug static method', () => {
    const mgr = new NginxManager({ enabled: false });
    assert.equal(mgr.getSlug('mykey'), NginxManager.keyToSlug('mykey'));
  });
});
