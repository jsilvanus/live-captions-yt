import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BroadcastPage } from '../../src/components/BroadcastPage.jsx';
import { SessionContext } from '../../src/contexts/SessionContext.jsx';
import { ToastContext } from '../../src/contexts/ToastContext.jsx';
import { LangProvider } from '../../src/contexts/LangContext.jsx';

// ---------------------------------------------------------------------------
// Mock heavy sub-components used inside SettingsTab / LiveTab so the test
// doesn't pull in real HTTP / Playwright / Matrox SDKs or react-grid-layout.
// ---------------------------------------------------------------------------

vi.mock('@jsilvanus/matrox-monarch-control', () => ({
  MonarchHDX: vi.fn(function () {
    this.getStatus = vi.fn().mockResolvedValue({});
    this.setEncoderRTMP = vi.fn().mockResolvedValue(undefined);
    this.startEncoder = vi.fn().mockResolvedValue(undefined);
    this.stopEncoder = vi.fn().mockResolvedValue(undefined);
  }),
}));

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

vi.mock('react-grid-layout', () => ({
  Responsive: ({ children, ...props }) => (
    <div data-testid="responsive" data-props={JSON.stringify(props)}>{children}</div>
  ),
  useContainerWidth: () => ({ width: 1200, containerRef: { current: null }, mounted: true }),
}));

vi.mock('../../src/hooks/useDashboardConfig', () => ({
  useDashboardConfig: () => ({
    config: { panels: ['status', 'input'], layouts: {} },
    setPanels: vi.fn(),
    updateLayouts: vi.fn(),
    removePanel: vi.fn(),
  }),
  WIDGET_REGISTRY: [
    { id: 'status', title: 'Status', defaultLayout: { w: 3, h: 4, minW: 2, minH: 3 } },
    { id: 'input', title: 'Quick Send', defaultLayout: { w: 6, h: 2, minW: 3, minH: 2 } },
  ],
}));

vi.mock('../../src/components/dashboard/StatusWidget', () => ({
  __esModule: true, StatusWidget: () => (<div data-testid="StatusWidget" />), default: () => (<div data-testid="StatusWidget" />),
}));
vi.mock('../../src/components/dashboard/SentLogWidget', () => ({
  __esModule: true, SentLogWidget: () => (<div data-testid="SentLogWidget" />), default: () => (<div data-testid="SentLogWidget" />),
}));
vi.mock('../../src/components/dashboard/AudioWidget', () => ({
  __esModule: true, AudioWidget: () => (<div data-testid="AudioWidget" />), default: () => (<div data-testid="AudioWidget" />),
}));
vi.mock('../../src/components/dashboard/InputWidget', () => ({
  __esModule: true, InputWidget: () => (<div data-testid="InputWidget" />), default: () => (<div data-testid="InputWidget" />),
}));
vi.mock('../../src/components/dashboard/FileWidget', () => ({
  __esModule: true, FileWidget: () => (<div data-testid="FileWidget" />), default: () => (<div data-testid="FileWidget" />),
}));
vi.mock('../../src/components/dashboard/BroadcastWidget', () => ({
  __esModule: true, BroadcastWidget: () => (<div data-testid="BroadcastWidget" />), default: () => (<div data-testid="BroadcastWidget" />),
}));
vi.mock('../../src/components/dashboard/ViewerWidget', () => ({
  __esModule: true, ViewerWidget: () => (<div data-testid="ViewerWidget" />), default: () => (<div data-testid="ViewerWidget" />),
}));
vi.mock('../../src/components/dashboard/ViewportsWidget', () => ({
  __esModule: true, ViewportsWidget: () => (<div data-testid="ViewportsWidget" />), default: () => (<div data-testid="ViewportsWidget" />),
}));
vi.mock('../../src/components/dashboard/MetacodeWidget', () => ({
  __esModule: true, MetacodeWidget: () => (<div data-testid="MetacodeWidget" />), default: () => (<div data-testid="MetacodeWidget" />),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockSession(overrides = {}) {
  return {
    connected: false,
    backendUrl: '',
    apiKey: '',
    backendFeatures: null,
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
  it('renders Live and Settings top-level tabs', () => {
    const { container } = renderPage();
    const tabBar = container.querySelector('.broadcast-page__tabs');
    const labels = Array.from(tabBar.querySelectorAll('.settings-tab')).map(b => b.textContent.trim());
    expect(labels).toEqual(['Live', 'Settings']);
  });

  it('shows the Live tab (widget grid) by default', () => {
    renderPage();
    expect(screen.getByTestId('responsive')).toBeInTheDocument();
  });

  it('switches to Settings tab and shows Encoder/YouTube/Stream sub-tabs', () => {
    const { container } = renderPage();
    const tabBar = container.querySelector('.broadcast-page__tabs');
    const settingsTab = Array.from(tabBar.querySelectorAll('.settings-tab')).find(b => b.textContent.trim() === 'Settings');
    fireEvent.click(settingsTab);

    const subTabBar = container.querySelector('.broadcast-settings-tab .settings-modal__tabs');
    const subLabels = Array.from(subTabBar.querySelectorAll('.settings-tab')).map(b => b.textContent.trim());
    expect(subLabels).toContain('Encoder');
    expect(subLabels).toContain('YouTube');
    expect(subLabels).toContain('Stream');
  });

  it('hides the Stream sub-tab when the rtmp feature is absent', () => {
    const { container } = renderPage(mockSession({ backendFeatures: ['captions'] }));
    const tabBar = container.querySelector('.broadcast-page__tabs');
    const settingsTab = Array.from(tabBar.querySelectorAll('.settings-tab')).find(b => b.textContent.trim() === 'Settings');
    fireEvent.click(settingsTab);

    const subTabBar = container.querySelector('.broadcast-settings-tab .settings-modal__tabs');
    const subLabels = Array.from(subTabBar.querySelectorAll('.settings-tab')).map(b => b.textContent.trim());
    expect(subLabels).not.toContain('Stream');
  });

  it('wraps content in settings-page class', () => {
    const { container } = renderPage();
    expect(container.querySelector('.settings-page')).toBeInTheDocument();
  });
});
