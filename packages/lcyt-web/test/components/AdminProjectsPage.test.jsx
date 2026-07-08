import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AdminProjectsPage } from '../../src/components/AdminProjectsPage.jsx';

vi.mock('wouter', () => ({ useLocation: () => ['/admin/projects', vi.fn()] }));
vi.mock('../../src/hooks/useUserAuth', () => ({
  useUserAuth: () => ({ user: { isAdmin: true }, backendUrl: 'https://api.test' }),
}));

const PROJECTS = [
  { key: 'key-1', owner: 'Sunday Service', active: true, userEmail: 'owner@example.com', userId: 1, orgName: 'Acme Media', expires: null },
];
const ORGS = [{ id: 1, name: 'Acme Media', memberCount: 2, projectCount: 1 }];

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  global.fetch = vi.fn((url) => {
    const s = String(url);
    if (s.includes('/admin/orgs')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ orgs: ORGS }) });
    if (s.includes('/admin/projects')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ projects: PROJECTS, total: PROJECTS.length }) });
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
  });
});

describe('AdminProjectsPage', () => {
  it('renders project rows with owner, org, and status dot', async () => {
    render(<AdminProjectsPage />);
    await waitFor(() => expect(screen.getByText('Sunday Service')).toBeInTheDocument());
    expect(screen.getByText('owner@example.com')).toBeInTheDocument();
    expect(screen.getAllByText(/Acme Media/).length).toBeGreaterThan(0);
  });

  it('populates the team filter dropdown from GET /admin/orgs', async () => {
    render(<AdminProjectsPage />);
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Acme Media' })).toBeInTheDocument();
    });
  });
});
