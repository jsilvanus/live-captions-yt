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
