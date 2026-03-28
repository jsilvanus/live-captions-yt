import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { drainActions } from '../src/lib/metacode-runtime.js';

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
});
