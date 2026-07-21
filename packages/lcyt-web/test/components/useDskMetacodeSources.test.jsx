import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useDskMetacodeSources } from '../../src/hooks/useDskMetacodeSources.js';

function makeSession(overrides = {}) {
  return {
    apiKey: 'proj-1',
    backendUrl: 'https://api.test',
    listImages: vi.fn().mockResolvedValue({ images: [{ shorthand: 'logo' }, { shorthand: 'banner' }] }),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ viewports: [{ name: 'vertical-left' }, { name: 'vertical-right' }] }),
  });
});

describe('useDskMetacodeSources', () => {
  it('starts with empty lists', () => {
    const { result } = renderHook(() => useDskMetacodeSources({ session: makeSession() }));
    expect(result.current.shorthands).toEqual([]);
    expect(result.current.viewports).toEqual([]);
  });

  it('ensureLoaded() fetches image shorthands and viewport names', async () => {
    const session = makeSession();
    const { result } = renderHook(() => useDskMetacodeSources({ session }));

    await result.current.ensureLoaded();

    await waitFor(() => expect(result.current.shorthands).toEqual(['logo', 'banner']));
    expect(result.current.viewports).toEqual(['vertical-left', 'vertical-right']);
    expect(session.listImages).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.test/dsk/proj-1/viewports',
      { headers: { 'X-API-Key': 'proj-1' } }
    );
  });

  it('does not refetch on a second ensureLoaded() call for the same key', async () => {
    const session = makeSession();
    const { result } = renderHook(() => useDskMetacodeSources({ session }));

    await result.current.ensureLoaded();
    await waitFor(() => expect(result.current.shorthands.length).toBe(2));
    await result.current.ensureLoaded();

    expect(session.listImages).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('is a no-op without an apiKey/backendUrl', async () => {
    const session = makeSession({ apiKey: '', backendUrl: '' });
    const { result } = renderHook(() => useDskMetacodeSources({ session }));

    await result.current.ensureLoaded();

    expect(session.listImages).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
