import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SessionContext } from '../../src/contexts/SessionContext.jsx';

let mockAuth;

vi.mock('../../src/hooks/useUserAuth', () => ({
  useUserAuth: () => mockAuth,
}));

vi.mock('../../src/hooks/useProjectFeatures', () => ({
  useProjectFeatures: () => ({
    features: [{ code: 'captions', enabled: true }],
    featureSet: new Set(['captions']),
    featureConfig: () => null,
    hasFeature: (c) => c === 'captions',
    loading: false,
    error: null,
    reload: vi.fn(),
    updateFeature: vi.fn(),
  }),
}));

import { ProjectSettingsPage } from '../../src/components/ProjectSettingsPage.jsx';

const MOCK_PROJECTS = [
  { key: 'key-abc-1234567890ab', owner: 'Sunday service', createdAt: '2026-01-15T00:00:00Z', myAccessLevel: 'owner' },
  { key: 'key-xyz-9876543210cd', owner: 'Wednesday night', createdAt: '2026-02-20T00:00:00Z', myAccessLevel: 'owner' },
];

function setupAuth(overrides = {}) {
  mockAuth = {
    user: { userId: 'u1', email: 'test@example.com', name: 'Test' },
    token: 'user-jwt-token',
    backendUrl: 'https://api.test',
    loading: false,
    ...overrides,
  };
}

function mockSession(overrides = {}) {
  return { connected: false, apiKey: '', backendUrl: '', ...overrides };
}

function renderPage(session = mockSession(), props = {}) {
  return render(
    <SessionContext.Provider value={session}>
      <ProjectSettingsPage {...props} />
    </SessionContext.Provider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn();
  window.history.pushState({}, '', '/');
});

describe('ProjectSettingsPage', () => {
  it('shows a sign-in prompt when not authenticated', async () => {
    setupAuth({ user: null, loading: false });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/sign in to manage projects/i)).toBeInTheDocument();
    });
  });

  it('shows "no project selected" when the active session has no matching project', async () => {
    setupAuth();
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ keys: MOCK_PROJECTS }) });

    renderPage(mockSession({ apiKey: 'nonexistent-key' }), { implicitKey: true });

    await waitFor(() => {
      expect(screen.getByText(/no project selected/i)).toBeInTheDocument();
    });
  });

  it('renders the Summary tab by default with masked key and quick links', async () => {
    setupAuth();
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ keys: MOCK_PROJECTS }) });

    renderPage(mockSession({ apiKey: MOCK_PROJECTS[0].key, connected: true }), { implicitKey: true });

    await waitFor(() => {
      expect(screen.getByText('Sunday service')).toBeInTheDocument();
    });

    expect(screen.getByText(/currently active project/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /show/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /setup/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /broadcast/i })).toBeInTheDocument();
  });

  it('resolves the project from the /projects/:key route when implicitKey is false', async () => {
    setupAuth();
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ keys: MOCK_PROJECTS }) });
    window.history.pushState({}, '', `/projects/${MOCK_PROJECTS[1].key}`);

    renderPage(mockSession());

    await waitFor(() => {
      expect(screen.getByText('Wednesday night')).toBeInTheDocument();
    });
  });

  it('switches to the Features tab and renders the feature picker', async () => {
    setupAuth();
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ keys: MOCK_PROJECTS }) });

    renderPage(mockSession({ apiKey: MOCK_PROJECTS[0].key }), { implicitKey: true });

    await waitFor(() => expect(screen.getByText('Sunday service')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Features' }));
    expect(screen.getByText(/feature access/i)).toBeInTheDocument();
  });
});
