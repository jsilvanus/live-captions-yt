import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { IngestStreamsChip } from '../../src/components/IngestStreamsChip.jsx';
import { SessionContext } from '../../src/contexts/SessionContext.jsx';
import { LangProvider } from '../../src/contexts/LangContext.jsx';

const session = { connected: true, backendUrl: 'http://api.test', getSessionToken: () => 'tok' };

function renderChip() {
  return render(
    <LangProvider><SessionContext.Provider value={session}><IngestStreamsChip /></SessionContext.Provider></LangProvider>,
  );
}

function json(body, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: async () => body });
}

describe('IngestStreamsChip', () => {
  let routes;
  beforeEach(() => {
    localStorage.setItem('lcyt:lang', 'en');
    routes = {};
    global.fetch = vi.fn((url, init) => {
      const path = url.replace('http://api.test/api/v1', '');
      const handler = routes[`${init?.method ?? 'GET'} ${path}`];
      return handler ? handler(init) : json({}, 404);
    });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('stays hidden when the server reports no ingest', async () => {
    routes['GET /ingestion/streams'] = () => json({ available: false, streams: [] });
    const { container } = renderChip();
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container.querySelector('button')).toBeNull();
  });

  it('stays hidden when the route is not mounted (relay off)', async () => {
    const { container } = renderChip();
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container.querySelector('button')).toBeNull();
  });

  it('shows the count and lists streams with video/audio state on hover', async () => {
    routes['GET /ingestion/streams'] = () => json({ available: true, streams: [
      { path: 'KEY1', kind: 'video', label: null, video: true, audio: true },
      { path: 'altar-cam', kind: 'feed', label: 'Altar', video: true, audio: false },
    ] });
    renderChip();
    const chip = await screen.findByRole('button', { name: '2 incoming streams' });
    expect(chip.textContent).toContain('2');
    fireEvent.mouseEnter(chip.parentElement);
    expect(screen.getByText('KEY1')).toBeTruthy();
    expect(screen.getByText('Altar (altar-cam)')).toBeTruthy();
    expect(screen.getByText('no audio')).toBeTruthy();
  });

  it('discovers an unclaimed stream and adds it as a feed', async () => {
    routes['GET /ingestion/streams'] = () => json({ available: true, streams: [] });
    routes['GET /ingestion/streams/unclaimed'] = () => json({ available: true, streams: [
      { path: 'webcam', key: 'webcam', kind: 'video', video: true, audio: false, attachable: true },
    ] });
    const created = vi.fn(() => json({ ok: true }, 201));
    routes['POST /production/cameras'] = created;
    renderChip();
    const chip = await screen.findByRole('button', { name: '0 incoming streams' });
    fireEvent.click(chip);
    fireEvent.click(screen.getByText('Discover streams'));
    fireEvent.click(await screen.findByText('Add as feed'));
    await waitFor(() => expect(created).toHaveBeenCalled());
    expect(JSON.parse(created.mock.calls[0][0].body)).toEqual({ name: 'webcam', controlType: 'rtmp', cameraKey: 'webcam' });
    await waitFor(() => expect(screen.queryByText('Add as feed')).toBeNull());
  });

  it('explains a 403 on discover', async () => {
    routes['GET /ingestion/streams'] = () => json({ available: true, streams: [] });
    routes['GET /ingestion/streams/unclaimed'] = () => json({ error: 'no' }, 403);
    renderChip();
    fireEvent.click(await screen.findByRole('button', { name: '0 incoming streams' }));
    fireEvent.click(screen.getByText('Discover streams'));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
