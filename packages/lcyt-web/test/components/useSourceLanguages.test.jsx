/**
 * Tests for useSourceLanguages hook (Phase 5: reads shared STT source-language list).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSourceLanguages } from '../../src/hooks/useSourceLanguages.js';
import { SessionContext } from '../../src/contexts/SessionContext.jsx';

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn();
});

function renderWithSession(session = {}) {
  const defaultSession = {
    connected: true,
    backendUrl: 'http://localhost:3000',
    getSessionToken: () => 'test-token',
    ...session,
  };

  return renderHook(() => useSourceLanguages(), {
    wrapper: ({ children }) => (
      <SessionContext.Provider value={defaultSession}>
        {children}
      </SessionContext.Provider>
    ),
  });
}

describe('useSourceLanguages hook', () => {
  it('starts with empty sourceLanguages list and loading=false when not connected', () => {
    const { result } = renderWithSession({ connected: false });
    expect(result.current.sourceLanguages).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('fetches source languages on mount when connected', async () => {
    const mockLanguages = [
      { lang: 'en-US', label: 'English (US)', sort_order: 1 },
      { lang: 'fi-FI', label: 'Finnish', sort_order: 2 },
    ];

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ languages: mockLanguages }),
    });

    const { result } = renderWithSession();

    await waitFor(() => {
      expect(result.current.sourceLanguages).toEqual(mockLanguages);
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('handles fetch errors gracefully', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Server error' }),
    });

    const { result } = renderWithSession();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.sourceLanguages).toEqual([]);
    expect(result.current.error).toBe('Server error');
  });

  it('includes Authorization header when session token is available', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ languages: [] }),
    });

    renderWithSession();

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    const callArgs = global.fetch.mock.calls[0];
    expect(callArgs[0]).toBe('http://localhost:3000/stt/source-languages');
    expect(callArgs[1].headers.Authorization).toBe('Bearer test-token');
  });

  it('handles malformed JSON response', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => { throw new Error('Invalid JSON'); },
    });

    const { result } = renderWithSession();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.sourceLanguages).toEqual([]);
  });

  it('does not fetch when session is disconnected', () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ languages: [] }),
    });

    renderWithSession({ connected: false });

    // Fetch should not be called
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('extracts languages array from response', async () => {
    const mockLanguages = [
      { lang: 'es-ES', label: 'Spanish' },
    ];

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ languages: mockLanguages, extra: 'data' }),
    });

    const { result } = renderWithSession();

    await waitFor(() => {
      expect(result.current.sourceLanguages).toEqual(mockLanguages);
    });
  });
});
