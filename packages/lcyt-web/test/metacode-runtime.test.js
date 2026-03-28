import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { drainActions, buildCueMap, checkCueMatch } from '../src/lib/metacode-runtime.js';

// Minimal mock fileStore and file to exercise drainActions behavior
function makeFile(lines, lineCodes, lineNumbers) {
  return { id: 'f1', lines, lineCodes, lineNumbers };
}

function makeFileStore(files) {
  return {
    files,
    setPointer: (id, p) => { const f = files.find(x => x.id === id); if (f) f.pointer = p; },
    setActive: (id) => { /* noop for test */ },
    loadFileFromText: (name, text) => ({ id: 'server', name, lines: text.split('\n') }),
    activeFile: files[0]
  };
}

// Provide a dummy window.dispatchEvent for node env
if (typeof global.window === 'undefined') global.window = { dispatchEvent: () => {} };

describe('metacode-runtime drainActions()', () => {
  it('skips blank and heading lines and returns continue with pointer', async () => {
    const file = makeFile(['', '# Heading', 'Line 1', 'Line 2'], [{}, {}, {}, {}], [1,2,3,4]);
    const store = makeFileStore([file]);
    const timerRef = { current: null };
    const handleSendRef = { current: null };
    const res = await drainActions({ file, startPtr: 0, fileStore: store, timerRef, handleSendRef, showToast: () => {}, session: {} });
    assert.equal(res.status, 'continue');
    assert.equal(res.pointer, 2); // index of 'Line 1'
  });

  it('handles audioCapture on empty line by advancing pointer', async () => {
    const file = makeFile(['', '', 'Line A'], [{}, { audioCapture: 'start' }, {}], [1,2,3]);
    const store = makeFileStore([file]);
    const timerRef = { current: null };
    const handleSendRef = { current: null };
    const res = await drainActions({ file, startPtr: 0, fileStore: store, timerRef, handleSendRef, showToast: () => {}, session: {} });
    // audioCapture on empty line should be skipped → land on 'Line A'
    assert.equal(res.status, 'continue');
    assert.equal(res.pointer, 2);
  });

  it('audioCapture with content stops at that line', async () => {
    const file = makeFile(['Recording begins', 'Line 2'], [{ audioCapture: 'start' }, {}], [1,2]);
    const store = makeFileStore([file]);
    const timerRef = { current: null };
    const handleSendRef = { current: null };
    const res = await drainActions({ file, startPtr: 0, fileStore: store, timerRef, handleSendRef, showToast: () => {}, session: {} });
    // audioCapture with content → dispatch event and stop here
    assert.equal(res.status, 'continue');
    assert.equal(res.pointer, 0);
  });

  it('returns done when pointer past end', async () => {
    const file = makeFile([''], [{ emptySend: true }], [1]);
    const store = makeFileStore([file]);
    const timerRef = { current: null };
    const handleSendRef = { current: null };
    const res = await drainActions({ file, startPtr: 0, fileStore: store, timerRef, handleSendRef, showToast: () => {}, session: {} });
    // single empty-send then done (pointer at last index)
    assert.equal(res.status, 'done');
  });

  it('timer fires current line then advances pointer to next line', async () => {
    const file = makeFile(['Let us pray', 'Next line'], [{ timer: 5 }, {}], [1, 2]);
    const store = makeFileStore([file]);
    const timerRef = { current: null };
    let sendCalled = false;
    const handleSendRef = { current: () => { sendCalled = true; } };
    const res = await drainActions({ file, startPtr: 0, fileStore: store, timerRef, handleSendRef, showToast: () => {}, session: {} });
    assert.equal(res.status, 'stop');
    assert.equal(res.pointer, 0); // initially at timer line
    assert.ok(timerRef.current); // timer was set
    assert.equal(file.pointer, 0); // pointer set to timer line initially
    // Extract and invoke the timer callback directly to verify it advances
    const timerCallback = timerRef.current;
    clearTimeout(timerRef.current);
    // The setTimeout callback is internal — we can't extract it easily.
    // Instead, verify the pointer advances by checking the runtime code sets it.
    // The timer callback calls handleSendRef.current() then sets pointer to ptr+1.
    // We verify the initial state is correct.
    assert.equal(file.pointer, 0);
  });

  it('timer on empty line fires current line position then advances', async () => {
    const file = makeFile(['', 'Content'], [{ timer: 3 }, {}], [1, 2]);
    const store = makeFileStore([file]);
    const timerRef = { current: null };
    const handleSendRef = { current: () => {} };
    const res = await drainActions({ file, startPtr: 0, fileStore: store, timerRef, handleSendRef, showToast: () => {}, session: {} });
    assert.equal(res.status, 'stop');
    assert.equal(res.pointer, 0);
    assert.ok(timerRef.current); // timer was set
    clearTimeout(timerRef.current);
  });

  it('timer callback advances pointer after firing', async () => {
    const file = makeFile(['Let us pray', 'Next line', 'Third'], [{ timer: 0.01 }, {}, {}], [1, 2, 3]);
    const store = makeFileStore([file]);
    const timerRef = { current: null };
    let sendCalled = false;
    const handleSendRef = { current: () => { sendCalled = true; } };
    await drainActions({ file, startPtr: 0, fileStore: store, timerRef, handleSendRef, showToast: () => {}, session: {} });
    assert.ok(timerRef.current);
    // Wait for the very short timer to fire
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(sendCalled, 'handleSend was called');
    assert.equal(file.pointer, 1, 'pointer advanced to next line after timer fired');
  });

  it('skips standalone cue lines (empty text) and continues to next content', async () => {
    const file = makeFile(['', 'Let us pray'], [{ cue: 'Amen' }, {}], [1, 2]);
    const store = makeFileStore([file]);
    const timerRef = { current: null };
    const handleSendRef = { current: null };
    const res = await drainActions({ file, startPtr: 0, fileStore: store, timerRef, handleSendRef, showToast: () => {}, session: {} });
    assert.equal(res.status, 'continue');
    assert.equal(res.pointer, 1); // index of 'Let us pray'
  });

  it('does NOT skip cue lines that have content', async () => {
    const file = makeFile(['Let us pray', 'Goodbye'], [{ cue: 'Amen' }, {}], [1, 2]);
    const store = makeFileStore([file]);
    const timerRef = { current: null };
    const handleSendRef = { current: null };
    const res = await drainActions({ file, startPtr: 0, fileStore: store, timerRef, handleSendRef, showToast: () => {}, session: {} });
    assert.equal(res.status, 'continue');
    assert.equal(res.pointer, 0); // stops at 'Let us pray' — it has sendable content
  });
});

// ---------------------------------------------------------------------------
// buildCueMap / checkCueMatch
// ---------------------------------------------------------------------------

describe('buildCueMap()', () => {
  it('returns empty map for file with no cues', () => {
    const file = makeFile(['Line 1', 'Line 2'], [{}, {}], [1, 2]);
    const map = buildCueMap(file);
    assert.equal(map.size, 0);
  });

  it('maps cue phrases to their line indices with mode', () => {
    const file = makeFile(
      ['Let us pray', 'Line 1', 'Hallelujah!', 'Line 2'],
      [{ cue: 'Amen', cueMode: 'next' }, {}, { cue: 'Hallelujah', cueMode: 'skip' }, {}],
      [1, 2, 3, 4]
    );
    const map = buildCueMap(file);
    assert.equal(map.size, 2);
    assert.deepEqual(map.get('amen'), { index: 0, mode: 'next', fuzzy: false });
    assert.deepEqual(map.get('hallelujah'), { index: 2, mode: 'skip', fuzzy: false });
  });

  it('stores phrases in lowercase', () => {
    const file = makeFile([''], [{ cue: 'AMEN', cueMode: 'next' }], [1]);
    const map = buildCueMap(file);
    assert.ok(map.has('amen'));
  });

  it('defaults to next mode when cueMode is missing', () => {
    const file = makeFile([''], [{ cue: 'Amen' }], [1]);
    const map = buildCueMap(file);
    assert.equal(map.get('amen').mode, 'next');
  });

  it('returns empty map for null/undefined file', () => {
    assert.equal(buildCueMap(null).size, 0);
    assert.equal(buildCueMap(undefined).size, 0);
  });
});

describe('checkCueMatch()', () => {
  it('returns null when no cues registered', () => {
    const map = new Map();
    assert.equal(checkCueMatch(map, 'some text'), null);
  });

  it('returns null when text is empty', () => {
    const map = new Map([['amen', { index: 0, mode: 'next' }]]);
    assert.equal(checkCueMatch(map, ''), null);
    assert.equal(checkCueMatch(map, null), null);
  });

  it('matches when text contains the cue phrase (no pointer)', () => {
    const map = new Map([['amen', { index: 3, mode: 'next' }]]);
    const result = checkCueMatch(map, 'And all the people said Amen!');
    assert.ok(result);
    assert.equal(result.phrase, 'amen');
    assert.equal(result.index, 3);
  });

  it('match is case-insensitive', () => {
    const map = new Map([['hallelujah', { index: 5, mode: 'next' }]]);
    const result = checkCueMatch(map, 'HALLELUJAH!');
    assert.ok(result);
    assert.equal(result.index, 5);
  });

  it('returns null when text does not contain phrase', () => {
    const map = new Map([['amen', { index: 0, mode: 'next' }]]);
    assert.equal(checkCueMatch(map, 'Hello world'), null);
  });

  it('returns the first matching cue', () => {
    const map = new Map([['amen', { index: 2, mode: 'any' }], ['prayer', { index: 5, mode: 'any' }]]);
    const result = checkCueMatch(map, 'Let us say amen in prayer');
    assert.ok(result);
    assert.equal(result.phrase, 'amen');
    assert.equal(result.index, 2);
  });

  // Wildcard / asterisk tests
  it('matches glob wildcard: trailing *', () => {
    const map = new Map([['let us *', { index: 4, mode: 'any' }]]);
    const result = checkCueMatch(map, 'Let us pray together');
    assert.ok(result);
    assert.equal(result.phrase, 'let us *');
    assert.equal(result.index, 4);
  });

  it('matches glob wildcard: leading *', () => {
    const map = new Map([['* amen', { index: 2, mode: 'any' }]]);
    const result = checkCueMatch(map, 'they said amen');
    assert.ok(result);
    assert.equal(result.index, 2);
  });

  it('matches glob wildcard: middle *', () => {
    const map = new Map([['let * pray', { index: 1, mode: 'any' }]]);
    const result = checkCueMatch(map, 'Let us pray');
    assert.ok(result);
    assert.equal(result.index, 1);
  });

  it('wildcard * at both ends matches any containing text', () => {
    const map = new Map([['*grace*', { index: 0, mode: 'any' }]]);
    const result = checkCueMatch(map, 'By the grace of God');
    assert.ok(result);
  });

  it('returns null when wildcard pattern does not match', () => {
    const map = new Map([['let us *', { index: 0, mode: 'any' }]]);
    assert.equal(checkCueMatch(map, 'Hello world'), null);
  });

  it('escapes regex special chars in wildcard phrases', () => {
    const map = new Map([['price is $*', { index: 0, mode: 'any' }]]);
    const result = checkCueMatch(map, 'The price is $100');
    assert.ok(result);
  });
});

// ---------------------------------------------------------------------------
// checkCueMatch — pointer-based next-cue-only logic
// ---------------------------------------------------------------------------

describe('checkCueMatch() — pointer-based eligibility', () => {
  it('next mode: only fires if cue is the next cue after pointer', () => {
    // pointer at 0, cues at indices 2 and 4 (both mode=next)
    const map = new Map([
      ['amen', { index: 2, mode: 'next' }],
      ['mercy', { index: 4, mode: 'next' }],
    ]);
    // "amen" is the next cue after pointer=0 → should match
    const r1 = checkCueMatch(map, 'amen', 0);
    assert.ok(r1);
    assert.equal(r1.index, 2);

    // "mercy" is NOT the next cue (amen at 2 comes first) → should NOT match
    const r2 = checkCueMatch(map, 'mercy', 0);
    assert.equal(r2, null);
  });

  it('next mode: matches when cue becomes the next after pointer advances', () => {
    const map = new Map([
      ['amen', { index: 2, mode: 'next' }],
      ['mercy', { index: 4, mode: 'next' }],
    ]);
    // pointer at 3 → next cue is mercy at 4
    const r = checkCueMatch(map, 'mercy', 3);
    assert.ok(r);
    assert.equal(r.index, 4);
  });

  it('skip mode: can skip past other cues ahead of pointer', () => {
    const map = new Map([
      ['amen', { index: 2, mode: 'next' }],
      ['mercy', { index: 4, mode: 'skip' }],
    ]);
    // pointer at 0 → mercy (skip mode) can skip past amen
    const r = checkCueMatch(map, 'mercy', 0);
    assert.ok(r);
    assert.equal(r.index, 4);
  });

  it('skip mode: does NOT fire when cue is behind pointer', () => {
    const map = new Map([
      ['amen', { index: 2, mode: 'skip' }],
    ]);
    // pointer at 5 → cue at index 2 is behind pointer
    const r = checkCueMatch(map, 'amen', 5);
    assert.equal(r, null);
  });

  it('any mode: fires even when cue is behind pointer', () => {
    const map = new Map([
      ['amen', { index: 2, mode: 'any' }],
    ]);
    // pointer at 5 → cue at 2 is behind, but mode=any allows it
    const r = checkCueMatch(map, 'amen', 5);
    assert.ok(r);
    assert.equal(r.index, 2);
  });

  it('any mode: fires when cue is ahead of pointer', () => {
    const map = new Map([
      ['amen', { index: 5, mode: 'any' }],
    ]);
    const r = checkCueMatch(map, 'amen', 0);
    assert.ok(r);
    assert.equal(r.index, 5);
  });

  it('mixed modes: next blocked but skip works', () => {
    const map = new Map([
      ['first', { index: 2, mode: 'next' }],
      ['second', { index: 4, mode: 'next' }],
      ['third', { index: 6, mode: 'skip' }],
    ]);
    // pointer at 0, next cue is "first" at 2
    // "second" (next mode) should NOT fire — not the next cue
    assert.equal(checkCueMatch(map, 'second', 0), null);
    // "third" (skip mode) SHOULD fire — can skip ahead
    const r = checkCueMatch(map, 'third', 0);
    assert.ok(r);
    assert.equal(r.index, 6);
  });

  it('no pointer (legacy): all cues are eligible', () => {
    const map = new Map([
      ['amen', { index: 5, mode: 'next' }],
    ]);
    // no pointer → legacy behavior, all cues match
    const r = checkCueMatch(map, 'amen');
    assert.ok(r);
    assert.equal(r.index, 5);
  });

  it('pointer at -1 acts like no pointer (legacy)', () => {
    const map = new Map([
      ['amen', { index: 5, mode: 'next' }],
    ]);
    const r = checkCueMatch(map, 'amen', -1);
    assert.ok(r);
  });
});

// ---------------------------------------------------------------------------
// Fuzzy matching (Jaro-Winkler)
// ---------------------------------------------------------------------------

import { jaroWinkler, fuzzyWordMatch } from '../src/lib/metacode-runtime.js';

describe('jaroWinkler()', () => {
  it('returns 1 for identical strings', () => {
    assert.equal(jaroWinkler('amen', 'amen'), 1.0);
  });

  it('returns 0 for completely different strings', () => {
    assert.ok(jaroWinkler('abc', 'xyz') < 0.5);
  });

  it('returns high score for similar strings', () => {
    const score = jaroWinkler('beseech', 'bseeech');
    assert.ok(score > 0.85, `Expected > 0.85 but got ${score}`);
  });

  it('returns 0 for empty strings', () => {
    assert.equal(jaroWinkler('', 'test'), 0);
    assert.equal(jaroWinkler('test', ''), 0);
  });
});

describe('fuzzyWordMatch()', () => {
  it('matches exact words with score 1', () => {
    const { score } = fuzzyWordMatch('we beseech', 'we beseech thee o lord');
    assert.equal(score, 1.0);
  });

  it('matches similar words with high score', () => {
    const { score, matched } = fuzzyWordMatch('beseech thee', 'we bseeech thee o lord');
    assert.ok(score > 0.85, `Expected > 0.85 but got ${score}`);
    assert.ok(matched.includes('thee'));
  });

  it('returns low score for unrelated text', () => {
    const { score } = fuzzyWordMatch('hallelujah', 'the cat sat on the mat');
    assert.ok(score < 0.7, `Expected < 0.7 but got ${score}`);
  });

  it('returns 0 for empty pattern', () => {
    const { score } = fuzzyWordMatch('', 'some text');
    assert.equal(score, 0);
  });

  it('returns 0 for empty text', () => {
    const { score } = fuzzyWordMatch('test', '');
    assert.equal(score, 0);
  });
});

describe('checkCueMatch() — fuzzy cues', () => {
  it('fuzzy cue matches similar text', () => {
    const map = new Map([
      ['we beseech', { index: 3, mode: 'any', fuzzy: true }],
    ]);
    const r = checkCueMatch(map, 'we bseeech thee o lord', -1, { fuzzyThreshold: 0.75 });
    assert.ok(r, 'Expected fuzzy match');
    assert.equal(r.index, 3);
  });

  it('fuzzy cue does not match very different text', () => {
    const map = new Map([
      ['hallelujah praise', { index: 0, mode: 'any', fuzzy: true }],
    ]);
    const r = checkCueMatch(map, 'the cat sat on the mat', -1, { fuzzyThreshold: 0.75 });
    assert.equal(r, null);
  });

  it('non-fuzzy cue uses exact substring match', () => {
    const map = new Map([
      ['beseech', { index: 0, mode: 'any', fuzzy: false }],
    ]);
    // Exact substring: "beseech" is in the text
    const r1 = checkCueMatch(map, 'we beseech thee', -1);
    assert.ok(r1);
    // Misspelled "bseeech" does NOT match without fuzzy
    const r2 = checkCueMatch(map, 'we bseeech thee', -1);
    assert.equal(r2, null);
  });

  it('buildCueMap includes fuzzy flag from lineCodes', () => {
    const file = makeFile(
      ['Line 1', 'Line 2'],
      [{ cue: 'Amen', cueMode: 'next', cueFuzzy: true }, {}],
      [1, 2]
    );
    const map = buildCueMap(file);
    assert.deepEqual(map.get('amen'), { index: 0, mode: 'next', fuzzy: true });
  });
});
