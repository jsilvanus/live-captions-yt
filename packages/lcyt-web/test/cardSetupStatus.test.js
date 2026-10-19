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
    const r = await loadCardStatuses({ ...base, fetchFn, cardIds: ['caption-targets', 'devices', 'egress', 'viewports'] });
    assert.deepEqual(r.get('caption-targets'), { status: 'configured', count: 2 });
    // Devices = cameras + mixers + encoders: cameras answers [], mixers and encoders fail, so nothing is known.
    assert.deepEqual(r.get('devices'), { status: 'unknown', count: null });
    assert.deepEqual(r.get('egress'), { status: 'configured', count: 1 });
    assert.deepEqual(r.get('viewports'), { status: 'empty', count: 0 });
    assert.ok(calls.every(([, auth]) => auth === 'Bearer t'));
  });

  it('counts the Devices card as cameras plus mixers plus encoders', async () => {
    const fetchFn = async url => {
      if (url.endsWith('/production/cameras')) return { ok: true, json: async () => [{ id: 'c1' }] };
      if (url.endsWith('/production/mixers')) return { ok: true, json: async () => [{ id: 'm1' }, { id: 'm2' }] };
      if (url.endsWith('/production/encoders')) return { ok: true, json: async () => [] };
      return { ok: false };
    };
    const r = await loadCardStatuses({ ...base, fetchFn, cardIds: ['devices'] });
    assert.deepEqual(r.get('devices'), { status: 'configured', count: 3 });
  });

  it('is unknown for unchecked cards, failed or thrown requests, and a missing token', async () => {
    const r1 = await loadCardStatuses({ ...base, fetchFn: json({}), cardIds: ['stt'] });
    assert.equal(r1.get('stt').status, 'unknown');
    const r2 = await loadCardStatuses({ ...base, fetchFn: async () => { throw new Error('x'); }, cardIds: ['devices'] });
    assert.equal(r2.get('devices').status, 'unknown');
    const r3 = await loadCardStatuses({ ...base, token: '', fetchFn: json([]), cardIds: ['devices'] });
    assert.equal(r3.get('devices').status, 'unknown');
  });

  it('url-encodes the api key for viewports', () => {
    assert.equal(CARD_STATUS_CHECKS.viewports.path('a b'), '/dsk/a%20b/viewports');
  });
});

describe('broadcast-platforms status', () => {
  const base = { backendUrl: 'http://x', token: 't', apiKey: 'k', cardIds: ['broadcast-platforms'] };
  const reply = body => async () => ({ ok: true, json: async () => body });

  it('counts only connections that are not revoked', async () => {
    const r = await loadCardStatuses({ ...base, fetchFn: reply({ credentials: [{ revokedAt: '2026-01-01' }, { revokedAt: null }] }) });
    assert.deepEqual(r.get('broadcast-platforms'), { status: 'configured', count: 1 });
  });

  it('is empty when every connection was revoked', async () => {
    const r = await loadCardStatuses({ ...base, fetchFn: reply({ credentials: [{ revokedAt: 'x' }] }) });
    assert.deepEqual(r.get('broadcast-platforms'), { status: 'empty', count: 0 });
  });
});

describe('feeds status', () => {
  const base = { backendUrl: 'http://x', token: 't', apiKey: 'k', cardIds: ['feeds'] };
  // GET /feeds always lists the two managed feeds; the Video switch comes from GET /ingestion/config.
  const managed = [{ id: 'managed:video', managed: true }, { id: 'managed:dsk', managed: true }];
  const router = ({ feeds, config }) => async url => {
    if (url.endsWith('/feeds')) return feeds === undefined ? { ok: false } : { ok: true, json: async () => ({ feeds }) };
    if (url.endsWith('/ingestion/config')) return config === undefined ? { ok: false } : { ok: true, json: async () => config };
    return { ok: false };
  };

  it('counts named feeds', async () => {
    const r = await loadCardStatuses({ ...base, fetchFn: router({ feeds: [...managed, { id: 'a' }], config: { video: { enabled: false } } }) });
    assert.deepEqual(r.get('feeds'), { status: 'configured', count: 1 });
  });

  it('counts the Video slot when it is enabled, even without named feeds', async () => {
    const r = await loadCardStatuses({ ...base, fetchFn: router({ feeds: managed, config: { video: { enabled: true } } }) });
    assert.deepEqual(r.get('feeds'), { status: 'configured', count: 1 });
  });

  it('is empty with no named feeds and the Video slot disabled', async () => {
    const r = await loadCardStatuses({ ...base, fetchFn: router({ feeds: managed, config: { video: { enabled: false } } }) });
    assert.deepEqual(r.get('feeds'), { status: 'empty', count: 0 });
  });

  it('is unknown when the Video switch cannot be read and there are no named feeds', async () => {
    const r = await loadCardStatuses({ ...base, fetchFn: router({ feeds: managed }) });
    assert.deepEqual(r.get('feeds'), { status: 'unknown', count: null });
  });

  it('is configured from a named feed even when the config request fails', async () => {
    const r = await loadCardStatuses({ ...base, fetchFn: router({ feeds: [...managed, { id: 'a' }] }) });
    assert.deepEqual(r.get('feeds'), { status: 'configured', count: 1 });
  });
});
