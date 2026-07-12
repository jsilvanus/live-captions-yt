import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RESERVED_METACODES, BOOLEAN_CODES, isReservedName, isReservedActionable,
  extractPersistentCodes,
} from '../src/lib/metacode-registry.js';

describe('metacode registry', () => {
  it('derives BOOLEAN_CODES from boolean entries', () => {
    assert.deepEqual([...BOOLEAN_CODES].sort(), ['lyrics', 'no-translate']);
  });

  it('isReservedName covers actions, persistent codes, and dedicated lexers', () => {
    for (const n of ['audio', 'timer', 'goto', 'file', 'file[server]', 'cue', 'api', 'section', 'speaker', 'lang', 'lyrics']) {
      assert.equal(isReservedName(n), true, n);
    }
    assert.equal(isReservedName('weather'), false);
    assert.equal(isReservedName('SECTION'), true); // case-insensitive
  });

  it('isReservedActionable is true only for action-kind names', () => {
    for (const n of ['audio', 'timer', 'goto', 'file', 'file[server]', 'cue', 'api']) {
      assert.equal(isReservedActionable(n), true, n);
    }
    // persistent codes are ordinary variables, not actionable
    for (const n of ['section', 'speaker', 'lang', 'lyrics', 'explanation', 'weather']) {
      assert.equal(isReservedActionable(n), false, n);
    }
  });

  it('action entries expose an apply() that writes the expected field', () => {
    const a = {};
    RESERVED_METACODES.audio.apply('start', a);
    RESERVED_METACODES.timer.apply('500ms', a);
    RESERVED_METACODES.goto.apply('42', a);
    RESERVED_METACODES.file.apply('Act 2.txt', a);
    assert.deepEqual(a, { audioCapture: 'start', timer: 0.5, goto: 42, fileSwitch: 'Act 2.txt' });
  });

  it('apply() ignores invalid action values', () => {
    const a = {};
    RESERVED_METACODES.audio.apply('pause', a); // not start/stop
    RESERVED_METACODES.goto.apply('0', a);      // not > 0
    RESERVED_METACODES.file.apply('', a);       // empty
    assert.deepEqual(a, {});
  });

  it('extractPersistentCodes keeps variables, drops action outputs and markers', () => {
    const codes = {
      section: 'Prayer', speaker: 'Alice', lyrics: true, custom: 'x',
      audioCapture: 'start', timer: 5, goto: 3, fileSwitch: 'a.txt', fileSwitchServer: '/f',
      cue: 'Amen', cueMode: 'next', apiTriggers: [{}], emptySend: true, emptySendLabel: 'L',
      codeTtls: { section: {} },
    };
    assert.deepEqual(extractPersistentCodes(codes), {
      section: 'Prayer', speaker: 'Alice', lyrics: true, custom: 'x',
    });
    assert.deepEqual(extractPersistentCodes(null), {});
  });
});
