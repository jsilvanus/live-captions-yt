import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StatusBar } from '../../src/components/StatusBar.jsx';
import { SessionContext } from '../../src/contexts/SessionContext.jsx';
import { ToastContext } from '../../src/contexts/ToastContext.jsx';
import { LangProvider } from '../../src/contexts/LangContext.jsx';

// ---------------------------------------------------------------------------
// Mock wouter — StatusBar now uses useLocation() to navigate to /settings etc.
// ---------------------------------------------------------------------------

const mockNavigate = vi.fn();

vi.mock('wouter', () => ({
  useLocation: () => ['/captions', mockNavigate],
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockSession(overrides = {}) {
  return {
    connected: false,
    sequence: 0,
    syncOffset: 0,
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    getPersistedConfig: vi.fn(() => ({ backendUrl: 'https://api.test', apiKey: 'key123' })),
    ...overrides,
  };
}

function mockToast() {
  return {
    toasts: [],
    showToast: vi.fn(),
    dismissToast: vi.fn(),
  };
}

function renderStatusBar({ session, toast, ...props } = {}) {
  const s = session || mockSession();
  const t = toast || mockToast();
  const callbacks = {
    onControlsOpen: vi.fn(),
    onPrivacyOpen: vi.fn(),
    ...props,
  };

  const result = render(
    <SessionContext.Provider value={s}>
      <ToastContext.Provider value={t}>
        <LangProvider>
          <StatusBar {...callbacks} />
        </LangProvider>
      </ToastContext.Provider>
    </SessionContext.Provider>
  );

  return { ...result, session: s, toast: t, callbacks };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StatusBar', () => {
  it('renders brand name', () => {
    renderStatusBar();
    expect(screen.getByText('lcyt-web')).toBeInTheDocument();
  });

  it('shows connect button when disconnected', () => {
    renderStatusBar();
    const btn = screen.getByTitle(/connect/i);
    expect(btn).toBeInTheDocument();
    expect(btn).not.toBeDisabled();
  });

  it('shows disconnect button when connected', () => {
    renderStatusBar({ session: mockSession({ connected: true }) });
    expect(screen.getByTitle(/disconnect/i)).toBeInTheDocument();
  });

  it('calls session.connect when connect button is clicked', async () => {
    const session = mockSession();
    renderStatusBar({ session });

    fireEvent.click(screen.getByTitle(/connect/i));

    await waitFor(() => {
      expect(session.connect).toHaveBeenCalledWith({ backendUrl: 'https://api.test', apiKey: 'key123' });
    });
  });

  it('calls session.disconnect when already connected', async () => {
    const session = mockSession({ connected: true });
    renderStatusBar({ session });

    fireEvent.click(screen.getByTitle(/disconnect/i));

    await waitFor(() => {
      expect(session.disconnect).toHaveBeenCalled();
    });
  });

  it('navigates to /settings when connecting with no config', async () => {
    const session = mockSession({
      getPersistedConfig: vi.fn(() => ({ backendUrl: '', apiKey: '' })),
    });
    renderStatusBar({ session });

    fireEvent.click(screen.getByTitle(/connect/i));

    expect(mockNavigate).toHaveBeenCalledWith('/settings');
    expect(session.connect).not.toHaveBeenCalled();
  });

  it('shows toast on connection error', async () => {
    const session = mockSession();
    session.connect.mockRejectedValue(new Error('Connection refused'));
    const toast = mockToast();
    renderStatusBar({ session, toast });

    fireEvent.click(screen.getByTitle(/connect/i));

    await waitFor(() => {
      expect(toast.showToast).toHaveBeenCalledWith('Connection refused', 'error');
    });
  });

  it('navigates to /settings on Settings button click', () => {
    renderStatusBar();
    fireEvent.click(screen.getByTitle('Settings'));
    expect(mockNavigate).toHaveBeenCalledWith('/settings');
  });

  it('navigates to /settings?tab=cc on CC button click', () => {
    renderStatusBar();
    fireEvent.click(screen.getByTitle('CC'));
    expect(mockNavigate).toHaveBeenCalledWith('/settings?tab=cc');
  });

  it('navigates to /broadcast on Broadcast button click', () => {
    renderStatusBar();
    fireEvent.click(screen.getByTitle('Broadcast'));
    expect(mockNavigate).toHaveBeenCalledWith('/broadcast');
  });

  it('fires onControlsOpen callback', () => {
    const callbacks = { onControlsOpen: vi.fn() };
    renderStatusBar(callbacks);
    fireEvent.click(screen.getByTitle('Controls'));
    expect(callbacks.onControlsOpen).toHaveBeenCalled();
  });

  it('fires onPrivacyOpen callback', () => {
    const callbacks = { onPrivacyOpen: vi.fn() };
    renderStatusBar(callbacks);
    fireEvent.click(screen.getByTitle('Privacy'));
    expect(callbacks.onPrivacyOpen).toHaveBeenCalled();
  });

  it('disables connect button while connecting', async () => {
    let resolveConnect;
    const session = mockSession();
    session.connect.mockReturnValue(new Promise(r => { resolveConnect = r; }));
    renderStatusBar({ session });

    fireEvent.click(screen.getByTitle(/connect/i));

    await waitFor(() => {
      const btn = document.querySelector('.status-bar__btn--connecting');
      expect(btn).not.toBeNull();
      expect(btn).toBeDisabled();
    });

    resolveConnect();
  });
});

