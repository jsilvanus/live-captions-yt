/**
 * Tests for useSession hook.
 *
 * BackendCaptionSender is mocked so no real HTTP traffic occurs.
 * EventSource is stubbed globally in test/setup.vitest.js.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSession } from '../../src/hooks/useSession.js';

// ---------------------------------------------------------------------------
// Mock BackendCaptionSender
// ---------------------------------------------------------------------------

const mockSender = {
  _token: 'mock-jwt-token',
  sequence: 0,
  syncOffset: 0,
  startedAt: new Date(),
  graphicsEnabled: false,
  apiKey: 'test-api-key',
  start: vi.fn().mockResolvedValue(undefined),
  end: vi.fn().mockResolvedValue(undefined),
  sync: vi.fn().mockResolvedValue({ syncOffset: 0 }),
  send: vi.fn().mockResolvedValue({ ok: true, requestId: 'req-1' }),
  sendBatch: vi.fn().mockResolvedValue({ ok: true, requestId: 'req-batch', count: 2 }),
  construct: vi.fn().mockReturnValue(undefined),
  heartbeat: vi.fn().mockResolvedValue({ ok: true }),
  updateSession: vi.fn().mockResolvedValue(undefined),
};

vi.mock('lcyt/backend', () => ({
  BackendCaptionSender: vi.fn(function () { return mockSender; }),
}));

// targetConfig reads from localStorage — starts empty (cleared in setup.vitest.js)
// so getEnabledTargets() returns [] and connect() calls sender.start({})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_CONFIG = {
  backendUrl: 'http://backend.test',
  apiKey: 'test-api-key',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSender._token = 'mock-jwt-token';
  mockSender.sequence = 0;
  mockSender.syncOffset = 0;
});

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe('useSession — initial state', () => {
  it('starts disconnected', () => {
    const { result } = renderHook(() => useSession());
    expect(result.current.connected).toBe(false);
  });

  it('sequence starts at 0', () => {
    const { result } = renderHook(() => useSession());
    expect(result.current.sequence).toBe(0);
  });

  it('backendUrl starts empty', () => {
    const { result } = renderHook(() => useSession());
    expect(result.current.backendUrl).toBe('');
  });

  it('healthStatus starts as "unknown"', () => {
    const { result } = renderHook(() => useSession());
    expect(result.current.healthStatus).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// Persistence helpers (getPersistedConfig / getAutoConnect / setAutoConnect)
// ---------------------------------------------------------------------------

describe('useSession — persistence helpers', () => {
  it('getPersistedConfig returns {} when nothing stored', () => {
    const { result } = renderHook(() => useSession());
    expect(result.current.getPersistedConfig()).toEqual({});
  });

  it('getAutoConnect returns false when nothing stored', () => {
    const { result } = renderHook(() => useSession());
    expect(result.current.getAutoConnect()).toBe(false);
  });

  it('setAutoConnect / getAutoConnect round-trip', () => {
    const { result } = renderHook(() => useSession());
    act(() => { result.current.setAutoConnect(true); });
    expect(result.current.getAutoConnect()).toBe(true);
    act(() => { result.current.setAutoConnect(false); });
    expect(result.current.getAutoConnect()).toBe(false);
  });

  it('clearPersistedConfig removes both keys', () => {
    const { result } = renderHook(() => useSession());
    act(() => { result.current.setAutoConnect(true); });
    act(() => { result.current.clearPersistedConfig(); });
    expect(result.current.getAutoConnect()).toBe(false);
    expect(result.current.getPersistedConfig()).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// connect()
// ---------------------------------------------------------------------------

describe('useSession — connect()', () => {
  it('sets connected=true after successful connect', async () => {
    const { result } = renderHook(() => useSession());
    await act(() => result.current.connect(VALID_CONFIG));
    expect(result.current.connected).toBe(true);
  });

  it('calls BackendCaptionSender.start()', async () => {
    const { result } = renderHook(() => useSession());
    await act(() => result.current.connect(VALID_CONFIG));
    expect(mockSender.start).toHaveBeenCalledTimes(1);
  });

  it('sets backendUrl from config', async () => {
    const { result } = renderHook(() => useSession());
    await act(() => result.current.connect(VALID_CONFIG));
    expect(result.current.backendUrl).toBe('http://backend.test');
  });

  it('sets apiKey from config', async () => {
    const { result } = renderHook(() => useSession());
    await act(() => result.current.connect(VALID_CONFIG));
    expect(result.current.apiKey).toBe('test-api-key');
  });

  it('sets healthStatus to "ok" after connect', async () => {
    const { result } = renderHook(() => useSession());
    await act(() => result.current.connect(VALID_CONFIG));
    expect(result.current.healthStatus).toBe('ok');
  });

  it('calls onConnected callback with token + backendUrl', async () => {
    const onConnected = vi.fn();
    const { result } = renderHook(() => useSession({ onConnected }));
    await act(() => result.current.connect(VALID_CONFIG));
    expect(onConnected).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'mock-jwt-token',
        backendUrl: 'http://backend.test',
      })
    );
  });

  it('persists backendUrl + apiKey to localStorage', async () => {
    const { result } = renderHook(() => useSession());
    await act(() => result.current.connect(VALID_CONFIG));
    const cfg = result.current.getPersistedConfig();
    expect(cfg.backendUrl).toBe('http://backend.test');
    expect(cfg.apiKey).toBe('test-api-key');
  });

  it('throws and calls onError when no token received', async () => {
    mockSender._token = null;
    const onError = vi.fn();
    const { result } = renderHook(() => useSession({ onError }));
    await expect(act(() => result.current.connect(VALID_CONFIG))).rejects.toThrow();
    expect(onError).toHaveBeenCalled();
    expect(result.current.connected).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// disconnect()
// ---------------------------------------------------------------------------

describe('useSession — disconnect()', () => {
  it('sets connected=false after disconnect', async () => {
    const { result } = renderHook(() => useSession());
    await act(() => result.current.connect(VALID_CONFIG));
    expect(result.current.connected).toBe(true);
    await act(() => result.current.disconnect());
    expect(result.current.connected).toBe(false);
  });

  it('calls sender.end()', async () => {
    const { result } = renderHook(() => useSession());
    await act(() => result.current.connect(VALID_CONFIG));
    await act(() => result.current.disconnect());
    expect(mockSender.end).toHaveBeenCalled();
  });

  it('calls onDisconnected callback', async () => {
    const onDisconnected = vi.fn();
    const { result } = renderHook(() => useSession({ onDisconnected }));
    await act(() => result.current.connect(VALID_CONFIG));
    await act(() => result.current.disconnect());
    expect(onDisconnected).toHaveBeenCalledTimes(1);
  });

  it('resets sequence to 0', async () => {
    const { result } = renderHook(() => useSession());
    await act(() => result.current.connect(VALID_CONFIG));
    await act(() => result.current.disconnect());
    expect(result.current.sequence).toBe(0);
  });

  it('is a no-op when not connected', async () => {
    const onDisconnected = vi.fn();
    const { result } = renderHook(() => useSession({ onDisconnected }));
    await act(() => result.current.disconnect());
    expect(onDisconnected).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// send()
// ---------------------------------------------------------------------------

describe('useSession — send()', () => {
  it('throws when not connected', async () => {
    const { result } = renderHook(() => useSession());
    await expect(result.current.send('Hello')).rejects.toThrow('Not connected');
  });

  it('delegates to sender.send() and fires onCaptionSent', async () => {
    const onCaptionSent = vi.fn();
    const { result } = renderHook(() => useSession({ onCaptionSent }));
    await act(() => result.current.connect(VALID_CONFIG));
    await act(() => result.current.send('Hello world'));
    expect(mockSender.send).toHaveBeenCalledWith('Hello world', undefined, undefined);
    expect(onCaptionSent).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Hello world', requestId: 'req-1', pending: true })
    );
  });
});

// ---------------------------------------------------------------------------
// sendBatch()
// ---------------------------------------------------------------------------

describe('useSession — sendBatch()', () => {
  it('throws when not connected', async () => {
    const { result } = renderHook(() => useSession());
    await expect(result.current.sendBatch(['a', 'b'])).rejects.toThrow('Not connected');
  });

  it('delegates to sender.sendBatch()', async () => {
    const { result } = renderHook(() => useSession());
    await act(() => result.current.connect(VALID_CONFIG));
    await act(() => result.current.sendBatch(['Cap 1', 'Cap 2']));
    expect(mockSender.sendBatch).toHaveBeenCalledWith(
      [{ text: 'Cap 1' }, { text: 'Cap 2' }]
    );
  });
});
