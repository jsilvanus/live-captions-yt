import { describe, it } from 'node:test';
import assert from 'node:assert';
import { applyMetacodeProcessors } from '../src/metacode.js';

describe('applyMetacodeProcessors', () => {
  it('applies dsk then sound processors in order (dsk async, sound sync)', async () => {
    const session = { apiKey: 'test-key' };
    const captions = [{ text: 'Hello' }, { text: 'World' }];

    // DSK processor: async, appends '-DSK'
    const dsk = async (apiKey, text, codes) => {
      return `${text}-DSK`;
    };

    // Sound processor: sync, appends '-SND'
    const sound = (apiKey, text) => `${text}-SND`;

    await applyMetacodeProcessors(session, captions, dsk, sound);

    assert.strictEqual(captions[0].text, 'Hello-DSK-SND');
    assert.strictEqual(captions[1].text, 'World-DSK-SND');
  });

  it('no-ops when processors are null', async () => {
    const session = { apiKey: 'test-key' };
    const captions = [{ text: 'Keep' }];

    await applyMetacodeProcessors(session, captions, null, null);

    assert.strictEqual(captions[0].text, 'Keep');
  });
});
