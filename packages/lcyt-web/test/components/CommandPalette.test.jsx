/**
 * Tests for CommandPalette component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommandPalette } from '../../src/components/CommandPalette.jsx';
import { SessionContext } from '../../src/contexts/SessionContext.jsx';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('wouter', () => ({
  useLocation: () => ['/', vi.fn()],
  Link: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a>,
  Router: ({ children }) => children,
  Route: ({ children }) => children,
  Switch: ({ children }) => children,
  Redirect: () => null,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockSession(overrides = {}) {
  return {
    connected: false,
    backendFeatures: null,
    healthStatus: 'unknown',
    latencyMs: null,
    reconnecting: false,
    ...overrides,
  };
}

function renderPalette(open = true, onClose = vi.fn(), session = mockSession()) {
  return render(
    <SessionContext.Provider value={session}>
      <CommandPalette open={open} onClose={onClose} />
    </SessionContext.Provider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CommandPalette', () => {
  it('renders nothing when closed', () => {
    renderPalette(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders the dialog when open', () => {
    renderPalette(true);
    expect(screen.getByRole('dialog', { name: 'Command Palette' })).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('displays navigation items', () => {
    renderPalette(true);
    // Dashboard and Settings are always visible (no feature gate)
    expect(screen.getByText(/Dashboard/)).toBeInTheDocument();
    expect(screen.getByText(/Settings/)).toBeInTheDocument();
  });

  it('filters items by query', () => {
    renderPalette(true);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'audio' } });
    const labels = document.querySelectorAll('.cmd-palette__item-label');
    const texts = Array.from(labels).map(el => el.textContent);
    expect(texts.some(t => /audio/i.test(t))).toBe(true);
    expect(texts.every(t => !/dashboard/i.test(t))).toBe(true);
  });

  it('closes on Escape key', () => {
    const onClose = vi.fn();
    renderPalette(true, onClose);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes when backdrop is clicked', () => {
    const onClose = vi.fn();
    renderPalette(true, onClose);
    const backdrop = document.querySelector('.cmd-palette-backdrop');
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('highlights first item by default', () => {
    renderPalette(true);
    const activeItems = document.querySelectorAll('.cmd-palette__item--active');
    expect(activeItems.length).toBe(1);
  });

  it('moves selection down with ArrowDown', () => {
    renderPalette(true);
    const input = screen.getByRole('combobox');

    // Initially item 0 is active
    let activeItems = document.querySelectorAll('.cmd-palette__item--active');
    const firstLabel = activeItems[0]?.textContent;

    fireEvent.keyDown(input, { key: 'ArrowDown' });

    activeItems = document.querySelectorAll('.cmd-palette__item--active');
    expect(activeItems[0]?.textContent).not.toBe(firstLabel);
  });

  it('moves selection up with ArrowUp (does not go below 0)', () => {
    renderPalette(true);
    const input = screen.getByRole('combobox');

    // Already at index 0; ArrowUp should stay at 0
    fireEvent.keyDown(input, { key: 'ArrowUp' });

    const activeItems = document.querySelectorAll('.cmd-palette__item--active');
    expect(activeItems.length).toBe(1);
  });

  it('shows empty state when no items match query', () => {
    renderPalette(true);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'xyznonexistent' } });
    expect(screen.getByText(/No pages match/)).toBeInTheDocument();
  });

  it('filters out feature-gated items when feature is absent', () => {
    const session = mockSession({ backendFeatures: ['captions'] });
    renderPalette(true, vi.fn(), session);
    // 'rtmp' feature gates Broadcast; should not appear
    expect(screen.queryByText(/Broadcast/)).not.toBeInTheDocument();
  });

  it('shows feature-gated items when feature is present', () => {
    const session = mockSession({ backendFeatures: ['captions', 'rtmp'] });
    renderPalette(true, vi.fn(), session);
    const labels = document.querySelectorAll('.cmd-palette__item-label');
    const texts = Array.from(labels).map(el => el.textContent);
    expect(texts.some(t => /broadcast/i.test(t))).toBe(true);
  });
});
