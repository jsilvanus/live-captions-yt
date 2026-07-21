import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminServerSettingsPage } from '../../src/components/AdminServerSettingsPage.jsx';

const BACKEND_URL = 'https://api.test';

const SNAPSHOT = {
  categories: {
    contact: [
      { key: 'contact.email', env: 'CONTACT_EMAIL', category: 'contact', tier: 'ui', apply: 'hot', type: 'string', secret: false, confirm: false, description: 'Contact e-mail returned by GET /contact.', source: 'default', pendingRestart: false, value: '' },
    ],
    application: [
      { key: 'app.use_user_logins', env: 'USE_USER_LOGINS', category: 'application', tier: 'ui', apply: 'restart', type: 'bool', secret: false, confirm: true, description: 'User registration/login. Turning this off can lock every non-admin out.', source: 'default', pendingRestart: false, value: true },
    ],
    stt: [
      { key: 'stt.google_stt_key', env: 'GOOGLE_STT_KEY', category: 'stt', tier: 'ui', apply: 'hot', type: 'secret', secret: true, confirm: false, description: 'Google STT key.', source: 'default', pendingRestart: false, value: null },
    ],
    bootstrap: [
      { key: 'bootstrap.jwt_secret', env: 'JWT_SECRET', category: 'bootstrap', tier: 'env', apply: 'restart', type: 'secret', secret: true, confirm: false, description: 'HS256 signing key.', source: 'default', pendingRestart: false, value: null },
    ],
  },
};

function mockFetchImpl({ onPut } = {}) {
  return vi.fn((url, opts) => {
    const method = opts?.method || 'GET';
    if (url.endsWith('/auth/me')) {
      return Promise.resolve({ ok: true, json: async () => ({ userId: 1, email: 'admin@example.com', name: 'Admin', isAdmin: true }) });
    }
    if (url.endsWith('/admin/server-settings') && method === 'GET') {
      return Promise.resolve({ ok: true, json: async () => SNAPSHOT });
    }
    if (url.endsWith('/admin/server-settings') && method === 'PUT') {
      const body = JSON.parse(opts.body);
      onPut?.(body);
      const [key, value] = Object.entries(body.values)[0];
      const flatEntries = Object.values(SNAPSHOT.categories).flat().map(e => (e.key === key ? { ...e, value, source: 'db' } : e));
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, updated: [key], snapshot: flatEntries }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('lcyt-user', JSON.stringify({ token: 'tok', backendUrl: BACKEND_URL }));
});

describe('AdminServerSettingsPage', () => {
  it('loads and renders settings grouped by category', async () => {
    global.fetch = mockFetchImpl();
    render(<AdminServerSettingsPage />);

    await waitFor(() => expect(screen.getByText(/email/i)).toBeInTheDocument());
    expect(screen.getByText(/use_user_logins/i)).toBeInTheDocument();
    expect(screen.getByText(/google_stt_key/i)).toBeInTheDocument();
  });

  it('shows Tier A settings read-only under Bootstrap', async () => {
    global.fetch = mockFetchImpl();
    render(<AdminServerSettingsPage />);

    await waitFor(() => expect(screen.getByText('Bootstrap (env-only)')).toBeInTheDocument());
    expect(screen.getAllByText('not set').length).toBeGreaterThan(0);
  });

  it('saves a text field on blur', async () => {
    const onPut = vi.fn();
    global.fetch = mockFetchImpl({ onPut });
    render(<AdminServerSettingsPage />);

    await waitFor(() => expect(screen.getByText(/email/i)).toBeInTheDocument());
    const input = screen.getAllByRole('textbox')[0];
    await userEvent.clear(input);
    await userEvent.type(input, 'ops@example.com');
    await userEvent.tab();

    await waitFor(() => expect(onPut).toHaveBeenCalledWith({ values: { 'contact.email': 'ops@example.com' } }));
  });

  it('shows a confirmation dialog before disabling a confirm-gated toggle', async () => {
    const onPut = vi.fn();
    global.fetch = mockFetchImpl({ onPut });
    render(<AdminServerSettingsPage />);

    await waitFor(() => expect(screen.getByText(/use_user_logins/i)).toBeInTheDocument());
    const checkbox = screen.getByRole('checkbox');
    await userEvent.click(checkbox);

    expect(screen.getByText(/Disable user logins\?/i)).toBeInTheDocument();
    expect(onPut).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /disable/i }));
    await waitFor(() => expect(onPut).toHaveBeenCalledWith({ values: { 'app.use_user_logins': false } }));
  });

  it('replaces a secret via the write-only Replace flow', async () => {
    const onPut = vi.fn();
    global.fetch = mockFetchImpl({ onPut });
    render(<AdminServerSettingsPage />);

    await waitFor(() => expect(screen.getByText(/google_stt_key/i)).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /replace/i }));
    const passwordInput = screen.getByPlaceholderText('new value');
    await userEvent.type(passwordInput, 'new-secret-key');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(onPut).toHaveBeenCalledWith({ values: { 'stt.google_stt_key': 'new-secret-key' } }));
  });
});
