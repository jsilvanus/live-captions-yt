import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StatusPanel } from '../../src/components/StatusPanel.jsx';
import { SessionContext } from '../../src/contexts/SessionContext.jsx';
import { ToastContext } from '../../src/contexts/ToastContext.jsx';
import { LangProvider } from '../../src/contexts/LangContext.jsx';

// ---------------------------------------------------------------------------
// Mock dependent modules that StatusPanel imports
// ---------------------------------------------------------------------------

vi.mock('../../src/lib/targetConfig', () => ({
  getEnabledTargets: vi.fn(() => []),
}));

vi.mock('../../src/lib/translationConfig', () => ({
  getEnabledTranslations: vi.fn(() => []),
}));

// Mock StatsModal and FilesModal to avoid deep dependency chains
vi.mock('../../src/components/StatsModal', () => ({
  StatsModal: ({ isOpen }) => isOpen ? <div data-testid="stats-modal">Stats</div> : null,
}));

vi.mock('../../src/components/FilesModal', () => ({
  FilesModal: ({ isOpen }) => isOpen ? <div data-testid="files-modal">Files</div> : null,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockSession(overrides = {}) {
  return {
    connected: true,
    sequence: 42,
    syncOffset: 150,
    getStats: vi.fn().mockResolvedValue({ totalCaptions: 100 }),
    getRelayStatus: vi.fn().mockResolvedValue(null),
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

function renderStatusPanel(session, toast, props = {}) {
  const s = session || mockSession();
  const t = toast || mockToast();
  const onClose = props.onClose || vi.fn();

  const result = render(
    <SessionContext.Provider value={s}>
      <ToastContext.Provider value={t}>
        <LangProvider>
          <StatusPanel onClose={onClose} />
        </LangProvider>
      </ToastContext.Provider>
    </SessionContext.Provider>
  );

  return { ...result, session: s, toast: t, onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StatusPanel', () => {
  it('renders as a floating panel with status title', () => {
    renderStatusPanel();
    // FloatingPanel renders the title; LangProvider provides translations
    const dialog = document.querySelector('.floating-panel');
    expect(dialog).not.toBeNull();
  });

  it('shows connected status when session is connected', () => {
    renderStatusPanel(mockSession({ connected: true }));
    // The connected label text comes from i18n — defaults to English
    const connectedEl = screen.getByText(/connected/i);
    expect(connectedEl).toBeInTheDocument();
  });

  it('shows disconnected status when session is disconnected', () => {
    renderStatusPanel(mockSession({ connected: false, getRelayStatus: vi.fn().mockResolvedValue(null) }));
    expect(screen.getByText(/disconnected/i)).toBeInTheDocument();
  });

  it('shows sequence number when connected', () => {
    renderStatusPanel(mockSession({ connected: true, sequence: 99 }));
    expect(screen.getByText('99')).toBeInTheDocument();
  });

  it('shows sync offset when non-zero', () => {
    renderStatusPanel(mockSession({ connected: true, syncOffset: 250 }));
    expect(screen.getByText('250ms')).toBeInTheDocument();
  });

  it('hides sync offset when zero', () => {
    renderStatusPanel(mockSession({ connected: true, syncOffset: 0 }));
    expect(screen.queryByText('0ms')).not.toBeInTheDocument();
  });

  it('opens stats modal on stats button click', async () => {
    const session = mockSession();
    renderStatusPanel(session);

    // Find stats button (contains translated text)
    const statsBtn = document.querySelectorAll('.btn--secondary')[0];
    fireEvent.click(statsBtn);

    await waitFor(() => {
      expect(session.getStats).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByTestId('stats-modal')).toBeInTheDocument();
    });
  });

  it('shows toast when stats requested while disconnected', async () => {
    const session = mockSession({ connected: false, getRelayStatus: vi.fn().mockResolvedValue(null) });
    const toast = mockToast();
    renderStatusPanel(session, toast);

    const statsBtn = document.querySelectorAll('.btn--secondary')[0];
    fireEvent.click(statsBtn);

    expect(toast.showToast).toHaveBeenCalled();
    expect(session.getStats).not.toHaveBeenCalled();
  });

  it('disables stats and files buttons when disconnected', () => {
    renderStatusPanel(mockSession({ connected: false, getRelayStatus: vi.fn().mockResolvedValue(null) }));

    const buttons = document.querySelectorAll('.btn--secondary');
    for (const btn of buttons) {
      expect(btn).toBeDisabled();
    }
  });

  it('opens files modal on files button click', () => {
    renderStatusPanel();

    const filesBtn = document.querySelectorAll('.btn--secondary')[1];
    fireEvent.click(filesBtn);

    expect(screen.getByTestId('files-modal')).toBeInTheDocument();
  });
});
