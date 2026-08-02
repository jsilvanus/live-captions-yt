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

  describe('Team visibility section', () => {
    const OWNER_PROJECT = {
      key: 'key-vis-owner', owner: 'Owned project', createdAt: '2026-01-01T00:00:00Z',
      myAccessLevel: 'owner', restricted: true, orgBaselineRole: 'viewer',
    };
    const TEAM_VISIBLE_PROJECT = {
      key: 'key-vis-team', owner: 'Team-visible project', createdAt: '2026-01-01T00:00:00Z',
      myAccessLevel: 'admin', restricted: false, orgBaselineRole: 'editor',
    };
    const MEMBER_PROJECT = {
      key: 'key-vis-member', owner: 'Member-only project', createdAt: '2026-01-01T00:00:00Z',
      myAccessLevel: 'editor', restricted: false, orgBaselineRole: 'viewer',
    };

    it('renders the toggle unchecked (private) with no ceiling picker for a restricted project', async () => {
      setupAuth();
      global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ keys: [OWNER_PROJECT] }) });

      renderPage(mockSession({ apiKey: OWNER_PROJECT.key }), { implicitKey: true });

      await waitFor(() => expect(screen.getByText('Owned project')).toBeInTheDocument());
      expect(screen.getByText('Team visibility')).toBeInTheDocument();
      const checkbox = screen.getByRole('checkbox', { name: /visible to my organization/i });
      expect(checkbox.checked).toBe(false);
      expect(screen.queryByText(/access ceiling for org members/i)).not.toBeInTheDocument();
    });

    it('shows the ceiling picker bound to orgBaselineRole for a team-visible project', async () => {
      setupAuth();
      global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ keys: [TEAM_VISIBLE_PROJECT] }) });

      renderPage(mockSession({ apiKey: TEAM_VISIBLE_PROJECT.key }), { implicitKey: true });

      await waitFor(() => expect(screen.getByText('Team-visible project')).toBeInTheDocument());
      const checkbox = screen.getByRole('checkbox', { name: /visible to my organization/i });
      expect(checkbox.checked).toBe(true);
      const ceilingSelect = screen.getByText(/access ceiling for org members/i).nextElementSibling;
      expect(ceilingSelect.value).toBe('editor');
    });

    // The Summary tab also mounts PublicSlugSection, which fires its own fetch
    // on mount — a strict ordered mockResolvedValueOnce chain is fragile
    // against that interleaving, so these two use a URL-dispatching mock.
    function mockVisibilityBackend(initialProject) {
      let current = { ...initialProject };
      global.fetch = vi.fn((url, opts) => {
        const method = opts?.method || 'GET';
        if (url === 'https://api.test/keys' && method === 'GET') {
          return Promise.resolve({ ok: true, json: async () => ({ keys: [current] }) });
        }
        if (url === `https://api.test/keys/${current.key}/visibility` && method === 'PATCH') {
          current = { ...current, ...JSON.parse(opts.body) };
          return Promise.resolve({ ok: true, json: async () => current });
        }
        return Promise.resolve({ ok: false, json: async () => ({ error: 'not found' }) });
      });
      return () => current;
    }

    it('PATCHes {restricted} on toggle change and refreshes the project list', async () => {
      setupAuth();
      const getCurrent = mockVisibilityBackend(TEAM_VISIBLE_PROJECT);

      renderPage(mockSession({ apiKey: TEAM_VISIBLE_PROJECT.key }), { implicitKey: true });

      await waitFor(() => expect(screen.getByText('Team-visible project')).toBeInTheDocument());
      const checkbox = screen.getByRole('checkbox', { name: /visible to my organization/i });
      fireEvent.click(checkbox);

      await waitFor(() => expect(getCurrent().restricted).toBe(true));
      // onProjectRefresh re-fetched /keys, so the now-restricted project hides the ceiling picker
      await waitFor(() => expect(screen.queryByText(/access ceiling for org members/i)).not.toBeInTheDocument());
    });

    it('PATCHes {orgBaselineRole} on ceiling change', async () => {
      setupAuth();
      const getCurrent = mockVisibilityBackend(TEAM_VISIBLE_PROJECT);

      renderPage(mockSession({ apiKey: TEAM_VISIBLE_PROJECT.key }), { implicitKey: true });

      await waitFor(() => expect(screen.getByText('Team-visible project')).toBeInTheDocument());
      const ceilingSelect = screen.getByText(/access ceiling for org members/i).nextElementSibling;
      fireEvent.change(ceilingSelect, { target: { value: 'viewer' } });

      await waitFor(() => expect(getCurrent().orgBaselineRole).toBe('viewer'));
    });

    it('hides the section entirely for a non-owner/admin viewer', async () => {
      setupAuth();
      global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ keys: [MEMBER_PROJECT] }) });

      renderPage(mockSession({ apiKey: MEMBER_PROJECT.key }), { implicitKey: true });

      await waitFor(() => expect(screen.getByText('Member-only project')).toBeInTheDocument());
      expect(screen.queryByText('Team visibility')).not.toBeInTheDocument();
    });
  });

  describe('Danger zone tab visibility', () => {
    // DELETE/PATCH /keys/:key are enforced backend-side as strict
    // api_keys.user_id === userId ownership (not even project 'admin'
    // qualifies) — the tab should only render for a real owner.
    const ADMIN_PROJECT = {
      key: 'key-dz-admin', owner: 'Admin-access project', createdAt: '2026-01-01T00:00:00Z', myAccessLevel: 'admin',
    };

    it('shows the Danger zone tab for an owner', async () => {
      setupAuth();
      global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ keys: MOCK_PROJECTS }) });

      renderPage(mockSession({ apiKey: MOCK_PROJECTS[0].key }), { implicitKey: true });

      await waitFor(() => expect(screen.getByText('Sunday service')).toBeInTheDocument());
      expect(screen.getByRole('button', { name: 'Danger zone' })).toBeInTheDocument();
    });

    it('hides the Danger zone tab for a non-owner (e.g. org-admin-override "admin")', async () => {
      setupAuth();
      global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ keys: [ADMIN_PROJECT] }) });

      renderPage(mockSession({ apiKey: ADMIN_PROJECT.key }), { implicitKey: true });

      await waitFor(() => expect(screen.getByText('Admin-access project')).toBeInTheDocument());
      expect(screen.queryByRole('button', { name: 'Danger zone' })).not.toBeInTheDocument();
    });
  });

  describe('Team tab — role changes', () => {
    it('PATCHes accessLevel when a member row select changes', async () => {
      setupAuth();
      // URL-dispatching mock: Summary tab's PublicSlugSection fires its own
      // fetch on mount, so an ordered mockResolvedValueOnce chain isn't safe.
      global.fetch = vi.fn((url, opts) => {
        const method = opts?.method || 'GET';
        if (url === 'https://api.test/keys' && method === 'GET') {
          return Promise.resolve({ ok: true, json: async () => ({ keys: MOCK_PROJECTS }) });
        }
        if (url === `https://api.test/keys/${MOCK_PROJECTS[0].key}/members` && method === 'GET') {
          return Promise.resolve({
            ok: true,
            json: async () => ({ members: [{ userId: 'u2', email: 'member@example.com', accessLevel: 'editor', permissions: [] }] }),
          });
        }
        if (url === `https://api.test/keys/${MOCK_PROJECTS[0].key}/members/u2` && method === 'PATCH') {
          return Promise.resolve({ ok: true, json: async () => ({ userId: 'u2', accessLevel: 'operator', permissions: [] }) });
        }
        return Promise.resolve({ ok: false, json: async () => ({ error: 'not found' }) });
      });

      renderPage(mockSession({ apiKey: MOCK_PROJECTS[0].key }), { implicitKey: true });

      await waitFor(() => expect(screen.getByText('Sunday service')).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: 'Team' }));

      await waitFor(() => expect(screen.getByText('member@example.com')).toBeInTheDocument());

      const select = screen.getByLabelText(/access level for member@example.com/i);
      fireEvent.change(select, { target: { value: 'operator' } });

      await waitFor(() => expect(select.value).toBe('operator'));

      const patchCall = global.fetch.mock.calls.find(c => c[1]?.method === 'PATCH');
      expect(patchCall).toBeTruthy();
      expect(JSON.parse(patchCall[1].body)).toEqual({ accessLevel: 'operator' });
    });
  });
});
