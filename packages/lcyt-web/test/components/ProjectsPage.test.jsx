import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProjectsPage } from '../../src/components/ProjectsPage.jsx';

// ---------------------------------------------------------------------------
// Mock useUserAuth
// ---------------------------------------------------------------------------

let mockAuth;

vi.mock('../../src/hooks/useUserAuth', () => ({
  useUserAuth: () => mockAuth,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_PROJECTS = [
  { key: 'key-abc-1234567890ab', owner: 'Sunday service', createdAt: '2026-01-15T00:00:00Z' },
  { key: 'key-xyz-9876543210cd', owner: 'Wednesday night', createdAt: '2026-02-20T00:00:00Z', expires: '2027-02-20T00:00:00Z' },
];

function setupAuth(overrides = {}) {
  mockAuth = {
    user: { userId: 'u1', email: 'test@example.com', name: 'Test' },
    token: 'user-jwt-token',
    backendUrl: 'https://api.test',
    loading: false,
    logout: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  global.fetch = vi.fn();
  // Suppress confirm dialogs in tests
  global.confirm = vi.fn(() => true);
  global.alert = vi.fn();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProjectsPage', () => {
  it('shows loading state when auth is loading', () => {
    setupAuth({ loading: true, user: null });
    render(<ProjectsPage />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('returns null (redirect) when not authenticated', () => {
    setupAuth({ user: null });
    render(<ProjectsPage />);
    // No heading rendered since user is null → redirecting
    expect(screen.queryByText('Projects')).not.toBeInTheDocument();
  });

  it('renders projects heading and user email when authenticated', async () => {
    setupAuth();
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ keys: MOCK_PROJECTS }),
    });

    render(<ProjectsPage />);

    await waitFor(() => {
      expect(screen.getByText('Projects')).toBeInTheDocument();
    });
    expect(screen.getByText('test@example.com')).toBeInTheDocument();
  });

  it('fetches and displays projects on mount', async () => {
    setupAuth();
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ keys: MOCK_PROJECTS }),
    });

    render(<ProjectsPage />);

    await waitFor(() => {
      expect(screen.getAllByText('Sunday service').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('Wednesday night')).toBeInTheDocument();
  });

  it('shows empty state when no projects exist', async () => {
    setupAuth();
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ keys: [] }),
    });

    render(<ProjectsPage />);

    await waitFor(() => {
      expect(screen.getByText(/no projects yet/i)).toBeInTheDocument();
    });
  });

  it('shows error when fetch fails', async () => {
    setupAuth();
    global.fetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Unauthorized' }),
    });

    render(<ProjectsPage />);

    await waitFor(() => {
      expect(screen.getByText('Unauthorized')).toBeInTheDocument();
    });
  });

  it('opens create project form on button click', async () => {
    setupAuth();
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ keys: [] }),
    });

    render(<ProjectsPage />);

    await waitFor(() => {
      expect(screen.getByText(/new project/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/new project/i));
    expect(screen.getByLabelText(/project name/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create project/i })).toBeInTheDocument();
  });

  it('calls logout on sign out click', async () => {
    setupAuth();
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ keys: [] }),
    });

    render(<ProjectsPage />);

    await waitFor(() => {
      expect(screen.getByText(/sign out/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/sign out/i));
    expect(mockAuth.logout).toHaveBeenCalled();
  });

  it('navigates to /projects/:key when a project row is clicked', async () => {
    setupAuth();
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ keys: MOCK_PROJECTS }) });

    render(<ProjectsPage />);

    await waitFor(() => {
      expect(screen.getAllByText('Sunday service').length).toBeGreaterThan(0);
    });

    const rows = screen.getAllByRole('button', { name: /sunday service/i });
    expect(rows.length).toBeGreaterThan(0);
    fireEvent.click(rows[0]);

    await waitFor(() => {
      expect(window.location.pathname).toBe(`/projects/${MOCK_PROJECTS[0].key}`);
    });
  });

  it('navigates to / (via handleUseProject) when Enter is clicked', async () => {
    setupAuth();
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ keys: MOCK_PROJECTS }) });

    render(<ProjectsPage />);

    await waitFor(() => {
      expect(screen.getAllByText('Sunday service').length).toBeGreaterThan(0);
    });

    const enterButtons = screen.getAllByText(/^Enter$/);
    expect(enterButtons.length).toBeGreaterThan(0);
    fireEvent.click(enterButtons[0]);

    expect(JSON.parse(localStorage.getItem('lcyt.session.config'))).toMatchObject({
      backendUrl: 'https://api.test',
      apiKey: MOCK_PROJECTS[0].key,
    });
  });
});
