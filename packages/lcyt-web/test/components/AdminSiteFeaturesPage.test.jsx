import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AdminSiteFeaturesPage } from '../../src/components/AdminSiteFeaturesPage.jsx';

vi.mock('wouter', () => ({ useLocation: () => ['/admin/site-features', vi.fn()] }));
vi.mock('../../src/hooks/useUserAuth', () => ({
  useUserAuth: () => ({ user: { isAdmin: true }, backendUrl: 'https://api.test' }),
}));

const POLICIES = [
  { code: 'captions', mode: 'available', binaryOnly: false },
  { code: 'ingest', mode: 'denied', binaryOnly: true },
];

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  global.fetch = vi.fn((url, opts) => {
    if (String(url).includes('/admin/feature-policies/') && opts?.method === 'PUT') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }
    if (String(url).endsWith('/admin/feature-policies')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ policies: POLICIES }) });
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
  });
});

describe('AdminSiteFeaturesPage', () => {
  it('loads and renders the feature policy grid', async () => {
    render(<AdminSiteFeaturesPage />);
    await waitFor(() => {
      expect(screen.getByText('Captions')).toBeInTheDocument();
    });
    expect(screen.getByText('RTMP ingest/relay')).toBeInTheDocument();
  });

  it('renders a 2-way switch for binary-only codes and a 3-way control for the rest', async () => {
    render(<AdminSiteFeaturesPage />);
    await waitFor(() => expect(screen.getByText('Captions')).toBeInTheDocument());
    // Tri-state control shows On/Self-serve/Off buttons somewhere on the page.
    expect(screen.getAllByText('Self-serve').length).toBeGreaterThan(0);
    // Binary switch uses role="switch", not text buttons.
    expect(screen.getAllByRole('switch').length).toBeGreaterThan(0);
  });

  it('shows a soft failure message when the backend has no policy routes', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) }));
    render(<AdminSiteFeaturesPage />);
    await waitFor(() => {
      expect(screen.getByText(/not available on this backend yet/i)).toBeInTheDocument();
    });
  });
});
