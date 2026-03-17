/**
 * Tests for useToast hook and ToastContainer component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, render, screen, act, fireEvent } from '@testing-library/react';
import { useToast } from '../../src/hooks/useToast.js';
import { ToastProvider } from '../../src/contexts/ToastContext.jsx';
import { ToastContainer } from '../../src/components/ToastContainer.jsx';

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// useToast hook
// ---------------------------------------------------------------------------

describe('useToast — initial state', () => {
  it('starts with an empty toasts list', () => {
    const { result } = renderHook(() => useToast());
    expect(result.current.toasts).toEqual([]);
  });
});

describe('useToast — showToast()', () => {
  it('adds a toast to the list', () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.showToast('Hello!');
    });
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].message).toBe('Hello!');
  });

  it('defaults to type "info"', () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.showToast('Hello!');
    });
    expect(result.current.toasts[0].type).toBe('info');
  });

  it('accepts a custom type', () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.showToast('Error!', 'error');
    });
    expect(result.current.toasts[0].type).toBe('error');
  });

  it('assigns a unique id to each toast', () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.showToast('A');
      result.current.showToast('B');
    });
    const ids = result.current.toasts.map(t => t.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('auto-dismisses after the duration elapses', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.showToast('Bye', 'info', 1000);
    });
    expect(result.current.toasts).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(1001);
    });
    expect(result.current.toasts).toHaveLength(0);
    vi.useRealTimers();
  });

  it('does NOT auto-dismiss when duration=0', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.showToast('Sticky', 'info', 0);
    });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current.toasts).toHaveLength(1);
    vi.useRealTimers();
  });
});

describe('useToast — dismissToast()', () => {
  it('removes the toast with the given id', () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.showToast('A');
    });
    const id = result.current.toasts[0].id;
    act(() => {
      result.current.dismissToast(id);
    });
    expect(result.current.toasts).toHaveLength(0);
  });

  it('only removes the matching toast', () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.showToast('A');
      result.current.showToast('B');
    });
    const firstId = result.current.toasts[0].id;
    act(() => {
      result.current.dismissToast(firstId);
    });
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].message).toBe('B');
  });

  it('is a no-op for unknown id', () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.showToast('A');
    });
    act(() => {
      result.current.dismissToast(99999);
    });
    expect(result.current.toasts).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// ToastContainer component
// ---------------------------------------------------------------------------

function Wrapper({ children }) {
  return <ToastProvider>{children}</ToastProvider>;
}

describe('ToastContainer', () => {
  it('renders without crashing when there are no toasts', () => {
    render(<Wrapper><ToastContainer /></Wrapper>);
    expect(document.getElementById('toast-container')).toBeInTheDocument();
  });

  it('renders a toast message', async () => {
    const { ToastContext } = await import('../../src/contexts/ToastContext.jsx');
    const mockCtx = {
      toasts: [{ id: 1, message: 'Hello toast!', type: 'info', duration: 5000 }],
      dismissToast: vi.fn(),
    };
    render(
      <ToastContext.Provider value={mockCtx}>
        <ToastContainer />
      </ToastContext.Provider>
    );
    expect(screen.getByText('Hello toast!')).toBeInTheDocument();
  });

  it('renders toast with correct CSS class', async () => {
    const { ToastContext } = await import('../../src/contexts/ToastContext.jsx');
    const mockCtx = {
      toasts: [{ id: 1, message: 'Alert!', type: 'error', duration: 5000 }],
      dismissToast: vi.fn(),
    };
    render(
      <ToastContext.Provider value={mockCtx}>
        <ToastContainer />
      </ToastContext.Provider>
    );
    expect(screen.getByText('Alert!')).toBeInTheDocument();
    expect(document.querySelector('.toast--error')).toBeInTheDocument();
  });

  it('renders multiple toasts', async () => {
    const { ToastContext } = await import('../../src/contexts/ToastContext.jsx');
    const mockCtx = {
      toasts: [
        { id: 1, message: 'First', type: 'info', duration: 5000 },
        { id: 2, message: 'Second', type: 'warning', duration: 5000 },
      ],
      dismissToast: vi.fn(),
    };
    render(
      <ToastContext.Provider value={mockCtx}>
        <ToastContainer />
      </ToastContext.Provider>
    );
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
  });

  it('calls dismissToast when a toast is clicked', async () => {
    vi.useFakeTimers();
    const { ToastContext } = await import('../../src/contexts/ToastContext.jsx');
    const dismissToast = vi.fn();
    const mockCtx = {
      toasts: [{ id: 42, message: 'Click me', type: 'info', duration: 5000 }],
      dismissToast,
    };
    render(
      <ToastContext.Provider value={mockCtx}>
        <ToastContainer />
      </ToastContext.Provider>
    );
    fireEvent.click(screen.getByText('Click me'));
    // dismissToast is called after 200ms fade-out
    act(() => { vi.advanceTimersByTime(200); });
    expect(dismissToast).toHaveBeenCalledWith(42);
    vi.useRealTimers();
  });
});
