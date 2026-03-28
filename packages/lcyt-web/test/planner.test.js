/**
 * Tests for serializePlan() and deserializePlan() from src/lib/metacode-planner.js
 *
 * Both functions are pure — no browser APIs required.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { serializePlan, deserializePlan } from '../src/lib/metacode-planner.js';

// ─── serializePlan ────────────────────────────────────────────────────────────

describe('serializePlan()', () => {
  it('serializes an empty plan to empty string', () => {
    assert.equal(serializePlan([]), '');
  });

  it('serializes a caption block', () => {
    const blocks = [{ id: '1', type: 'caption', text: 'Hello world' }];
    assert.equal(serializePlan(blocks), 'Hello world');
  });

  it('serializes audio-start block', () => {
    const blocks = [{ id: '1', type: 'audio-start' }];
    assert.equal(serializePlan(blocks), '<!-- audio: start -->');
  });

  it('serializes audio-stop block', () => {
    const blocks = [{ id: '1', type: 'audio-stop' }];
    assert.equal(serializePlan(blocks), '<!-- audio: stop -->');
  });

  it('serializes a graphics block', () => {
    const blocks = [{ id: '1', type: 'graphics', value: 'logo, banner' }];
    assert.equal(serializePlan(blocks), '<!-- graphics: logo, banner -->');
  });

  it('serializes a codes block with one code', () => {
    const blocks = [{ id: '1', type: 'codes', codes: { section: 'Intro' } }];
    assert.equal(serializePlan(blocks), '<!-- section: Intro -->');
  });

  it('serializes a codes block with multiple codes on one line', () => {
    const blocks = [{ id: '1', type: 'codes', codes: { section: 'Intro', speaker: 'Alice', lang: 'fi-FI' } }];
    const result = serializePlan(blocks);
    assert.ok(result.includes('<!-- section: Intro -->'));
    assert.ok(result.includes('<!-- speaker: Alice -->'));
    assert.ok(result.includes('<!-- lang: fi-FI -->'));
    // All on one line (no newlines in the codes block output)
    assert.ok(!result.includes('\n'));
  });

  it('omits codes with empty values', () => {
    const blocks = [{ id: '1', type: 'codes', codes: { section: 'Intro', speaker: '' } }];
    const result = serializePlan(blocks);
    assert.ok(result.includes('<!-- section: Intro -->'));
    assert.ok(!result.includes('speaker'));
  });

  it('serializes a stanza block', () => {
    const blocks = [{ id: '1', type: 'stanza', lines: ['First line', 'Second line'] }];
    const result = serializePlan(blocks);
    assert.equal(result, '<!-- stanza\nFirst line\nSecond line\n-->');
  });

  it('serializes an empty-send block without label', () => {
    const blocks = [{ id: '1', type: 'empty-send', label: '' }];
    assert.equal(serializePlan(blocks), '_');
  });

  it('serializes an empty-send block with label', () => {
    const blocks = [{ id: '1', type: 'empty-send', label: 'hook' }];
    assert.equal(serializePlan(blocks), '_ hook');
  });

  it('joins multiple blocks with newlines', () => {
    const blocks = [
      { id: '1', type: 'codes',      codes: { section: 'Intro' } },
      { id: '2', type: 'caption',    text: 'Welcome' },
      { id: '3', type: 'audio-start' },
      { id: '4', type: 'caption',    text: 'Hello' },
      { id: '5', type: 'audio-stop'  },
    ];
    const result = serializePlan(blocks);
    const lines = result.split('\n');
    assert.equal(lines[0], '<!-- section: Intro -->');
    assert.equal(lines[1], 'Welcome');
    assert.equal(lines[2], '<!-- audio: start -->');
    assert.equal(lines[3], 'Hello');
    assert.equal(lines[4], '<!-- audio: stop -->');
  });
});

// ─── deserializePlan ──────────────────────────────────────────────────────────

describe('deserializePlan()', () => {
  it('deserializes empty string to empty array', () => {
    assert.deepEqual(deserializePlan(''), []);
  });

  it('deserializes a caption line', () => {
    const blocks = deserializePlan('Hello world');
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, 'caption');
    assert.equal(blocks[0].text, 'Hello world');
  });

  it('deserializes <!-- audio: start -->', () => {
    const blocks = deserializePlan('<!-- audio: start -->');
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, 'audio-start');
  });

  it('deserializes <!-- audio: stop -->', () => {
    const blocks = deserializePlan('<!-- audio: stop -->');
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, 'audio-stop');
  });

  it('deserializes <!-- graphics: logo, banner -->', () => {
    const blocks = deserializePlan('<!-- graphics: logo, banner -->');
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, 'graphics');
    assert.equal(blocks[0].value, 'logo, banner');
  });

  it('deserializes a single-code line as a codes block', () => {
    const blocks = deserializePlan('<!-- section: Intro -->');
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, 'codes');
    assert.equal(blocks[0].codes.section, 'Intro');
  });

  it('deserializes a multi-code line as one codes block', () => {
    const blocks = deserializePlan('<!-- section: Intro --><!-- speaker: Alice --><!-- lang: fi-FI -->');
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, 'codes');
    assert.equal(blocks[0].codes.section, 'Intro');
    assert.equal(blocks[0].codes.speaker, 'Alice');
    assert.equal(blocks[0].codes.lang, 'fi-FI');
  });

  it('deserializes a stanza block', () => {
    const raw = '<!-- stanza\nLine 1\nLine 2\n-->';
    const blocks = deserializePlan(raw);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, 'stanza');
    assert.deepEqual(blocks[0].lines, ['Line 1', 'Line 2']);
  });

  it('deserializes _ as empty-send without label', () => {
    const blocks = deserializePlan('_');
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, 'empty-send');
    assert.equal(blocks[0].label, '');
  });

  it('deserializes _ label as empty-send with label', () => {
    const blocks = deserializePlan('_ hook');
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, 'empty-send');
    assert.equal(blocks[0].label, 'hook');
  });

  it('skips blank lines', () => {
    const blocks = deserializePlan('Line 1\n\n\nLine 2');
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].text, 'Line 1');
    assert.equal(blocks[1].text, 'Line 2');
  });

  it('deserializes a mixed script correctly', () => {
    const raw = [
      '<!-- section: Intro --><!-- speaker: Host -->',
      'Welcome to the show',
      '<!-- audio: start -->',
      'Good morning everyone',
      '<!-- graphics: logo, banner -->',
      'Please take your seats',
      '<!-- audio: stop -->',
      '_',
    ].join('\n');

    const blocks = deserializePlan(raw);
    assert.equal(blocks.length, 8);
    assert.equal(blocks[0].type, 'codes');
    assert.equal(blocks[0].codes.section, 'Intro');
    assert.equal(blocks[0].codes.speaker, 'Host');
    assert.equal(blocks[1].type, 'caption');
    assert.equal(blocks[1].text, 'Welcome to the show');
    assert.equal(blocks[2].type, 'audio-start');
    assert.equal(blocks[3].type, 'caption');
    assert.equal(blocks[3].text, 'Good morning everyone');
    assert.equal(blocks[4].type, 'graphics');
    assert.equal(blocks[4].value, 'logo, banner');
    assert.equal(blocks[5].type, 'caption');
    assert.equal(blocks[5].text, 'Please take your seats');
    assert.equal(blocks[6].type, 'audio-stop');
    assert.equal(blocks[7].type, 'empty-send');
  });

  it('each block gets a unique id', () => {
    const blocks = deserializePlan('Line 1\nLine 2\nLine 3');
    const ids = blocks.map(b => b.id);
    const unique = new Set(ids);
    assert.equal(unique.size, 3);
  });
});

// ─── Round-trip ───────────────────────────────────────────────────────────────

describe('serialize → deserialize round-trip', () => {
  it('round-trips a simple script', () => {
    const original = [
      { id: 'a', type: 'codes',       codes: { section: 'Intro', lang: 'fi-FI' } },
      { id: 'b', type: 'caption',     text: 'Welcome' },
      { id: 'c', type: 'audio-start' },
      { id: 'd', type: 'caption',     text: 'Good morning' },
      { id: 'e', type: 'audio-stop'  },
      { id: 'f', type: 'graphics',    value: 'logo' },
      { id: 'g', type: 'stanza',      lines: ['Verse 1', 'Verse 2'] },
      { id: 'h', type: 'empty-send',  label: 'hook' },
      { id: 'i', type: 'caption',     text: 'Thank you' },
    ];

    const serialized = serializePlan(original);
    const restored = deserializePlan(serialized);

    assert.equal(restored.length, original.length);

    // Check types match
    for (let i = 0; i < original.length; i++) {
      assert.equal(restored[i].type, original[i].type, `Block ${i} type mismatch`);
    }

    // Check key values
    assert.deepEqual(restored[0].codes, { section: 'Intro', lang: 'fi-FI' });
    assert.equal(restored[1].text, 'Welcome');
    assert.equal(restored[3].text, 'Good morning');
    assert.equal(restored[5].value, 'logo');
    assert.deepEqual(restored[6].lines, ['Verse 1', 'Verse 2']);
    assert.equal(restored[7].label, 'hook');
    assert.equal(restored[8].text, 'Thank you');
  });
});
