import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CueEngine, readContextSettings, semanticCandidates, MAX_CONTEXT_LINES } from '../src/cue-engine.js';

// Lines stay under 3 words so the fuzzy-word fallback (needs >= pattern length) cannot match.
// Bag-of-two-words embedder: pattern "prayer for healing" = [1,1]; a text with
// only one of the words scores cos ~0.71 (< 0.75), with both words ~1.0.
const embed = async texts => texts.map(t => {
  const w = String(t).toLowerCase();
  return [w.includes('prayer') ? 1 : 0, w.includes('healing') ? 1 : 0, 0.0001];
});

function engineWith(cue) {
  const engine = new CueEngine({});
  engine.setEmbeddingFn(embed);
  engine.setInlineSnapshot('k', { cues: [{ phrase: 'prayer for healing', matchType: 'semantic', action: { type: 'event', label: 'x' }, ...cue }] });
  return engine;
}
async function feed(engine, lines) {
  let fired = [];
  for (const line of lines) {
    engine.pushContextLine('k', line);
    fired = await engine.evaluateInlineCues('k', line);
  }
  return fired;
}

describe('semantic cue context', () => {
  test('default (line) ignores earlier lines', async () => {
    const fired = await feed(engineWith({}), ['a prayer', 'healing now']);
    assert.equal(fired.length, 0);
  });

  test('window matches an idea spread over the last N lines', async () => {
    const fired = await feed(engineWith({ context_mode: 'window', context_segments: 2 }), ['a prayer', 'healing now']);
    assert.equal(fired.length, 1);
  });

  test('window of 1 line behaves like line; older lines fall out of the window', async () => {
    assert.equal((await feed(engineWith({ context_mode: 'window', context_segments: 2 }), ['a prayer', 'amen', 'healing now'])).length, 0);
    assert.equal((await feed(engineWith({ context_mode: 'window', context_segments: 1 }), ['a prayer', 'healing now'])).length, 0);
  });

  test('both fires on a single strong line as well as on the window', async () => {
    const e = engineWith({ context_mode: 'both', context_segments: 3 });
    assert.equal((await feed(e, ['prayer for healing now'])).length, 1);
    assert.equal((await feed(engineWith({ context_mode: 'both' }), ['a prayer', 'healing'])).length, 1);
  });

  test('composite semantic leaf honours contextMode', async () => {
    const engine = new CueEngine({});
    engine.setEmbeddingFn(embed);
    engine.pushContextLine('k', 'a prayer');
    engine.pushContextLine('k', 'for healing');
    const leaf = { type: 'match', matchType: 'semantic', pattern: 'prayer for healing' };
    const ctx = { text: 'for healing', apiKey: 'k' };
    assert.equal((await engine.evaluateComposite('k', leaf, ctx)).matched, false);
    assert.equal((await engine.evaluateComposite('k', { ...leaf, contextMode: 'window' }, ctx)).matched, true);
  });

  test('settings are clamped and buffer is bounded', () => {
    assert.deepEqual(readContextSettings({}), { mode: 'line', segments: 3 });
    assert.deepEqual(readContextSettings({ context_mode: 'bogus', context_segments: 999 }), { mode: 'line', segments: MAX_CONTEXT_LINES });
    assert.equal(readContextSettings({ contextSegments: 0 }).segments, 1);
    const engine = new CueEngine({});
    for (let i = 0; i < MAX_CONTEXT_LINES + 5; i++) engine.pushContextLine('k', `l${i}`);
    assert.equal(engine._recentLines.get('k').length, MAX_CONTEXT_LINES);
    engine.clearContext('k');
    assert.equal(engine._recentLines.has('k'), false);
  });

  test('semanticCandidates appends the current line when the buffer lacks it', () => {
    assert.deepEqual(semanticCandidates('c', ['a', 'b'], { context_mode: 'window', context_segments: 3 }), ['a b c']);
  });
});
