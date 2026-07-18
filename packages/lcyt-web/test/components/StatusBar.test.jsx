import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StatusBar } from '../../src/components/StatusBar.jsx';
import { SessionContext } from '../../src/contexts/SessionContext.jsx';
import { ToastContext } from '../../src/contexts/ToastContext.jsx';
import { LangProvider } from '../../src/contexts/LangContext.jsx';

// ---------------------------------------------------------------------------
// Mock wouter — StatusBar uses useLocation() to navigate to / and /settings.
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
    disconnect: vi.fn().mockResolvedValue(undefined),
    clearPersistedConfig: vi.fn(),
    getPersistedConfig: vi.fn(() => ({ backendUrl: 'https://api.test', apiKey: 'key123' })),
    getSttStatus: vi.fn().mockResolvedValue({ running: false }),
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
  const callbacks = { ...props };

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
//
// StatusBar was redesigned (project-routing work, plan/broadcasts era) into
// a project-scoped header: it no longer owns connect/disconnect or the
// Settings/CC/Broadcast/Controls/Privacy buttons (those moved elsewhere).
// It now just shows the brand, an optional STT status chip, MusicChip, and
// "Leave project" / "Log out" actions.

describe('StatusBar', () => {
  it('renders brand name', () => {
    renderStatusBar();
    expect(screen.getByText('lcyt-web')).toBeInTheDocument();
  });

  it('renders Leave project and Log out buttons', () => {
    renderStatusBar();
    expect(screen.getByTitle('Leave project')).toBeInTheDocument();
    expect(screen.getByTitle('Log out')).toBeInTheDocument();
  });

  it('does not show an STT chip when STT is not running', async () => {
    renderStatusBar({ session: mockSession({ connected: true }) });
    await waitFor(() => {
      expect(document.querySelector('.status-bar__stt-chip--active')).toBeNull();
    });
  });

  it('shows an STT chip while connected and STT is running', async () => {
    const session = mockSession({
      connected: true,
      getSttStatus: vi.fn().mockResolvedValue({ running: true, provider: 'google', mode: 'rest', language: 'en-US' }),
    });
    renderStatusBar({ session });

    await waitFor(() => {
      expect(screen.getByText('STT: google/rest / en-US')).toBeInTheDocument();
    });
  });

  it('navigates to /settings?tab=cc when the STT chip is clicked (no onCCOpen)', async () => {
    const session = mockSession({
      connected: true,
      getSttStatus: vi.fn().mockResolvedValue({ running: true, provider: 'google', mode: null, language: 'en-US' }),
    });
    renderStatusBar({ session });

    await waitFor(() => screen.getByText('STT: google / en-US'));
    fireEvent.click(screen.getByText('STT: google / en-US'));
    expect(mockNavigate).toHaveBeenCalledWith('/settings?tab=cc');
  });

  it('calls onCCOpen instead of navigating when the STT chip is clicked and onCCOpen is provided', async () => {
    const session = mockSession({
      connected: true,
      getSttStatus: vi.fn().mockResolvedValue({ running: true, provider: 'google', mode: null, language: 'en-US' }),
    });
    const onCCOpen = vi.fn();
    renderStatusBar({ session, onCCOpen });

    await waitFor(() => screen.getByText('STT: google / en-US'));
    fireEvent.click(screen.getByText('STT: google / en-US'));
    expect(onCCOpen).toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('clicking Leave project disconnects, strips project credentials, toasts, and navigates home', async () => {
    localStorage.setItem('lcyt.session.config', JSON.stringify({
      backendUrl: 'https://api.test', apiKey: 'key123', projectId: 'p1', projectAccessToken: 'tok',
    }));
    const session = mockSession();
    const toast = mockToast();
    renderStatusBar({ session, toast });

    fireEvent.click(screen.getByTitle('Leave project'));

    await waitFor(() => {
      expect(session.disconnect).toHaveBeenCalled();
      expect(toast.showToast).toHaveBeenCalledWith('Left project', 'info');
      expect(mockNavigate).toHaveBeenCalledWith('/');
    });

    const persisted = JSON.parse(localStorage.getItem('lcyt.session.config'));
    expect(persisted.apiKey).toBeUndefined();
    expect(persisted.projectId).toBeUndefined();
    expect(persisted.projectAccessToken).toBeUndefined();
    expect(persisted.backendUrl).toBe('https://api.test');
  });

  it('clicking Log out disconnects, clears the persisted config, toasts, and navigates home', async () => {
    const session = mockSession();
    const toast = mockToast();
    renderStatusBar({ session, toast });

    fireEvent.click(screen.getByTitle('Log out'));

    await waitFor(() => {
      expect(session.disconnect).toHaveBeenCalled();
      expect(session.clearPersistedConfig).toHaveBeenCalled();
      expect(toast.showToast).toHaveBeenCalledWith('Logged out', 'info');
      expect(mockNavigate).toHaveBeenCalledWith('/');
    });
  });
});
