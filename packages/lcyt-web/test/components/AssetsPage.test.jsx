import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SessionContext } from '../../src/contexts/SessionContext.jsx';
import { AssetsPage } from '../../src/components/AssetsPage.jsx';

function renderWith(session) {
  return render(
    <SessionContext.Provider value={session}>
      <AssetsPage />
    </SessionContext.Provider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn();
});

describe('AssetsPage', () => {
  it('shows "Not tracked yet" for categories with no counting backend when disconnected', () => {
    renderWith({ connected: false, backendUrl: '', apiKey: '', getSessionToken: () => null });
    expect(screen.getAllByText('Not tracked yet').length).toBeGreaterThanOrEqual(4);
  });

  it('renders a tile for every asset category', () => {
    renderWith({ connected: false, backendUrl: '', apiKey: '', getSessionToken: () => null });
    for (const title of ['Captions', 'Rundowns', 'Graphics', 'Translations', 'Broadcasts', 'Thumbnails']) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });

  it('shows a real Graphics count from GET /dsk/:key/templates when connected', async () => {
    global.fetch.mockImplementation((url) => {
      if (url.includes('/dsk/')) {
        return Promise.resolve({ ok: true, json: async () => ([{ id: 1 }, { id: 2 }, { id: 3 }]) });
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });

    renderWith({ connected: true, backendUrl: 'https://api.test', apiKey: 'key-1', getSessionToken: () => 'tok' });

    await waitFor(() => {
      expect(screen.getByText('3 items')).toBeInTheDocument();
    });
  });
});
