import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TeamPage } from '../../src/components/TeamPage.jsx';

// ---------------------------------------------------------------------------
// Mock useUserAuth (same pattern as AccountPage.test.jsx)
// ---------------------------------------------------------------------------

let mockAuth;

vi.mock('../../src/hooks/useUserAuth.js', () => ({
  useUserAuth: () => mockAuth,
}));

function setupLoggedIn(overrides = {}) {
  mockAuth = {
    user: { userId: 1, email: 'test@example.com', name: 'Test User' },
    token: 'user-jwt',
    backendUrl: 'https://api.test',
    loading: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// fetch mock — routes by URL suffix
// ---------------------------------------------------------------------------

const ORG = { id: 1, name: 'Acme Media', slug: 'acme-media', role: 'owner', memberCount: 2, projectCount: 1 };
const MEMBERS = [
  { userId: 1, email: 'owner@example.com', name: 'Owner Person', role: 'owner', joinedAt: '2026-01-01T00:00:00.000Z', projectCount: 1 },
  { userId: 2, email: 'viewer@example.com', name: 'Viewer Person', role: 'viewer', joinedAt: '2026-02-01T00:00:00.000Z', projectCount: 0 },
];
const PROJECTS = [{ key: 'key-1', owner: 'Sunday Service', createdAt: '2026-01-01T00:00:00.000Z', active: true, orgId: 1 }];

function jsonResponse(body, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) });
}

function setupFetch({ orgs = [ORG], members = MEMBERS, projects = PROJECTS } = {}) {
  global.fetch = vi.fn((url, opts) => {
    const method = opts?.method || 'GET';
    if (url.endsWith('/orgs') && method === 'GET') return jsonResponse({ organizations: orgs });
    if (url.endsWith('/orgs') && method === 'POST') return jsonResponse({ organization: { ...ORG, id: 2, name: 'New Team' } }, true);
    if (/\/orgs\/\d+$/.test(url)) return jsonResponse({ organization: orgs[0], role: orgs[0]?.role });
    if (/\/orgs\/\d+\/members$/.test(url) && method === 'GET') return jsonResponse({ members });
    if (/\/orgs\/\d+\/members$/.test(url) && method === 'POST') return jsonResponse({ member: { userId: 3, email: 'new@example.com', role: 'viewer' } });
    if (/\/orgs\/\d+\/members\/\d+$/.test(url)) return jsonResponse({ removed: true, member: {} });
    if (/\/orgs\/\d+\/projects$/.test(url)) return jsonResponse({ projects });
    if (/\/orgs\/\d+\/features$/.test(url)) return jsonResponse({ features: [] });
    return jsonResponse({}, false);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('TeamPage — no teams', () => {
  it('shows an empty-state message when the user has no teams', async () => {
    setupLoggedIn();
    setupFetch({ orgs: [] });
    render(<TeamPage />);
    await waitFor(() => {
      expect(screen.getByText(/not on a team yet/i)).toBeInTheDocument();
    });
  });
});

describe('TeamPage — with a team', () => {
  it('shows the org name in the picker', async () => {
    setupLoggedIn();
    setupFetch();
    render(<TeamPage />);
    await waitFor(() => {
      expect(screen.getByText('Acme Media')).toBeInTheDocument();
    });
  });

  it('shows Members / Projects / General Setup tabs for an owner', async () => {
    setupLoggedIn();
    setupFetch();
    render(<TeamPage />);
    await waitFor(() => expect(screen.getByText('General Setup')).toBeInTheDocument());
    expect(screen.getByText('Members')).toBeInTheDocument();
    expect(screen.getByText('Projects')).toBeInTheDocument();
  });

  it('hides General Setup tab for a non-admin role', async () => {
    setupLoggedIn();
    setupFetch({ orgs: [{ ...ORG, role: 'viewer' }] });
    render(<TeamPage />);
    await waitFor(() => expect(screen.getByText('Owner Person')).toBeInTheDocument());
    expect(screen.queryByText('General Setup')).not.toBeInTheDocument();
  });

  it('renders member cards with name, email, and role badge', async () => {
    setupLoggedIn();
    setupFetch();
    render(<TeamPage />);
    await waitFor(() => {
      expect(screen.getByText('Owner Person')).toBeInTheDocument();
    });
    expect(screen.getByText('viewer@example.com')).toBeInTheDocument();
    // "Owner"/"Viewer" also appear as role-filter chip labels, so there are 2+ matches each.
    expect(screen.getAllByText('Owner').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Viewer').length).toBeGreaterThanOrEqual(2);
  });

  it('filters members by search text', async () => {
    setupLoggedIn();
    setupFetch();
    render(<TeamPage />);
    await waitFor(() => expect(screen.getByText('Owner Person')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/search members/i), { target: { value: 'viewer' } });
    expect(screen.queryByText('Owner Person')).not.toBeInTheDocument();
    expect(screen.getByText('Viewer Person')).toBeInTheDocument();
  });

  it('switches to the Projects tab and renders assigned projects', async () => {
    setupLoggedIn();
    setupFetch();
    render(<TeamPage />);
    await waitFor(() => expect(screen.getByText('Projects')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Projects'));
    await waitFor(() => {
      expect(screen.getByText('Sunday Service')).toBeInTheDocument();
    });
  });

  it('opens the Invite Member dialog and submits an invite', async () => {
    setupLoggedIn();
    setupFetch();
    render(<TeamPage />);
    await waitFor(() => expect(screen.getByText('Invite member')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Invite member'));
    fireEvent.change(screen.getByPlaceholderText(/colleague@example.com/i), { target: { value: 'new@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send invite/i }));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/orgs\/1\/members$/),
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  it('opens the Create Team dialog with no manual slug field', async () => {
    setupLoggedIn();
    setupFetch();
    render(<TeamPage />);
    await waitFor(() => expect(screen.getByText('+ New team')).toBeInTheDocument());
    fireEvent.click(screen.getByText('+ New team'));
    expect(screen.getByPlaceholderText(/acme media/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/slug/i)).not.toBeInTheDocument();
  });

  it('opens the Member Management dialog when a member card is clicked', async () => {
    setupLoggedIn();
    setupFetch();
    render(<TeamPage />);
    await waitFor(() => expect(screen.getByText('Owner Person')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Viewer Person'));
    expect(screen.getByRole('button', { name: /remove from team/i })).toBeInTheDocument();
  });
});
