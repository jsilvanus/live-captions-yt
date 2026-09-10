/**
 * Unit tests for src/lib/deviceSession.js — pure functions, no React/DOM.
 * Used by CameraStreamPage.jsx/LcytMixerPage.jsx (capability-URL kiosk
 * pages) to optionally pick up the device-role JWT DeviceLoginPage.jsx
 * stores in sessionStorage['lcyt-device'].
 */
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readDeviceSession, resolveKioskConnection } from '../src/lib/deviceSession.js';

const _sessionStore = {};
const _ss = {
  getItem: (k) => _sessionStore[k] ?? null,
  setItem: (k, v) => { _sessionStore[k] = String(v); },
  removeItem: (k) => { delete _sessionStore[k]; },
};

const _localStore = {};
const _ls = {
  getItem: (k) => _localStore[k] ?? null,
  setItem: (k, v) => { _localStore[k] = String(v); },
  removeItem: (k) => { delete _localStore[k]; },
};

before(() => {
  globalThis.sessionStorage = _ss;
  globalThis.localStorage = _ls;
  globalThis.window = { location: { search: '' } };
});

beforeEach(() => {
  for (const k of Object.keys(_sessionStore)) delete _sessionStore[k];
  for (const k of Object.keys(_localStore)) delete _localStore[k];
  globalThis.window.location.search = '';
});

describe('readDeviceSession()', () => {
  it('returns null when nothing is stored', () => {
    assert.equal(readDeviceSession(), null);
  });

  it('returns null for malformed JSON', () => {
    _sessionStore['lcyt-device'] = '{not json';
    assert.equal(readDeviceSession(), null);
  });

  it('returns null when the stored object has no token', () => {
    _sessionStore['lcyt-device'] = JSON.stringify({ apiKey: 'proj-a' });
    assert.equal(readDeviceSession(), null);
  });

  it('returns the parsed session when a token is present', () => {
    _sessionStore['lcyt-device'] = JSON.stringify({ token: 'tok', apiKey: 'proj-a', backendUrl: 'https://api.example.com' });
    const session = readDeviceSession();
    assert.equal(session.token, 'tok');
    assert.equal(session.apiKey, 'proj-a');
  });
});

describe('resolveKioskConnection()', () => {
  it('falls back to the legacy localStorage key when nothing else is set', () => {
    _localStore['lcyt_backend_url'] = 'https://legacy.example.com';
    const { backendUrl, authHeaders, device } = resolveKioskConnection('lcyt_backend_url');
    assert.equal(backendUrl, 'https://legacy.example.com');
    assert.deepEqual(authHeaders, {});
    assert.equal(device, null);
  });

  it('prefers the persisted device session backendUrl + sends Authorization: Bearer', () => {
    _sessionStore['lcyt-device'] = JSON.stringify({ token: 'tok-123', backendUrl: 'https://device.example.com' });
    _localStore['lcyt_backend_url'] = 'https://legacy.example.com';
    const { backendUrl, authHeaders } = resolveKioskConnection('lcyt_backend_url');
    assert.equal(backendUrl, 'https://device.example.com');
    assert.deepEqual(authHeaders, { Authorization: 'Bearer tok-123' });
  });

  it('an explicit ?server= param wins over everything else for backendUrl', () => {
    _sessionStore['lcyt-device'] = JSON.stringify({ token: 'tok-123', backendUrl: 'https://device.example.com' });
    globalThis.window.location.search = '?server=' + encodeURIComponent('https://explicit.example.com');
    const { backendUrl } = resolveKioskConnection('lcyt_backend_url');
    assert.equal(backendUrl, 'https://explicit.example.com');
  });

  it('never sends the device token to a ?server= origin that differs from the device session (no token exfiltration to an arbitrary/crafted URL)', () => {
    _sessionStore['lcyt-device'] = JSON.stringify({ token: 'tok-123', backendUrl: 'https://device.example.com' });
    globalThis.window.location.search = '?server=' + encodeURIComponent('https://evil.example.com');
    const { backendUrl, authHeaders, device } = resolveKioskConnection('lcyt_backend_url');
    assert.equal(backendUrl, 'https://evil.example.com');
    assert.deepEqual(authHeaders, {}, 'Authorization header must be withheld for a mismatched ?server= origin');
    assert.equal(device, null);
  });

  it('still attaches the token when ?server= happens to name the same origin as the device session (trailing slash ignored)', () => {
    _sessionStore['lcyt-device'] = JSON.stringify({ token: 'tok-123', backendUrl: 'https://device.example.com' });
    globalThis.window.location.search = '?server=' + encodeURIComponent('https://device.example.com/');
    const { backendUrl, authHeaders } = resolveKioskConnection('lcyt_backend_url');
    assert.equal(backendUrl, 'https://device.example.com/');
    assert.deepEqual(authHeaders, { Authorization: 'Bearer tok-123' });
  });

  it('returns an empty backendUrl and no auth header when nothing is configured', () => {
    const { backendUrl, authHeaders, device } = resolveKioskConnection('lcyt_backend_url');
    assert.equal(backendUrl, '');
    assert.deepEqual(authHeaders, {});
    assert.equal(device, null);
  });
});
