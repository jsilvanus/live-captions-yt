/**
 * Tests for useSentLog hook.
 *
 * localStorage is cleared between tests in test/setup.vitest.js.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSentLog } from '../../src/hooks/useSentLog.js';

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe('useSentLog — initial state', () => {
  it('starts with an empty entries list', () => {
    const { result } = renderHook(() => useSentLog());
    expect(result.current.entries).toEqual([]);
  });

  it('restores confirmed entries from localStorage on mount', () => {
    const saved = [
      { requestId: 'r1', text: 'Hello', pending: false, error: false, sequence: 1 },
    ];
    localStorage.setItem('lcyt:sent-log', JSON.stringify(saved));

    const { result } = renderHook(() => useSentLog());
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].requestId).toBe('r1');
  });

  it('returns empty list when localStorage has invalid JSON', () => {
    localStorage.setItem('lcyt:sent-log', 'not-json');
    const { result } = renderHook(() => useSentLog());
    expect(result.current.entries).toEqual([]);
  });

  it('returns empty list when localStorage value is not an array', () => {
    localStorage.setItem('lcyt:sent-log', JSON.stringify({ invalid: true }));
    const { result } = renderHook(() => useSentLog());
    expect(result.current.entries).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// add()
// ---------------------------------------------------------------------------

describe('useSentLog — add()', () => {
  it('adds an entry to the front of the list', () => {
    const { result } = renderHook(() => useSentLog());
    act(() => {
      result.current.add({ requestId: 'r1', sequence: 1, text: 'Hello' });
    });
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].text).toBe('Hello');
  });

  it('prepends newer entries (newest-first order)', () => {
    const { result } = renderHook(() => useSentLog());
    act(() => {
      result.current.add({ requestId: 'r1', sequence: 1, text: 'First' });
      result.current.add({ requestId: 'r2', sequence: 2, text: 'Second' });
    });
    expect(result.current.entries[0].text).toBe('Second');
    expect(result.current.entries[1].text).toBe('First');
  });

  it('sets pending=false by default', () => {
    const { result } = renderHook(() => useSentLog());
    act(() => {
      result.current.add({ requestId: 'r1', sequence: 1, text: 'Hello' });
    });
    expect(result.current.entries[0].pending).toBe(false);
  });

  it('sets pending=true when passed', () => {
    const { result } = renderHook(() => useSentLog());
    act(() => {
      result.current.add({ requestId: 'r1', sequence: 1, text: 'Hello', pending: true });
    });
    expect(result.current.entries[0].pending).toBe(true);
  });

  it('sets error=false on new entries', () => {
    const { result } = renderHook(() => useSentLog());
    act(() => {
      result.current.add({ requestId: 'r1', sequence: 1, text: 'Hello' });
    });
    expect(result.current.entries[0].error).toBe(false);
  });

  it('adds a timestamp to each entry', () => {
    const { result } = renderHook(() => useSentLog());
    act(() => {
      result.current.add({ requestId: 'r1', sequence: 1, text: 'Hello' });
    });
    expect(result.current.entries[0].timestamp).toBeDefined();
    expect(() => new Date(result.current.entries[0].timestamp)).not.toThrow();
  });

  it('does not persist pending entries to localStorage', () => {
    const { result } = renderHook(() => useSentLog());
    act(() => {
      result.current.add({ requestId: 'r1', sequence: 1, text: 'Hello', pending: true });
    });
    const stored = JSON.parse(localStorage.getItem('lcyt:sent-log') || '[]');
    expect(stored).toHaveLength(0);
  });

  it('persists confirmed (non-pending) entries to localStorage', () => {
    const { result } = renderHook(() => useSentLog());
    act(() => {
      result.current.add({ requestId: 'r1', sequence: 1, text: 'Hello' });
    });
    const stored = JSON.parse(localStorage.getItem('lcyt:sent-log') || '[]');
    expect(stored).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// confirm()
// ---------------------------------------------------------------------------

describe('useSentLog — confirm()', () => {
  it('clears the pending flag by requestId string', () => {
    const { result } = renderHook(() => useSentLog());
    act(() => {
      result.current.add({ requestId: 'r1', sequence: 1, text: 'Hello', pending: true });
    });
    act(() => {
      result.current.confirm('r1', { sequence: 2, serverTimestamp: '2026-01-01T00:00:00.000' });
    });
    expect(result.current.entries[0].pending).toBe(false);
  });

  it('accepts an object argument for requestId', () => {
    const { result } = renderHook(() => useSentLog());
    act(() => {
      result.current.add({ requestId: 'r1', sequence: 1, text: 'Hello', pending: true });
    });
    act(() => {
      result.current.confirm({ requestId: 'r1', sequence: 2, serverTimestamp: '2026-01-01T00:00:00.000' });
    });
    expect(result.current.entries[0].pending).toBe(false);
  });

  it('updates the sequence from the server', () => {
    const { result } = renderHook(() => useSentLog());
    act(() => {
      result.current.add({ requestId: 'r1', sequence: 0, text: 'Hello', pending: true });
    });
    act(() => {
      result.current.confirm('r1', { sequence: 42 });
    });
    expect(result.current.entries[0].sequence).toBe(42);
  });

  it('is a no-op for unknown requestId', () => {
    const { result } = renderHook(() => useSentLog());
    act(() => {
      result.current.add({ requestId: 'r1', sequence: 1, text: 'Hello', pending: true });
    });
    act(() => {
      result.current.confirm('unknown-id');
    });
    expect(result.current.entries[0].pending).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// markError()
// ---------------------------------------------------------------------------

describe('useSentLog — markError()', () => {
  it('sets error=true on the matching entry', () => {
    const { result } = renderHook(() => useSentLog());
    act(() => {
      result.current.add({ requestId: 'r1', sequence: 1, text: 'Hello', pending: true });
    });
    act(() => {
      result.current.markError('r1');
    });
    expect(result.current.entries[0].error).toBe(true);
  });

  it('clears the pending flag when marking error', () => {
    const { result } = renderHook(() => useSentLog());
    act(() => {
      result.current.add({ requestId: 'r1', sequence: 1, text: 'Hello', pending: true });
    });
    act(() => {
      result.current.markError('r1');
    });
    expect(result.current.entries[0].pending).toBe(false);
  });

  it('does not persist error entries to localStorage', () => {
    const { result } = renderHook(() => useSentLog());
    act(() => {
      result.current.add({ requestId: 'r1', sequence: 1, text: 'Hello', pending: true });
    });
    act(() => {
      result.current.markError('r1');
    });
    const stored = JSON.parse(localStorage.getItem('lcyt:sent-log') || '[]');
    expect(stored.filter(e => e.error)).toHaveLength(0);
  });

  it('is a no-op for unknown requestId', () => {
    const { result } = renderHook(() => useSentLog());
    act(() => {
      result.current.add({ requestId: 'r1', sequence: 1, text: 'Hello', pending: true });
    });
    act(() => {
      result.current.markError('unknown-id');
    });
    expect(result.current.entries[0].error).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// updateRequestId()
// ---------------------------------------------------------------------------

describe('useSentLog — updateRequestId()', () => {
  it('remaps oldId to newId', () => {
    const { result } = renderHook(() => useSentLog());
    act(() => {
      result.current.add({ requestId: 'temp-1', sequence: 1, text: 'Hello', pending: true });
    });
    act(() => {
      result.current.updateRequestId('temp-1', 'real-server-id');
    });
    expect(result.current.entries[0].requestId).toBe('real-server-id');
  });

  it('is a no-op for unknown oldId', () => {
    const { result } = renderHook(() => useSentLog());
    act(() => {
      result.current.add({ requestId: 'r1', sequence: 1, text: 'Hello' });
    });
    act(() => {
      result.current.updateRequestId('unknown', 'new-id');
    });
    expect(result.current.entries[0].requestId).toBe('r1');
  });
});

// ---------------------------------------------------------------------------
// clear()
// ---------------------------------------------------------------------------

describe('useSentLog — clear()', () => {
  it('removes all entries from the list', () => {
    const { result } = renderHook(() => useSentLog());
    act(() => {
      result.current.add({ requestId: 'r1', sequence: 1, text: 'A' });
      result.current.add({ requestId: 'r2', sequence: 2, text: 'B' });
    });
    act(() => {
      result.current.clear();
    });
    expect(result.current.entries).toHaveLength(0);
  });

  it('empties the localStorage entry', () => {
    const { result } = renderHook(() => useSentLog());
    act(() => {
      result.current.add({ requestId: 'r1', sequence: 1, text: 'A' });
    });
    act(() => {
      result.current.clear();
    });
    // The useEffect re-saves [] after clear() removes the key, so the result is an empty array.
    const raw = localStorage.getItem('lcyt:sent-log');
    const stored = raw ? JSON.parse(raw) : [];
    expect(stored).toHaveLength(0);
  });
});
