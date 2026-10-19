// Contract every channel adapter must pass. Each adapter test file calls
// runAdapterContract with a factory that builds the adapter on a fake fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * @param {{ name: string, channel: string, provider: string,
 *           make: (fetchImpl: Function) => object,
 *           sample: { to: string, subject?: string, text: string },
 *           secret: string }} opts
 */
export function runAdapterContract({ name, channel, provider, make, sample, secret }) {
  const okFetch = async () => ({ ok: true, status: 201, json: async () => ({ messageId: 'id-1' }) });

  test(`${name}: declares channel and provider`, () => {
    const a = make(okFetch);
    assert.equal(a.channel, channel);
    assert.equal(a.provider, provider);
    assert.equal(typeof a.send, 'function');
  });

  test(`${name}: send resolves to { id } as a string`, async () => {
    const a = make(okFetch);
    const r = await a.send(sample);
    assert.deepEqual(r, { id: 'id-1' });
  });

  test(`${name}: HTTP failure rejects with a message that has no secret`, async () => {
    const a = make(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    await assert.rejects(() => a.send(sample), (err) => {
      assert.ok(err instanceof Error);
      assert.doesNotMatch(err.message, new RegExp(secret));
      return true;
    });
  });

  test(`${name}: network failure rejects with a message that has no secret`, async () => {
    const a = make(async () => { throw new Error(`connect failed for ${secret}`); });
    await assert.rejects(() => a.send(sample), (err) => {
      assert.doesNotMatch(err.message, new RegExp(secret));
      return true;
    });
  });
}
