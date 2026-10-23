import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { ACTIVE_BROADCAST_EVENT, useActiveBroadcast } from '../../src/hooks/useActiveBroadcast.js';

function response(body, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

describe('useActiveBroadcast', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads a snapshot and exposes loading separately from background refreshing', async () => {
    let finish;
    global.fetch.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useActiveBroadcast({
      backendUrl: 'http://api.test',
      token: 'token',
    }));

    expect(result.current.loading).toBe(true);
    expect(result.current.broadcast).toBeNull();

    await act(async () => {
      finish(response({ broadcast: { id: 'b1' }, projectName: 'Sunday service' }));
    });

    expect(result.current.broadcast).toEqual({ id: 'b1' });
    expect(result.current.projectName).toBe('Sunday service');
    expect(result.current.loading).toBe(false);

    let finishRefresh;
    global.fetch.mockImplementationOnce(() => new Promise((resolve) => { finishRefresh = resolve; }));
    act(() => { result.current.reload(); });
    expect(result.current.loading).toBe(false);
    expect(result.current.refreshing).toBe(true);
    expect(result.current.broadcast).toEqual({ id: 'b1' });

    await act(async () => {
      finishRefresh(response({ broadcast: { id: 'b2' }, projectName: 'Sunday service' }));
    });
    expect(result.current.broadcast).toEqual({ id: 'b2' });
    expect(result.current.refreshing).toBe(false);
  });

  it('retains the last good snapshot when a refresh fails', async () => {
    global.fetch
      .mockResolvedValueOnce(response({ broadcast: { id: 'b1' }, projectName: 'Service' }))
      .mockResolvedValueOnce(response({ error: 'temporarily unavailable' }, 503));

    const { result } = renderHook(() => useActiveBroadcast({
      backendUrl: 'http://api.test',
      token: 'token',
    }));
    await waitFor(() => expect(result.current.broadcast?.id).toBe('b1'));

    await act(async () => { await result.current.reload(); });
    expect(result.current.broadcast).toEqual({ id: 'b1' });
    expect(result.current.projectName).toBe('Service');
    expect(result.current.error).toBe('temporarily unavailable');
    expect(result.current.refreshing).toBe(false);
  });

  it('ignores an older response when a newer refresh finishes first', async () => {
    let finishFirst;
    let finishSecond;
    global.fetch
      .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { finishSecond = resolve; }));

    const { result } = renderHook(() => useActiveBroadcast({
      backendUrl: 'http://api.test',
      token: 'token',
    }));
    act(() => { result.current.reload(); });

    await act(async () => {
      finishSecond(response({ broadcast: { id: 'newer' }, projectName: 'Service' }));
    });
    await act(async () => {
      finishFirst(response({ broadcast: { id: 'older' }, projectName: 'Service' }));
    });

    expect(result.current.activeBroadcastId).toBe('newer');
  });

  it('does not expose the previous project snapshot while the project scope changes', async () => {
    global.fetch
      .mockResolvedValueOnce(response({ broadcast: { id: 'project-a' }, projectName: 'Project A' }))
      .mockResolvedValueOnce(response({ broadcast: { id: 'project-b' }, projectName: 'Project B' }));

    const { result, rerender } = renderHook(
      ({ projectKey }) => useActiveBroadcast({
        backendUrl: 'http://api.test',
        token: 'token',
        projectKey,
      }),
      { initialProps: { projectKey: 'a' } },
    );
    await waitFor(() => expect(result.current.activeBroadcastId).toBe('project-a'));

    rerender({ projectKey: 'b' });
    expect(result.current.broadcast).toBeNull();
    await waitFor(() => expect(result.current.activeBroadcastId).toBe('project-b'));
  });

  it('reloads when the active-broadcast event is dispatched', async () => {
    global.fetch
      .mockResolvedValueOnce(response({ broadcast: { id: 'b1' }, projectName: 'Service' }))
      .mockResolvedValueOnce(response({ broadcast: { id: 'b2' }, projectName: 'Service' }));

    const { result } = renderHook(() => useActiveBroadcast({
      backendUrl: 'http://api.test',
      token: 'token',
    }));
    await waitFor(() => expect(result.current.activeBroadcastId).toBe('b1'));

    act(() => { window.dispatchEvent(new Event(ACTIVE_BROADCAST_EVENT)); });
    await waitFor(() => expect(result.current.activeBroadcastId).toBe('b2'));
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
