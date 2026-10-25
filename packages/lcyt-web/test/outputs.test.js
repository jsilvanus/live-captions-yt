import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  outputSourceValue, parseOutputSource, audioSourceValue, audioSourceFromValue, selectableChainOutputs,
  selectableOutputFeeds, formFromOutput, outputBody, toggleDsk, EMPTY_OUTPUT_FORM,
} from '../src/lib/outputs.js';

describe('output source values', () => {
  it('round trips feed and output sources', () => {
    assert.equal(outputSourceValue({ sourceType: 'feed', sourceId: 'f1' }), 'feed:f1');
    assert.equal(outputSourceValue({ sourceType: 'output', sourceId: 'out-1' }), 'output:out-1');
    assert.deepEqual(parseOutputSource('output:out-1'), { sourceType: 'output', sourceId: 'out-1' });
    assert.equal(parseOutputSource('crop'), null);
    assert.equal(parseOutputSource('feed:'), null);
  });
  it('maps the audio choice', () => {
    assert.equal(audioSourceValue('source'), 'source');
    assert.equal(audioSourceValue({ feed: 'f2' }), 'feed:f2');
    assert.deepEqual(audioSourceFromValue('feed:f2'), { feed: 'f2' });
    assert.equal(audioSourceFromValue('source'), 'source');
  });
});

describe('selectable lists', () => {
  it('leaves out the output itself and managed feeds', () => {
    assert.deepEqual(selectableChainOutputs([{ id: 'a' }, { id: 'b' }], 'a').map(o => o.id), ['b']);
    assert.deepEqual(selectableOutputFeeds([{ id: 'm', managed: true }, { id: 'f' }]).map(f => f.id), ['f']);
  });
});

describe('form and body', () => {
  it('builds the API body and refuses an incomplete form', () => {
    assert.equal(outputBody(EMPTY_OUTPUT_FORM), null);
    const body = outputBody({ name: ' Vertical ', source: 'output:out-1', dsk: ['lower'], cropEnabled: true, audio: 'feed:f2', enabled: true });
    assert.deepEqual(body, {
      name: 'Vertical', sourceType: 'output', sourceId: 'out-1', dsk: ['lower'], cropEnabled: true,
      audioSource: { feed: 'f2' }, enabled: true,
    });
  });
  it('fills the form from an output and back', () => {
    const o = { id: 'x', name: 'A', sourceType: 'feed', sourceId: 'f1', dsk: ['a', 'b'], cropEnabled: false, audioSource: 'source', enabled: false };
    const form = formFromOutput(o);
    assert.equal(form.enabled, false);
    assert.equal(outputBody(form).sourceId, 'f1');
  });
  it('toggles viewports in order', () => {
    assert.deepEqual(toggleDsk(['a'], 'b'), ['a', 'b']);
    assert.deepEqual(toggleDsk(['a', 'b'], 'a'), ['b']);
  });
});

import { lockCandidates, lockAction, lockedWithId } from '../src/lib/outputs.js';

describe('lock helpers', () => {
  const a = { id: 'a', sourceType: 'feed', sourceId: 'f1', cropEnabled: false, groupId: null };
  const b = { id: 'b', sourceType: 'feed', sourceId: 'f1', cropEnabled: false, groupId: null };
  const c = { id: 'c', sourceType: 'feed', sourceId: 'f2', cropEnabled: false, groupId: null };
  const d = { id: 'd', sourceType: 'feed', sourceId: 'f1', cropEnabled: true, groupId: null };
  it('offers outputs with the same source and no crop', () => {
    assert.deepEqual(lockCandidates([a, b, c, d], a).map(o => o.id), ['b']);
    assert.deepEqual(lockCandidates([a, b], { ...a, cropEnabled: true }), []);
  });
  it('turns the choice into an action', () => {
    assert.deepEqual(lockAction([a, b], a, ''), { kind: 'none' });
    assert.deepEqual(lockAction([a, b], a, 'b'), { kind: 'create', otherId: 'b' });
    const g = { ...b, groupId: 'lg-1' };
    assert.deepEqual(lockAction([a, g], a, 'b'), { kind: 'join', groupId: 'lg-1' });
    assert.deepEqual(lockAction([{ ...a, groupId: 'lg-1' }, g], { ...a, groupId: 'lg-1' }, 'b'), { kind: 'none' });
    assert.deepEqual(lockAction([{ ...a, groupId: 'lg-1' }, g], { ...a, groupId: 'lg-1' }, ''), { kind: 'leave' });
  });
  it('finds the partner of a locked output', () => {
    const g1 = { ...a, groupId: 'lg-1' }; const g2 = { ...b, groupId: 'lg-1' };
    assert.equal(lockedWithId([g1, g2], g1), 'b');
    assert.equal(lockedWithId([a, b], a), '');
  });
});
