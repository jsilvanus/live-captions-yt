import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyCount, loadCardStatuses, CARD_STATUS_CHECKS } from '../src/lib/cardSetupStatus.js';

const json = body => async () => ({ ok: true, json: async () => body });

describe('classifyCount()', () => {
  it('maps counts to statuses', () => {
    assert.equal(classifyCount(null), 'unknown');
    assert.equal(classifyCount(0), 'empty');
    assert.equal(classifyCount(2), 'configured');
  });
});

describe('loadCardStatuses()', () => {
  const base = { backendUrl: 'http://b', token: 't', apiKey: 'k' };

  it('reads counts per card from each list endpoint', async () => {
    const calls = [];
    const fetchFn = async (url, opts) => {
      calls.push([url, opts.headers.Authorization]);
      if (url.endsWith('/targets')) return { ok: true, json: async () => ({ targets: [{}, {}] }) };
      if (url.endsWith('/production/cameras')) return { ok: true, json: async () => [] };
      if (url.endsWith('/stream')) return { ok: true, json: async () => ({ relays: [{}] }) };
      if (url.includes('/viewports')) return { ok: true, json: async () => ({ viewports: [] }) };
      return { ok: false };
    };
    const r = await loadCardStatuses({ ...base, fetchFn, cardIds: ['caption-targets', 'cameras', 'egress', 'viewports', 'mixers'] });
    assert.deepEqual(r.get('caption-targets'), { status: 'configured', count: 2 });
    assert.deepEqual(r.get('cameras'), { status: 'empty', count: 0 });
    assert.deepEqual(r.get('egress'), { status: 'configured', count: 1 });
    assert.deepEqual(r.get('viewports'), { status: 'empty', count: 0 });
    assert.deepEqual(r.get('mixers'), { status: 'unknown', count: null });
    assert.ok(calls.every(([, auth]) => auth === 'Bearer t'));
  });

  it('is unknown for unchecked cards, failed or thrown requests, and a missing token', async () => {
    const r1 = await loadCardStatuses({ ...base, fetchFn: json({}), cardIds: ['stt'] });
    assert.equal(r1.get('stt').status, 'unknown');
    const r2 = await loadCardStatuses({ ...base, fetchFn: async () => { throw new Error('x'); }, cardIds: ['cameras'] });
    assert.equal(r2.get('cameras').status, 'unknown');
    const r3 = await loadCardStatuses({ ...base, token: '', fetchFn: json([]), cardIds: ['cameras'] });
    assert.equal(r3.get('cameras').status, 'unknown');
  });

  it('url-encodes the api key for viewports', () => {
    assert.equal(CARD_STATUS_CHECKS.viewports.path('a b'), '/dsk/a%20b/viewports');
  });
});
