import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AdminTeamsPage } from '../../src/components/AdminTeamsPage.jsx';

vi.mock('wouter', () => ({ useLocation: () => ['/admin/teams', vi.fn()] }));
vi.mock('../../src/hooks/useUserAuth', () => ({
  useUserAuth: () => ({ user: { isAdmin: true }, backendUrl: 'https://api.test' }),
}));

const ORGS = [
  { id: 1, name: 'Acme Media', slug: 'acme-media', memberCount: 3, projectCount: 2 },
  { id: 2, name: 'Beta Team', slug: 'beta-team', memberCount: 1, projectCount: 0 },
];
const OVERRIDES = [{ code: 'stt-server', mode: 'available', binaryOnly: true }];

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  global.fetch = vi.fn((url, opts) => {
    const s = String(url);
    if (s.includes('/feature-overrides/') && opts?.method === 'PUT') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }
    if (s.includes('/feature-overrides')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ overrides: OVERRIDES }) });
    }
    if (s.includes('/admin/orgs')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ orgs: ORGS }) });
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
  });
});

describe('AdminTeamsPage', () => {
  it('lists all teams on the deployment', async () => {
    render(<AdminTeamsPage />);
    await waitFor(() => expect(screen.getByText('Acme Media')).toBeInTheDocument());
    expect(screen.getByText('Beta Team')).toBeInTheDocument();
  });

  it('shows the placeholder instructional text before a team is selected', async () => {
    render(<AdminTeamsPage />);
    await waitFor(() => expect(screen.getByText('Acme Media')).toBeInTheDocument());
    expect(screen.getByText(/select a team to configure/i)).toBeInTheDocument();
  });

  it('shows the feature-override grid after selecting a team', async () => {
    render(<AdminTeamsPage />);
    await waitFor(() => expect(screen.getByText('Acme Media')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Acme Media'));
    await waitFor(() => {
      expect(screen.getByText('Server-side STT')).toBeInTheDocument();
    });
  });

  it('shows a soft failure message when /admin/orgs is not implemented yet', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) }));
    render(<AdminTeamsPage />);
    await waitFor(() => {
      expect(screen.getByText(/not available on this backend yet/i)).toBeInTheDocument();
    });
  });
});
