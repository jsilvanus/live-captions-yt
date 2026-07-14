import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  it('renders the filter pills and placeholder cards in the default view', () => {
    renderWith({ connected: false, backendUrl: '', apiKey: '', getSessionToken: () => null });
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reusable' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Produced' })).toBeInTheDocument();
    expect(screen.getByText('Stored videos')).toBeInTheDocument();
    expect(screen.getByText('Thumbnails')).toBeInTheDocument();
  });

  it('loads the reusable and produced asset cards when connected', async () => {
    global.fetch.mockImplementation((url) => {
      if (url.includes('/dsk/')) {
        return Promise.resolve({ ok: true, json: async () => ({ templates: [{ id: 'g-1', name: 'Lower thirds', updated_at: '2024-06-01T00:00:00.000Z' }] }) });
      }
      if (url.includes('/cues/rules')) {
        return Promise.resolve({ ok: true, json: async () => ({ rules: [{ id: 'c-1', name: 'Cue one', match_type: 'phrase', enabled: true }] }) });
      }
      if (url.includes('/actions')) {
        return Promise.resolve({ ok: true, json: async () => ({ actions: [{ slug: 'lower-thirds', name: 'Lower thirds', definition: 'foo' }] }) });
      }
      if (url.includes('/icons')) {
        return Promise.resolve({ ok: true, json: async () => ({ icons: [{ id: 1, filename: 'logo.png', mimeType: 'image/png', sizeBytes: 1234 }] }) });
      }
      if (url.includes('/file')) {
        return Promise.resolve({ ok: true, json: async () => ({ files: [{ id: 'f-1', filename: 'caption.vtt', type: 'caption', lang: 'en', sizeBytes: 111 }] }) });
      }
      if (url.includes('/broadcasts')) {
        return Promise.resolve({ ok: true, json: async () => ({ broadcasts: [{ id: 'b-1', title: 'Show', createdAt: '2024-06-01T00:00:00.000Z', status: 'completed' }] }) });
      }
      return Promise.resolve({ ok: false, json: async () => ({ error: 'Unexpected' }) });
    });

    renderWith({ connected: true, backendUrl: 'https://api.test', apiKey: 'key-1', getSessionToken: () => 'tok' });

    await waitFor(() => {
      expect(screen.getAllByText('Lower thirds').length).toBeGreaterThan(0);
    });

    expect(screen.getByText('Global cues')).toBeInTheDocument();
    expect(screen.getByText('Caption / rundown files')).toBeInTheDocument();
    expect(screen.getByText('Cue one')).toBeInTheDocument();
    expect(screen.getByText('logo.png')).toBeInTheDocument();
    expect(screen.getByText('caption.vtt')).toBeInTheDocument();
    expect(screen.getByText('Show')).toBeInTheDocument();
  });

  it('switches the visible card groups when the filter pills change', async () => {
    const user = userEvent.setup();
    renderWith({ connected: false, backendUrl: '', apiKey: '', getSessionToken: () => null });

    await user.click(screen.getByRole('button', { name: 'Reusable' }));

    expect(screen.getByText('Graphics')).toBeInTheDocument();
    expect(screen.queryByText('Caption / rundown files')).not.toBeInTheDocument();
    expect(screen.queryByText('Stored videos')).not.toBeInTheDocument();
  });
});
