import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fleetCredentials, readFleet, summariseFleet } from '../src/fleet-status.js';

const caps = { workers: 2, slots: { default: { total: 6, used: 2 }, gpu: { total: 2, used: 1 } }, queued: 3 };
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

describe('fleet status', { timeout: 10_000 }, () => {
  it('has no credentials without a URL and takes both env spellings', () => {
    assert.equal(fleetCredentials({}), null);
    assert.deepEqual(fleetCredentials({ COMPUTE_URL: 'http://x/', COMPUTE_TOKEN: 't' }), { url: 'http://x', token: 't', clientId: undefined, clientSecret: undefined });
  });

  it('uses capabilities alone when the lists are refused', () => {
    assert.deepEqual(summariseFleet(caps, null, null), { state: 'ok', workers: 2, slotsUsed: 3, slotsTotal: 8, queued: 3 });
  });

  it('ignores slots of draining workers and lists pools', () => {
    const workers = { workers: [{ slots: { default: 4 }, used: { default: 1 } }, { draining: true, slots: { default: 4 }, used: {} }] };
    assert.deepEqual(summariseFleet(caps, workers, { pools: [{ name: 'hetzner', instances: 1, max: 5, extra: 1 }] }), {
      state: 'ok', workers: 2, slotsUsed: 1, slotsTotal: 4, queued: 3, draining: 1, pools: [{ name: 'hetzner', instances: 1, max: 5 }],
    });
  });

  it('is null without a fleet and offline when capabilities fail', async () => {
    assert.equal(await readFleet({ env: {} }), null);
    const f = async () => json({}, 500);
    assert.deepEqual(await readFleet({ env: { FFFLEET_URL: 'http://x' }, fetch: f }), { state: 'offline' });
  });

  it('falls back to capabilities when workers and pools answer 403, with the static token', async () => {
    const seen = [];
    const f = async (url, init) => {
      seen.push([url, init.headers.authorization]);
      return url.endsWith('/v1/capabilities') ? json(caps) : json({}, 403);
    };
    const out = await readFleet({ env: { FFFLEET_URL: 'http://fleet:8080/', FFFLEET_TOKEN: 'tok' }, fetch: f });
    assert.equal(out.slotsTotal, 8);
    assert.deepEqual(seen.map((s) => s[0]).sort(), ['http://fleet:8080/v1/capabilities', 'http://fleet:8080/v1/pools', 'http://fleet:8080/v1/workers']);
    assert.ok(seen.every((s) => s[1] === 'Bearer tok'));
  });

  it('logs in with client credentials without a scope and retries once on 401', async () => {
    const opts = [];
    const make = (o) => { opts.push(o); let n = 0; return { get: async () => `tok${++n}` }; };
    let first = true;
    const auths = [];
    const f = async (url, init) => {
      if (url.endsWith('/v1/capabilities')) {
        auths.push(init.headers.authorization);
        if (first) { first = false; return json({}, 401); }
        return json(caps);
      }
      return json({}, 403);
    };
    const out = await readFleet({ env: { FFFLEET_URL: 'http://cc', FFFLEET_CLIENT_ID: 'c', FFFLEET_CLIENT_SECRET: 's' }, fetch: f, createTokenProvider: make });
    assert.equal(out.state, 'ok');
    assert.equal(opts[0].scope, undefined);
    assert.equal(auths.length, 2);
    assert.equal(auths[0], 'Bearer tok1');
    assert.notEqual(auths[1], auths[0]); // refreshed after the 401
  });
});
