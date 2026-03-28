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

  it('handles audioCapture by advancing pointer', async () => {
    const file = makeFile(['', '', 'Line A'], [{}, { audioCapture: 'start' }, {}], [1,2,3]);
    const store = makeFileStore([file]);
    const timerRef = { current: null };
    const handleSendRef = { current: null };
    const res = await drainActions({ file, startPtr: 0, fileStore: store, timerRef, handleSendRef, showToast: () => {}, session: {} });
    // audioCapture should be skipped and we should land on the 'Line A' index
    assert.equal(res.status, 'continue');
    assert.equal(res.pointer, 2);
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

  it('maps cue phrases to their line indices', () => {
    const file = makeFile(
      ['Let us pray', 'Line 1', 'Hallelujah!', 'Line 2'],
      [{ cue: 'Amen' }, {}, { cue: 'Hallelujah' }, {}],
      [1, 2, 3, 4]
    );
    const map = buildCueMap(file);
    assert.equal(map.size, 2);
    assert.equal(map.get('amen'), 0);
    assert.equal(map.get('hallelujah'), 2);
  });

  it('stores phrases in lowercase', () => {
    const file = makeFile([''], [{ cue: 'AMEN' }], [1]);
    const map = buildCueMap(file);
    assert.ok(map.has('amen'));
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
    const map = new Map([['amen', 0]]);
    assert.equal(checkCueMatch(map, ''), null);
    assert.equal(checkCueMatch(map, null), null);
  });

  it('matches when text contains the cue phrase', () => {
    const map = new Map([['amen', 3]]);
    const result = checkCueMatch(map, 'And all the people said Amen!');
    assert.ok(result);
    assert.equal(result.phrase, 'amen');
    assert.equal(result.index, 3);
  });

  it('match is case-insensitive', () => {
    const map = new Map([['hallelujah', 5]]);
    const result = checkCueMatch(map, 'HALLELUJAH!');
    assert.ok(result);
    assert.equal(result.index, 5);
  });

  it('returns null when text does not contain phrase', () => {
    const map = new Map([['amen', 0]]);
    assert.equal(checkCueMatch(map, 'Hello world'), null);
  });

  it('returns the first matching cue', () => {
    const map = new Map([['amen', 2], ['prayer', 5]]);
    const result = checkCueMatch(map, 'Let us say amen in prayer');
    assert.ok(result);
    // Map iteration order is insertion order — 'amen' comes first
    assert.equal(result.phrase, 'amen');
    assert.equal(result.index, 2);
  });
});
