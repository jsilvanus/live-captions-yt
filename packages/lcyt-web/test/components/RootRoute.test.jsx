import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SessionContext } from '../../src/contexts/SessionContext.jsx';

vi.mock('wouter', () => ({
  Redirect: ({ to }) => <div data-testid="redirect" data-to={to} />,
}));

vi.mock('../../src/components/ProjectSettingsPage.jsx', () => ({
  ProjectSettingsPage: (props) => <div data-testid="project-settings" data-implicit={String(!!props.implicitKey)} />,
}));

vi.mock('../../src/components/broadcast/LiveTab.jsx', () => ({
  LiveTab: () => <div data-testid="live-tab" />,
}));

import { RootRoute } from '../../src/components/RootRoute.jsx';

function renderWith(session) {
  return render(
    <SessionContext.Provider value={{ getPersistedConfig: () => ({}), ...session }}>
      <RootRoute />
    </SessionContext.Provider>
  );
}

beforeEach(() => vi.clearAllMocks());

describe('RootRoute', () => {
  it('renders ProjectSettingsPage with an implicit key when a project is connected', async () => {
    renderWith({ connected: true, apiKey: 'key-123', backendFeatures: ['login', 'captions'] });
    await waitFor(() => {
      expect(screen.getByTestId('project-settings')).toBeInTheDocument();
    });
    expect(screen.getByTestId('project-settings').dataset.implicit).toBe('true');
  });

  it('redirects to /projects when not connected and the login feature is present', async () => {
    renderWith({ connected: false, apiKey: '', backendFeatures: ['login', 'captions'] });
    await waitFor(() => {
      expect(screen.getByTestId('redirect')).toBeInTheDocument();
    });
    expect(screen.getByTestId('redirect').dataset.to).toBe('/projects');
  });

  it('renders LiveTab when not connected and the login feature is absent (minimal mode)', async () => {
    renderWith({ connected: false, apiKey: '', backendFeatures: ['captions'] });
    await waitFor(() => {
      expect(screen.getByTestId('live-tab')).toBeInTheDocument();
    });
  });

  it('renders LiveTab when not connected and backend features are not yet resolved', async () => {
    renderWith({ connected: false, apiKey: '', backendFeatures: null });
    await waitFor(() => {
      expect(screen.getByTestId('live-tab')).toBeInTheDocument();
    });
  });
});
