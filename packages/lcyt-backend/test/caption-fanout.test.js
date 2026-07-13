/**
 * Tests for createCaptionFanout — shared extra-target delivery used by both
 * POST /captions and server-STT's _deliverTranscript.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

import { initDb, createKey } from '../src/db.js';
import { createCaptionTarget } from '../src/db/caption-targets.js';
import { createTranslationTarget } from '../src/db/translation-config.js';
import { createCaptionFanout } from '../src/caption-fanout.js';
import { viewerKeyOwners } from '../src/routes/viewer.js';

let db, fanOut;

before(() => {
  db = initDb(':memory:');
  createKey(db, { key: 'fanout-key', owner: 'Fanout' });
  fanOut = createCaptionFanout({ db });
});

after(() => db.close());

function makeSession(extraTargets) {
  return { apiKey: 'fanout-key', domain: 'https://fanout.test', sequence: 7, extraTargets };
}

describe('createCaptionFanout', () => {
  it('sends default composed text to unrouted YouTube targets', async () => {
    const sends = [];
    const session = makeSession([
      { id: 'yt1', type: 'youtube', sender: { send: async (text, ts) => { sends.push({ text, ts }); } } },
    ]);

    fanOut(session, [{ text: 'Original', composedText: 'Composed', timestamp: '2026-02-20T12:00:00.000' }]);
    await new Promise(r => setTimeout(r, 10));

    assert.equal(sends.length, 1);
    assert.equal(sends[0].text, 'Composed');
    assert.equal(sends[0].ts, '2026-02-20T12:00:00.000');
  });

  it('re-composes per routed translation target (YouTube)', async () => {
    const target = createCaptionTarget(db, 'fanout-key', { type: 'youtube', streamKey: 'sk-routed' });
    assert.ok(target.ok, target.error);
    const routed = createTranslationTarget(db, 'fanout-key', {
      lang: 'fi-FI', target: 'captions', captionTargetId: target.target.id, showOriginal: false,
    });
    assert.ok(routed.ok, routed.error);

    const sends = [];
    const session = makeSession([
      { id: target.target.id, type: 'youtube', sender: { send: async (text) => { sends.push(text); } } },
    ]);

    fanOut(session, [{
      text: 'Hello', composedText: 'Hello',
      translations: { 'fi-FI': 'Hei' },
    }]);
    await new Promise(r => setTimeout(r, 10));

    assert.deepEqual(sends, ['Hei']);
  });

  it('computes default composition when composedText is absent (server-STT case)', async () => {
    const sends = [];
    const session = makeSession([
      { id: 'yt2', type: 'youtube', sender: { send: async (text) => { sends.push(text); } } },
    ]);

    fanOut(session, [{
      text: 'Hello',
      captionLang: 'sv-SE',
      showOriginal: true,
      translations: { 'sv-SE': 'Hej' },
    }]);
    await new Promise(r => setTimeout(r, 10));

    assert.deepEqual(sends, ['Hello<br>Hej']);
  });

  it('posts the full payload to generic targets and registers viewer key owners', async () => {
    const fetchCalls = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => { fetchCalls.push({ url, body: JSON.parse(opts.body) }); return { ok: true }; };

    try {
      const session = makeSession([
        { id: 'g1', type: 'generic', url: 'https://downstream.test/hook', headers: { 'X-Custom': '1' } },
        { id: 'v1', type: 'viewer', viewerKey: 'fanout-viewer' },
      ]);

      fanOut(session, [{
        text: 'Hello', composedText: 'Hej',
        timestamp: new Date('2026-02-20T12:00:00.000Z'),
        translations: { 'sv-SE': 'Hej' }, captionLang: 'sv-SE', showOriginal: false,
        codes: { section: 'intro' },
      }]);
      await new Promise(r => setTimeout(r, 10));

      assert.equal(fetchCalls.length, 1);
      const { body } = fetchCalls[0];
      assert.equal(body.source, 'https://fanout.test');
      assert.equal(body.sequence, 7);
      assert.equal(body.captions.length, 1);
      assert.equal(body.captions[0].text, 'Hello');
      assert.equal(body.captions[0].composedText, 'Hej');
      assert.equal(body.captions[0].timestamp, '2026-02-20T12:00:00.000Z');
      assert.deepEqual(body.captions[0].translations, { 'sv-SE': 'Hej' });
      assert.deepEqual(body.captions[0].codes, { section: 'intro' });

      // Viewer arm registers stats attribution — previously missing in STT mode
      assert.equal(viewerKeyOwners.get('fanout-viewer'), 'fanout-key');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('is a no-op for sessions without extra targets', () => {
    assert.doesNotThrow(() => fanOut(makeSession([]), [{ text: 'x' }]));
    assert.doesNotThrow(() => fanOut(makeSession(null), [{ text: 'x' }]));
    assert.doesNotThrow(() => fanOut(makeSession([{ id: 'v', type: 'viewer', viewerKey: 'k' }]), []));
  });
});
