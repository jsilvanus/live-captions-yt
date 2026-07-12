import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseActionItems, expandActionItems, applyAtoms } from '../src/lib/metacode-actions.js';
import { parseFileContent } from '../src/lib/metacode-parser.js';

describe('parseActionItems', () => {
  it('parses a single atom', () => {
    assert.deepEqual(parseActionItems('audio:start'), [{ metacode: 'audio', value: 'start' }]);
  });

  it('parses a | composite in order, mixing atoms and @refs', () => {
    assert.deepEqual(parseActionItems('audio:start | graphics:+banner | @intro'), [
      { metacode: 'audio', value: 'start' },
      { metacode: 'graphics', value: '+banner' },
      { ref: 'intro' },
    ]);
  });

  it('splits each atom on its first colon (values keep later colons)', () => {
    assert.deepEqual(parseActionItems('section:Prayer => 20s:Hymn'), [
      { metacode: 'section', value: 'Prayer => 20s:Hymn' },
    ]);
  });

  it('lowercases the metacode key and ignores blanks / keyless atoms', () => {
    assert.deepEqual(parseActionItems('AUDIO:start | | :nokey | @'), [
      { metacode: 'audio', value: 'start' },
    ]);
  });

  it('returns [] for empty/nullish input', () => {
    assert.deepEqual(parseActionItems(''), []);
    assert.deepEqual(parseActionItems(null), []);
  });
});

describe('expandActionItems', () => {
  const defs = {
    intro: [{ metacode: 'audio', value: 'start' }, { metacode: 'graphics', value: '+banner' }],
    nested: [{ ref: 'intro' }, { metacode: 'section', value: 'Intro' }],
    loopA: [{ ref: 'loopB' }],
    loopB: [{ ref: 'loopA' }, { metacode: 'audio', value: 'stop' }],
  };
  const resolve = (name) => defs[name] || null;

  it('flattens atoms in order, resolving refs (nesting)', () => {
    const items = parseActionItems('@nested | api:cam.preset1');
    assert.deepEqual(expandActionItems(items, resolve), [
      { metacode: 'audio', value: 'start' },
      { metacode: 'graphics', value: '+banner' },
      { metacode: 'section', value: 'Intro' },
      { metacode: 'api', value: 'cam.preset1' },
    ]);
  });

  it('drops the offending ref on a cycle and warns, keeping other atoms', () => {
    const warnings = [];
    const out = expandActionItems([{ ref: 'loopA' }], resolve, (m) => warnings.push(m));
    // loopA -> loopB -> (loopA cycle dropped) + audio:stop
    assert.deepEqual(out, [{ metacode: 'audio', value: 'stop' }]);
    assert.equal(warnings.some((w) => /cycle/.test(w)), true);
  });

  it('warns and skips an unknown ref', () => {
    const warnings = [];
    const out = expandActionItems([{ ref: 'ghost' }], resolve, (m) => warnings.push(m));
    assert.deepEqual(out, []);
    assert.equal(warnings.some((w) => /unknown/.test(w)), true);
  });
});

describe('applyAtoms', () => {
  it('routes persistent atoms to setCode (with => TTL parsed off), api to refreshApi, audio to audio', () => {
    const codes = {}; const api = []; const audio = [];
    const summary = applyAtoms(
      [
        { metacode: 'section', value: 'Intro' },
        { metacode: 'graphics', value: '+banner' },
        { metacode: 'lower-third', value: 'Live => 20s:Off' },
        { metacode: 'api', value: 'cam.preset1' },
        { metacode: 'audio', value: 'start' },
      ],
      {
        setCode: (n, v, ttl) => { codes[n] = { v, ttl: ttl ? ttl.ms : null }; },
        refreshApi: (c, r) => api.push(`${c}.${r}`),
        audio: (v) => audio.push(v),
      },
    );
    assert.deepEqual(codes, {
      section: { v: 'Intro', ttl: null },
      graphics: { v: '+banner', ttl: null },
      'lower-third': { v: 'Live', ttl: 20000 }, // => TTL parsed off the atom value
    });
    assert.deepEqual(api, ['cam.preset1']);
    assert.deepEqual(audio, ['start']);
    assert.deepEqual(summary.api, [{ connectorSlug: 'cam', requestSlug: 'preset1' }]);
  });

  it('skips pointer/navigation atoms in v1 and warns', () => {
    const warns = [];
    const summary = applyAtoms(
      [{ metacode: 'goto', value: '5' }, { metacode: 'file', value: 'x.txt' }, { metacode: 'timer', value: '5' }],
      { onWarn: (m) => warns.push(m) },
    );
    assert.equal(Object.keys(summary.codes).length, 0);
    assert.equal(summary.skipped.length, 3);
    assert.equal(warns.length, 3);
  });
});

describe('parseFileContent() — action / action-def metacodes', () => {
  it('parses an action invocation into lineCodes.actions, stripped from content', () => {
    const { lines, lineCodes } = parseFileContent('<!-- action: @intro | api:cam.preset1 -->');
    assert.equal(lines[0], '');
    assert.deepEqual(lineCodes[0].actions, [{ ref: 'intro' }, { metacode: 'api', value: 'cam.preset1' }]);
  });

  it('collects action-def into the returned actionDefs and does not persist as a code', () => {
    const { lineCodes, actionDefs } = parseFileContent('<!-- action-def: intro: audio:start | graphics:+banner -->\nHello');
    assert.deepEqual(actionDefs, [{ name: 'intro', items: [
      { metacode: 'audio', value: 'start' }, { metacode: 'graphics', value: '+banner' },
    ] }]);
    // 'Hello' line carries no action/def leakage
    const hello = lineCodes[lineCodes.length - 1];
    assert.equal(hello.actions, undefined);
    assert.equal(hello['action-def'], undefined);
    assert.equal(hello.action, undefined);
  });

  it('keeps action on the same line as content, stripped from the sent text', () => {
    const { lines, lineCodes } = parseFileContent('Let us pray<!-- action: @intro -->');
    assert.equal(lines[0], 'Let us pray');
    assert.deepEqual(lineCodes[0].actions, [{ ref: 'intro' }]);
  });
});
