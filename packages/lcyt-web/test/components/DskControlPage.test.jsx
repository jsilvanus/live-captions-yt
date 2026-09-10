/**
 * Tests for DskControlPage's standalone-mode credential fallback.
 *
 * Standalone mode (/dsk-control/:key) is rendered with no <AppProviders>/
 * SessionContext at all (main.jsx's getStandalonePage()), so — after DSK's
 * X-API-Key retirement — it has no token source of its own. It falls back to
 * reading the same localStorage-persisted project session every other
 * already-logged-in page uses (lib/projectSession.js), but only when that
 * persisted session is for *this* project's :key. See CONSIDER.md.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { DskControlPage } from '../../src/components/DskControlPage.jsx';
import { savePersistedSessionConfig } from '../../src/lib/projectSession.js';

beforeEach(() => {
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) }));
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DskControlPage — standalone mode credential fallback', () => {
  it('prompts to log in elsewhere when no persisted session exists', async () => {
    window.history.pushState({}, '', '/dsk-control/proj-a?server=http://localhost:3000');
    render(<DskControlPage />);

    expect(await screen.findByText(/log in to this project in another tab/i)).toBeInTheDocument();
  });

  it("prompts to log in when the persisted session is for a different project", async () => {
    savePersistedSessionConfig({ backendUrl: 'http://localhost:3000', projectId: 'proj-b', projectAccessToken: 'tok-b' });
    window.history.pushState({}, '', '/dsk-control/proj-a?server=http://localhost:3000');
    render(<DskControlPage />);

    expect(await screen.findByText(/log in to this project in another tab/i)).toBeInTheDocument();
  });

  it('renders the control panel and authenticates with the persisted token when it matches this project', async () => {
    savePersistedSessionConfig({ backendUrl: 'http://localhost:3000', projectId: 'proj-a', projectAccessToken: 'tok-a' });
    window.history.pushState({}, '', '/dsk-control/proj-a');
    render(<DskControlPage />);

    expect(await screen.findByText('DSK Control')).toBeInTheDocument();
    expect(screen.queryByText(/log in to this project in another tab/i)).not.toBeInTheDocument();

    await waitFor(() => {
      const templatesCall = global.fetch.mock.calls.find(([url]) => String(url).includes('/templates'));
      expect(templatesCall).toBeTruthy();
      expect(templatesCall[1]?.headers?.Authorization).toBe('Bearer tok-a');
    });
  });
});
