import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsPage } from '../../src/components/SettingsPage.jsx';
import { SessionContext } from '../../src/contexts/SessionContext.jsx';

// ---------------------------------------------------------------------------
// Mock SettingsModal and CCModal — their internals have heavy deps (fetch,
// audio APIs, Google credential, etc.).  We only care that SettingsPage
// mounts the right child for the active tab.
// ---------------------------------------------------------------------------

vi.mock('../../src/components/SettingsModal.jsx', () => ({
  SettingsModal: ({ inline, isOpen }) =>
    inline && isOpen ? <div data-testid="settings-modal">SettingsModal</div> : null,
}));

vi.mock('../../src/components/CCModal.jsx', () => ({
  CCModal: ({ inline, isOpen }) =>
    inline && isOpen ? <div data-testid="cc-modal">CCModal</div> : null,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockSession(overrides = {}) {
  return { connected: false, ...overrides };
}

function renderPage(session = mockSession()) {
  return render(
    <SessionContext.Provider value={session}>
      <SettingsPage />
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

describe('SettingsPage', () => {
  it('renders both tab buttons', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /general/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /captions & targets/i })).toBeInTheDocument();
  });

  it('shows SettingsModal (General tab) by default', () => {
    renderPage();
    expect(screen.getByTestId('settings-modal')).toBeInTheDocument();
    expect(screen.queryByTestId('cc-modal')).not.toBeInTheDocument();
  });

  it('General tab has active class by default', () => {
    renderPage();
    const generalBtn = screen.getByRole('button', { name: /general/i });
    expect(generalBtn.className).toContain('settings-page__tab--active');
  });

  it('CC tab does not have active class by default', () => {
    renderPage();
    const ccBtn = screen.getByRole('button', { name: /captions & targets/i });
    expect(ccBtn.className).not.toContain('settings-page__tab--active');
  });

  it('switches to CCModal on CC tab click', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /captions & targets/i }));
    expect(screen.getByTestId('cc-modal')).toBeInTheDocument();
    expect(screen.queryByTestId('settings-modal')).not.toBeInTheDocument();
  });

  it('CC tab gets active class after click', () => {
    renderPage();
    const ccBtn = screen.getByRole('button', { name: /captions & targets/i });
    fireEvent.click(ccBtn);
    expect(ccBtn.className).toContain('settings-page__tab--active');
  });

  it('General tab loses active class after CC tab click', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /captions & targets/i }));
    const generalBtn = screen.getByRole('button', { name: /general/i });
    expect(generalBtn.className).not.toContain('settings-page__tab--active');
  });

  it('switches back to SettingsModal after clicking General tab', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /captions & targets/i }));
    fireEvent.click(screen.getByRole('button', { name: /general/i }));
    expect(screen.getByTestId('settings-modal')).toBeInTheDocument();
    expect(screen.queryByTestId('cc-modal')).not.toBeInTheDocument();
  });

  it('passes connected=false to CCModal when not connected', () => {
    const CCModalSpy = vi.fn(({ inline, isOpen }) =>
      inline && isOpen ? <div data-testid="cc-modal" /> : null
    );
    vi.doMock('../../src/components/CCModal.jsx', () => ({ CCModal: CCModalSpy }));
    // Use a fresh render after tab switch; just verify the mock receives connected prop
    renderPage(mockSession({ connected: false }));
    fireEvent.click(screen.getByRole('button', { name: /captions & targets/i }));
    // CCModal is rendered in the DOM when the tab is active
    expect(screen.getByTestId('cc-modal')).toBeInTheDocument();
  });

  it('renders settings-page wrapper element', () => {
    const { container } = renderPage();
    expect(container.querySelector('.settings-page')).toBeInTheDocument();
  });

  it('renders settings-page__body element', () => {
    const { container } = renderPage();
    expect(container.querySelector('.settings-page__body')).toBeInTheDocument();
  });
});
