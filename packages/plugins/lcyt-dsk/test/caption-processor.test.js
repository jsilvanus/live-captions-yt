import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import { createDskCaptionProcessor } from '../src/caption-processor.js';

test('caption-processor includes imageMeta from settings_json and skips disabled images', async (t) => {
  // Setup in-memory DB with caption_files table
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE caption_files (
      id INTEGER PRIMARY KEY,
      api_key TEXT,
      shorthand TEXT,
      filename TEXT,
      mime_type TEXT,
      settings_json TEXT,
      type TEXT
    );
  `);

  const apiKey = 'testkey';
  const settings = { viewports: { landscape: { visible: false, position: { x: 0.9, y: 0.98 } } } };
  db.prepare("INSERT INTO caption_files (api_key, shorthand, filename, mime_type, settings_json, type) VALUES (?, ?, ?, ?, ?, 'image')")
    .run(apiKey, 'logo', 'logo.png', 'image/png', JSON.stringify(settings));

  // Minimal store that records emitted events
  const emitted = [];
  const store = {
    _state: { default: [], viewports: {} },
    getDskGraphicsState(apiKey) { return this._state; },
    setDskGraphicsState(apiKey, s) { this._state = s; },
    emitDskEvent(apiKey, type, payload) { emitted.push({ apiKey, type, payload }); },
  };

  const proc = createDskCaptionProcessor({ db, store, relayManager: null });

  const out = await proc(apiKey, '<!-- graphics:logo -->Hello world');

  // Ensure returned text is cleaned
  assert.equal(out, 'Hello world');

  // Find the graphics event
  const gfx = emitted.find(e => e.type === 'graphics');
  assert(gfx, 'graphics event emitted');
  assert(gfx.payload.imageMeta, 'imageMeta included in payload');
  assert(gfx.payload.imageMeta.logo, 'meta for logo present');
  // The meta should contain viewports object with landscape override we stored
  assert.deepEqual(gfx.payload.imageMeta.logo.landscape, settings.viewports.landscape);
});
