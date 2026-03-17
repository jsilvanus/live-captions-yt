import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BroadcastPage } from '../../src/components/BroadcastPage.jsx';
import { SessionContext } from '../../src/contexts/SessionContext.jsx';
import { ToastContext } from '../../src/contexts/ToastContext.jsx';
import { LangProvider } from '../../src/contexts/LangContext.jsx';

// ---------------------------------------------------------------------------
// Mock heavy sub-components used inside BroadcastModal tabs so the test
// doesn't pull in real HTTP / Playwright / Matrox SDKs.
// ---------------------------------------------------------------------------

vi.mock('@jsilvanus/matrox-monarch-control', () => ({
  MonarchHDX: vi.fn(function () {
    this.getStatus = vi.fn().mockResolvedValue({});
    this.setEncoderRTMP = vi.fn().mockResolvedValue(undefined);
    this.startEncoder = vi.fn().mockResolvedValue(undefined);
    this.stopEncoder = vi.fn().mockResolvedValue(undefined);
  }),
}));

// YouTubeTab fetches from backend — stub auth helpers.
vi.mock('../../src/lib/youtubeAuth.js', () => ({
  requestYouTubeToken: vi.fn(),
  getYouTubeToken: vi.fn(() => null),
  revokeYouTubeToken: vi.fn(),
}));
vi.mock('../../src/lib/youtubeApi.js', () => ({
  listScheduledBroadcasts: vi.fn().mockResolvedValue([]),
  transitionBroadcast: vi.fn(),
  enableHttpCaptions: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockSession(overrides = {}) {
  return {
    connected: false,
    backendUrl: '',
    apiKey: '',
    getRelayStatus: vi.fn().mockResolvedValue(null),
    updateRelay: vi.fn().mockResolvedValue(undefined),
    configureRelay: vi.fn().mockResolvedValue(undefined),
    stopRelay: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function mockToast() {
  return { toasts: [], showToast: vi.fn(), dismissToast: vi.fn() };
}

function renderPage(session = mockSession()) {
  return render(
    <SessionContext.Provider value={session}>
      <ToastContext.Provider value={mockToast()}>
        <LangProvider>
          <BroadcastPage />
        </LangProvider>
      </ToastContext.Provider>
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

describe('BroadcastPage', () => {
  it('renders all three tab buttons', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /encoder/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /youtube/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /stream/i })).toBeInTheDocument();
  });

  it('shows Encoder tab content by default', () => {
    renderPage();
    // The Encoder tab renders the encoder type select
    expect(screen.getByText(/matrox monarch hdx/i)).toBeInTheDocument();
  });

  it('does not render a modal backdrop (inline mode)', () => {
    const { container } = renderPage();
    expect(container.querySelector('.settings-modal__backdrop')).not.toBeInTheDocument();
  });

  it('does not render a modal close button (inline mode)', () => {
    renderPage();
    expect(screen.queryByLabelText('Close')).not.toBeInTheDocument();
  });

  it('switches to YouTube tab on click', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /youtube/i }));
    // YouTube tab renders a "Sign in with Google" button or similar auth UI
    expect(screen.getByRole('button', { name: /youtube/i }).className).toContain('settings-tab--active');
  });

  it('switches to Stream tab on click', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /stream/i }));
    expect(screen.getByRole('button', { name: /stream/i }).className).toContain('settings-tab--active');
  });

  it('Encoder tab is active by default', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /encoder/i }).className).toContain('settings-tab--active');
  });

  it('wraps content in settings-page class', () => {
    const { container } = renderPage();
    expect(container.querySelector('.settings-page')).toBeInTheDocument();
  });
});
