import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AdminUsersPage } from '../../src/components/AdminUsersPage.jsx';

vi.mock('wouter', () => ({ useLocation: () => ['/admin/users', vi.fn()] }));
vi.mock('../../src/hooks/useUserAuth', () => ({
  useUserAuth: () => ({ user: { isAdmin: true }, backendUrl: 'https://api.test' }),
}));

const USERS = [
  { id: 1, email: 'owner@example.com', name: 'Owner Person', active: true, created_at: '2026-01-01', role: 'owner', orgName: 'Acme Media' },
  { id: 2, email: 'viewer@example.com', name: 'Viewer Person', active: false, created_at: '2026-02-01', role: 'viewer', orgName: 'Acme Media' },
];
const ORGS = [{ id: 1, name: 'Acme Media', memberCount: 2, projectCount: 1 }];

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  global.fetch = vi.fn((url) => {
    const s = String(url);
    if (s.includes('/admin/orgs')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ orgs: ORGS }) });
    if (s.includes('/admin/users')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ users: USERS, total: USERS.length }) });
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
  });
});

describe('AdminUsersPage', () => {
  it('renders user rows with role badge, org name, and status', async () => {
    render(<AdminUsersPage />);
    await waitFor(() => expect(screen.getByText('Owner Person')).toBeInTheDocument());
    expect(screen.getAllByText('Acme Media').length).toBeGreaterThan(0);
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('populates the team filter dropdown from GET /admin/orgs', async () => {
    render(<AdminUsersPage />);
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Acme Media' })).toBeInTheDocument();
    });
  });

  it('filters visible rows by role client-side', async () => {
    render(<AdminUsersPage />);
    await waitFor(() => expect(screen.getByText('Owner Person')).toBeInTheDocument());
    fireEvent.change(screen.getByDisplayValue('All roles'), { target: { value: 'viewer' } });
    expect(screen.queryByText('Owner Person')).not.toBeInTheDocument();
    expect(screen.getByText('Viewer Person')).toBeInTheDocument();
  });
});
