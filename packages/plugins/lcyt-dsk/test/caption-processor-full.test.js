/**
 * Comprehensive tests for createDskCaptionProcessor.
 *
 * Tests cover:
 *   - No metacode → passthrough
 *   - Absolute mode (default + viewport-specific)
 *   - Delta mode (+add, -remove, unprefixed in delta context)
 *   - Landscape aliases (landscape / default / main → 'landscape' slot)
 *   - Multi-viewport targeting
 *   - Clear (empty section)
 *   - Clean text extraction
 *   - SSE event shapes (graphics, text, bindings)
 *   - relayManager integration
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createDskCaptionProcessor } from '../src/caption-processor.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE caption_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key TEXT,
      shorthand TEXT,
      filename TEXT,
      mime_type TEXT,
      settings_json TEXT,
      type TEXT DEFAULT 'image'
    )
  `);
  return db;
}

function makeStore(initialState = {}) {
  const state = {
    default: initialState.default ?? [],
    viewports: { ...(initialState.viewports ?? {}) },
  };
  const emitted = [];
  return {
    state,
    emitted,
    getDskGraphicsState(_key) { return state; },
    setDskGraphicsState(_key, s) {
      state.default = s.default;
      state.viewports = s.viewports;
    },
    emitDskEvent(_key, type, payload) { emitted.push({ type, payload }); },
  };
}

function makeProcessor(db, store, relayManager = null) {
  return createDskCaptionProcessor({ db, store, relayManager });
}

const KEY = 'testkey';

// ---------------------------------------------------------------------------
// Passthrough — no metacode
// ---------------------------------------------------------------------------

describe('caption-processor: no metacode', () => {
  it('returns text unchanged when no <!-- present', async () => {
    const db = makeDb();
    const store = makeStore();
    const proc = makeProcessor(db, store);
    const out = await proc(KEY, 'Hello world');
    assert.equal(out, 'Hello world');
    assert.equal(store.emitted.filter(e => e.type === 'graphics').length, 0);
  });

  it('returns text unchanged when <!-- present but no graphics keyword', async () => {
    const db = makeDb();
    const store = makeStore();
    const proc = makeProcessor(db, store);
    const out = await proc(KEY, '<!-- comment -->Hello');
    assert.equal(out, '<!-- comment -->Hello');
  });

  it('emits bindings event when codes are non-empty, even with no metacode', async () => {
    const db = makeDb();
    const store = makeStore();
    const proc = makeProcessor(db, store);
    await proc(KEY, 'Hello', { section: 'intro' });
    const bindings = store.emitted.find(e => e.type === 'bindings');
    assert.ok(bindings, 'bindings event emitted');
    assert.deepEqual(bindings.payload.codes, { section: 'intro' });
  });

  it('does not emit bindings event when codes is empty object', async () => {
    const db = makeDb();
    const store = makeStore();
    const proc = makeProcessor(db, store);
    await proc(KEY, 'Hello', {});
    assert.equal(store.emitted.filter(e => e.type === 'bindings').length, 0);
  });

  it('does not emit bindings event when codes is omitted', async () => {
    const db = makeDb();
    const store = makeStore();
    const proc = makeProcessor(db, store);
    await proc(KEY, 'Hello');
    assert.equal(store.emitted.filter(e => e.type === 'bindings').length, 0);
  });
});

// ---------------------------------------------------------------------------
// Absolute mode — default section
// ---------------------------------------------------------------------------

describe('caption-processor: absolute default section', () => {
  it('sets default to listed names', async () => {
    const db = makeDb();
    const store = makeStore();
    const proc = makeProcessor(db, store);
    const out = await proc(KEY, '<!-- graphics:logo,banner -->Hello');
    assert.equal(out, 'Hello');
    const gfx = store.emitted.find(e => e.type === 'graphics');
    assert.ok(gfx);
    assert.deepEqual(gfx.payload.default, ['logo', 'banner']);
  });

  it('clears default when section is empty (<!-- graphics: -->)', async () => {
    const db = makeDb();
    const store = makeStore({ default: ['logo'] });
    const proc = makeProcessor(db, store);
    await proc(KEY, '<!-- graphics: -->');
    const gfx = store.emitted.find(e => e.type === 'graphics');
    assert.deepEqual(gfx.payload.default, []);
  });

  it('strips whitespace around names', async () => {
    const db = makeDb();
    const store = makeStore();
    const proc = makeProcessor(db, store);
    await proc(KEY, '<!-- graphics: logo , banner -->');
    const gfx = store.emitted.find(e => e.type === 'graphics');
    assert.deepEqual(gfx.payload.default, ['logo', 'banner']);
  });

  it('updates server-side state for subsequent delta operations', async () => {
    const db = makeDb();
    const store = makeStore();
    const proc = makeProcessor(db, store);
    await proc(KEY, '<!-- graphics:logo,banner -->');
    await proc(KEY, '<!-- graphics:+extra -->');
    const events = store.emitted.filter(e => e.type === 'graphics');
    const last = events[events.length - 1];
    assert.ok(last.payload.default.includes('logo'));
    assert.ok(last.payload.default.includes('banner'));
    assert.ok(last.payload.default.includes('extra'));
  });
});

// ---------------------------------------------------------------------------
// Delta mode
// ---------------------------------------------------------------------------

describe('caption-processor: delta mode', () => {
  it('+name adds to existing default', async () => {
    const db = makeDb();
    const store = makeStore({ default: ['logo'] });
    const proc = makeProcessor(db, store);
    await proc(KEY, '<!-- graphics:+banner -->');
    const gfx = store.emitted.find(e => e.type === 'graphics');
    assert.ok(gfx.payload.default.includes('logo'));
    assert.ok(gfx.payload.default.includes('banner'));
  });

  it('-name removes from existing default', async () => {
    const db = makeDb();
    const store = makeStore({ default: ['logo', 'banner'] });
    const proc = makeProcessor(db, store);
    await proc(KEY, '<!-- graphics:-banner -->');
    const gfx = store.emitted.find(e => e.type === 'graphics');
    assert.ok(gfx.payload.default.includes('logo'));
    assert.equal(gfx.payload.default.includes('banner'), false);
  });

  it('+add and -remove work simultaneously', async () => {
    const db = makeDb();
    const store = makeStore({ default: ['logo', 'banner'] });
    const proc = makeProcessor(db, store);
    await proc(KEY, '<!-- graphics:+extra,-banner -->');
    const gfx = store.emitted.find(e => e.type === 'graphics');
    assert.ok(gfx.payload.default.includes('logo'));
    assert.ok(gfx.payload.default.includes('extra'));
    assert.equal(gfx.payload.default.includes('banner'), false);
  });

  it('unprefixed name in delta section treated as add', async () => {
    const db = makeDb();
    const store = makeStore({ default: ['logo'] });
    const proc = makeProcessor(db, store);
    // Mix of unprefixed + prefixed — triggers delta mode
    await proc(KEY, '<!-- graphics:extra,+another -->');
    const gfx = store.emitted.find(e => e.type === 'graphics');
    assert.ok(gfx.payload.default.includes('logo'));
    assert.ok(gfx.payload.default.includes('extra'));
    assert.ok(gfx.payload.default.includes('another'));
  });

  it('-name for non-existent item is a no-op (no error)', async () => {
    const db = makeDb();
    const store = makeStore({ default: ['logo'] });
    const proc = makeProcessor(db, store);
    await proc(KEY, '<!-- graphics:-nonexistent -->');
    const gfx = store.emitted.find(e => e.type === 'graphics');
    assert.deepEqual(gfx.payload.default, ['logo']);
  });
});

// ---------------------------------------------------------------------------
// Viewport-specific sections
// ---------------------------------------------------------------------------

describe('caption-processor: viewport-specific sections', () => {
  it('targets a named viewport, default is null', async () => {
    const db = makeDb();
    const store = makeStore();
    const proc = makeProcessor(db, store);
    await proc(KEY, '<!-- graphics[vertical-left]:stanza -->');
    const gfx = store.emitted.find(e => e.type === 'graphics');
    assert.equal(gfx.payload.default, null);
    assert.deepEqual(gfx.payload.viewports['vertical-left'], ['stanza']);
  });

  it('targets multiple viewports with comma-separated list', async () => {
    const db = makeDb();
    const store = makeStore();
    const proc = makeProcessor(db, store);
    await proc(KEY, '<!-- graphics[v1,v2]:stanza -->');
    const gfx = store.emitted.find(e => e.type === 'graphics');
    assert.deepEqual(gfx.payload.viewports.v1, ['stanza']);
    assert.deepEqual(gfx.payload.viewports.v2, ['stanza']);
  });

  it('clears a viewport with empty section', async () => {
    const db = makeDb();
    const store = makeStore({ viewports: { 'vertical-right': ['logo'] } });
    const proc = makeProcessor(db, store);
    await proc(KEY, '<!-- graphics[vertical-right]: -->');
    const gfx = store.emitted.find(e => e.type === 'graphics');
    assert.deepEqual(gfx.payload.viewports['vertical-right'], []);
  });

  it('landscape alias resolves to landscape slot', async () => {
    const db = makeDb();
    const store = makeStore();
    const proc = makeProcessor(db, store);
    await proc(KEY, '<!-- graphics[landscape]:logo -->');
    const gfx = store.emitted.find(e => e.type === 'graphics');
    assert.ok('landscape' in gfx.payload.viewports);
    assert.deepEqual(gfx.payload.viewports.landscape, ['logo']);
  });

  it('default alias resolves to landscape slot', async () => {
    const db = makeDb();
    const store = makeStore();
    const proc = makeProcessor(db, store);
    await proc(KEY, '<!-- graphics[default]:logo -->');
    const gfx = store.emitted.find(e => e.type === 'graphics');
    assert.ok('landscape' in gfx.payload.viewports);
  });

  it('main alias resolves to landscape slot', async () => {
    const db = makeDb();
    const store = makeStore();
    const proc = makeProcessor(db, store);
    await proc(KEY, '<!-- graphics[main]:logo -->');
    const gfx = store.emitted.find(e => e.type === 'graphics');
    assert.ok('landscape' in gfx.payload.viewports);
  });

  it('viewport delta: +name adds to existing viewport state', async () => {
    const db = makeDb();
    const store = makeStore({ viewports: { 'vertical-left': ['stanza'] } });
    const proc = makeProcessor(db, store);
    await proc(KEY, '<!-- graphics[vertical-left]:+logo -->');
    const gfx = store.emitted.find(e => e.type === 'graphics');
    assert.ok(gfx.payload.viewports['vertical-left'].includes('stanza'));
    assert.ok(gfx.payload.viewports['vertical-left'].includes('logo'));
  });
});

// ---------------------------------------------------------------------------
// Combined default + viewport in one caption
// ---------------------------------------------------------------------------

describe('caption-processor: combined metacodes', () => {
  it('default section and viewport-specific section coexist', async () => {
    const db = makeDb();
    const store = makeStore();
    const proc = makeProcessor(db, store);
    await proc(KEY, '<!-- graphics:logo --><!-- graphics[vertical-left]:stanza -->Hello');
    const gfx = store.emitted.find(e => e.type === 'graphics');
    assert.deepEqual(gfx.payload.default, ['logo']);
    assert.deepEqual(gfx.payload.viewports['vertical-left'], ['stanza']);
  });
});

// ---------------------------------------------------------------------------
// Clean text extraction
// ---------------------------------------------------------------------------

describe('caption-processor: clean text', () => {
  it('strips default metacode and returns clean text', async () => {
    const db = makeDb();
    const store = makeStore();
    const proc = makeProcessor(db, store);
    const out = await proc(KEY, '<!-- graphics:logo -->Hello world');
    assert.equal(out, 'Hello world');
  });

  it('strips viewport metacode and returns clean text', async () => {
    const db = makeDb();
    const store = makeStore();
    const proc = makeProcessor(db, store);
    const out = await proc(KEY, '<!-- graphics[v1]:logo -->Hello');
    assert.equal(out, 'Hello');
  });

  it('strips multiple metacodes', async () => {
    const db = makeDb();
    const store = makeStore();
    const proc = makeProcessor(db, store);
    const out = await proc(KEY, '<!-- graphics:a -->Hi <!-- graphics[v1]:b -->there');
    assert.equal(out, 'Hi there');
  });

  it('emits text SSE event when cleanText is non-empty', async () => {
    const db = makeDb();
    const store = makeStore();
    const proc = makeProcessor(db, store);
    await proc(KEY, '<!-- graphics:logo -->Hello');
    const textEvt = store.emitted.find(e => e.type === 'text');
    assert.ok(textEvt);
    assert.equal(textEvt.payload.text, 'Hello');
  });

  it('does NOT emit text SSE event when cleanText is empty', async () => {
    const db = makeDb();
    const store = makeStore();
    const proc = makeProcessor(db, store);
    await proc(KEY, '<!-- graphics:logo -->');
    assert.equal(store.emitted.filter(e => e.type === 'text').length, 0);
  });
});

// ---------------------------------------------------------------------------
// imageMeta from DB
// ---------------------------------------------------------------------------

describe('caption-processor: imageMeta', () => {
  it('populates imageMeta from caption_files settings_json', async () => {
    const db = makeDb();
    const settings = { viewports: { landscape: { visible: true, x: 0.5 } } };
    db.prepare(
      "INSERT INTO caption_files (api_key, shorthand, filename, mime_type, settings_json, type) VALUES (?, ?, ?, ?, ?, 'image')"
    ).run(KEY, 'logo', 'logo.png', 'image/png', JSON.stringify(settings));

    const store = makeStore();
    const proc = makeProcessor(db, store);
    await proc(KEY, '<!-- graphics:logo -->');
    const gfx = store.emitted.find(e => e.type === 'graphics');
    assert.ok(gfx.payload.imageMeta.logo, 'imageMeta has logo entry');
    assert.deepEqual(gfx.payload.imageMeta.logo.landscape, settings.viewports.landscape);
  });

  it('imageMeta is empty object for unknown names', async () => {
    const db = makeDb();
    const store = makeStore();
    const proc = makeProcessor(db, store);
    await proc(KEY, '<!-- graphics:unknownname -->');
    const gfx = store.emitted.find(e => e.type === 'graphics');
    assert.deepEqual(gfx.payload.imageMeta, {});
  });
});

// ---------------------------------------------------------------------------
// relayManager integration
// ---------------------------------------------------------------------------

describe('caption-processor: relayManager', () => {
  it('calls relayManager.setDskOverlay when default section is non-null', async () => {
    const db = makeDb();
    db.prepare(
      "INSERT INTO caption_files (api_key, shorthand, filename, mime_type, settings_json, type) VALUES (?, ?, ?, ?, ?, 'image')"
    ).run(KEY, 'logo', 'logo.png', 'image/png', null);

    const store = makeStore();
    const calls = [];
    const relayManager = {
      setDskOverlay(key, names, paths) {
        calls.push({ key, names, paths });
        return Promise.resolve();
      },
    };

    const proc = makeProcessor(db, store, relayManager);
    await proc(KEY, '<!-- graphics:logo -->');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].key, KEY);
    assert.deepEqual(calls[0].names, ['logo']);
  });

  it('excludes SVG images from relay overlay paths', async () => {
    const db = makeDb();
    db.prepare(
      "INSERT INTO caption_files (api_key, shorthand, filename, mime_type, settings_json, type) VALUES (?, ?, ?, ?, ?, 'image')"
    ).run(KEY, 'icon', 'icon.svg', 'image/svg+xml', null);

    const store = makeStore();
    const calls = [];
    const relayManager = {
      setDskOverlay(key, names, paths) {
        calls.push({ key, names, paths });
        return Promise.resolve();
      },
    };

    const proc = makeProcessor(db, store, relayManager);
    await proc(KEY, '<!-- graphics:icon -->');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].paths.length, 0); // SVG excluded
  });

  it('does not call relayManager when default section is null (viewport-only)', async () => {
    const db = makeDb();
    const store = makeStore();
    const calls = [];
    const relayManager = {
      setDskOverlay(key, names, paths) {
        calls.push({ key, names, paths });
        return Promise.resolve();
      },
    };

    const proc = makeProcessor(db, store, relayManager);
    await proc(KEY, '<!-- graphics[vertical-left]:logo -->');
    assert.equal(calls.length, 0);
  });
});
