import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMcpToken } from '../src/lib/aiAdminApi.js';

// Capture the request body a single createMcpToken call sends.
function stubOnce() {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts, body: opts?.body ? JSON.parse(opts.body) : null });
    return { ok: true, json: async () => ({ ok: true, id: 1, token: 'lcytmcp_x' }) };
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

describe('createMcpToken scopes passthrough', () => {
  it('omits scopes for a full-access token', async () => {
    const { calls, restore } = stubOnce();
    try {
      await createMcpToken({ backendUrl: 'http://x', token: 't', apiKey: 'k', label: 'Full' });
    } finally { restore(); }
    assert.equal('scopes' in calls[0].body, false);
    assert.equal(calls[0].body.label, 'Full');
  });

  it('omits scopes when an empty array is passed (restrict with nothing selected)', async () => {
    const { calls, restore } = stubOnce();
    try {
      await createMcpToken({ backendUrl: 'http://x', token: 't', apiKey: 'k', label: 'Empty', scopes: [] });
    } finally { restore(); }
    assert.equal('scopes' in calls[0].body, false);
  });

  it('sends the scopes array when restricted', async () => {
    const { calls, restore } = stubOnce();
    try {
      await createMcpToken({
        backendUrl: 'http://x', token: 't', apiKey: 'k', label: 'Scoped',
        scopes: ['events:read', 'dsk.*'],
      });
    } finally { restore(); }
    assert.deepEqual(calls[0].body.scopes, ['events:read', 'dsk.*']);
  });
});
