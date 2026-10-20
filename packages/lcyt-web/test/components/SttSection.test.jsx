import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionContext } from '../../src/contexts/SessionContext.jsx';
import { SttSection } from '../../src/components/setup-hub/SttSection.jsx';
import { setupToken } from '../../src/lib/setupToken.js';

const base = { connected: true, apiKey: 'k', backendUrl: 'http://backend.test' };

let calls;
beforeEach(() => {
  calls = [];
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    calls.push({ path: String(url).replace('http://backend.test', ''), method: opts.method || 'GET', auth: opts.headers?.Authorization });
    return { ok: true, status: 200, json: async () => ({ config: { provider: 'whisper_http', audioSource: 'hls', language: 'fi-FI' } }) };
  });
});
afterEach(() => { vi.restoreAllMocks(); });

describe('setupToken', () => {
  it('prefers the project access token (carries a user id for the Setup-tier gate)', () => {
    expect(setupToken({ projectAccessToken: 'proj', getSessionToken: () => 'sess' })).toBe('proj');
  });
  it('falls back to the session token, then null', () => {
    expect(setupToken({ getSessionToken: () => 'sess' })).toBe('sess');
    expect(setupToken({})).toBeNull();
    expect(setupToken(null)).toBeNull();
  });
});

describe('SttSection', () => {
  it('talks to /stt/config with the project access token, not the session token', async () => {
    render(
      <SessionContext.Provider value={{ ...base, projectAccessToken: 'proj', getSessionToken: () => 'sess' }}>
        <SttSection />
      </SessionContext.Provider>,
    );
    expect(await screen.findByText(/Whisper/)).toBeInTheDocument();
    const get = calls.find(c => c.path === '/api/v1/stt/config');
    expect(get.auth).toBe('Bearer proj');
  });

  it('still works with a session token only', async () => {
    render(
      <SessionContext.Provider value={{ ...base, getSessionToken: () => 'sess' }}>
        <SttSection />
      </SessionContext.Provider>,
    );
    expect(await screen.findByText(/Whisper/)).toBeInTheDocument();
    expect(calls.find(c => c.path === '/api/v1/stt/config').auth).toBe('Bearer sess');
  });
});
