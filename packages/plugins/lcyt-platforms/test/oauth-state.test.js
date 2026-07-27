import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { createState, verifyState, STATE_TTL_MS } = await import('../src/oauth-state.js');

const SECRET = 'test-jwt-secret';
const CLAIMS = { apiKey: 'proj-key-1', platform: 'youtube' };

describe('createState / verifyState', () => {
  test('round-trips the project and platform', () => {
    const decoded = verifyState(createState(CLAIMS, SECRET), SECRET, { platform: 'youtube' });
    assert.equal(decoded.apiKey, 'proj-key-1');
    assert.equal(decoded.platform, 'youtube');
  });

  test('is URL-safe', () => {
    // It travels as a query param through a provider redirect; +/= would be
    // mangled somewhere along the way.
    const state = createState(CLAIMS, SECRET);
    assert.equal(state, encodeURIComponent(state).replace(/%2F/g, '/'));
    assert.ok(!/[+/=]/.test(state.replace('.', '')));
  });

  test('two states for the same project differ', () => {
    assert.notEqual(createState(CLAIMS, SECRET), createState(CLAIMS, SECRET));
  });

  test('rejects a tampered payload', () => {
    // The attack this exists to stop: swap in your own api_key and attach your
    // channel to someone else's project.
    const state = createState(CLAIMS, SECRET);
    const [, sig] = state.split('.');
    const forged = Buffer.from(JSON.stringify({
      apiKey: 'someone-elses-project', platform: 'youtube', nonce: 'x', exp: Date.now() + 60_000,
    })).toString('base64url');
    assert.equal(verifyState(`${forged}.${sig}`, SECRET), null);
  });

  test('rejects a tampered signature', () => {
    const [payload, sig] = createState(CLAIMS, SECRET).split('.');
    const flipped = sig.slice(0, -1) + (sig.at(-1) === 'a' ? 'b' : 'a');
    assert.equal(verifyState(`${payload}.${flipped}`, SECRET), null);
  });

  test('rejects a state signed with a different secret', () => {
    assert.equal(verifyState(createState(CLAIMS, 'other-secret'), SECRET), null);
  });

  test('rejects an expired state', () => {
    const now = Date.now();
    const state = createState(CLAIMS, SECRET, { now });
    assert.ok(verifyState(state, SECRET, { now: now + STATE_TTL_MS - 1000 }));
    assert.equal(verifyState(state, SECRET, { now: now + STATE_TTL_MS + 1 }), null);
  });

  test('rejects a state replayed against a different platform callback', () => {
    const state = createState({ apiKey: 'k', platform: 'youtube' }, SECRET);
    assert.equal(verifyState(state, SECRET, { platform: 'facebook' }), null);
    assert.ok(verifyState(state, SECRET, { platform: 'youtube' }));
  });

  test('rejects malformed input without throwing', () => {
    for (const bad of ['', 'nodot', '.', 'a.b', null, undefined, 42, {}]) {
      assert.equal(verifyState(bad, SECRET), null);
    }
  });

  test('rejects everything when no secret is configured', () => {
    assert.equal(verifyState(createState(CLAIMS, SECRET), ''), null);
    assert.throws(() => createState(CLAIMS, ''), TypeError);
  });

  test('requires both claims', () => {
    assert.throws(() => createState({ apiKey: 'k' }, SECRET), TypeError);
    assert.throws(() => createState({ platform: 'youtube' }, SECRET), TypeError);
  });
});
