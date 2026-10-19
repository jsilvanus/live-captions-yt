import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { SessionContext } from '../../src/contexts/SessionContext.jsx';
import { LangProvider } from '../../src/contexts/LangContext.jsx';
import { FeedsSection, feedBody } from '../../src/components/setup-hub/FeedsSection.jsx';

const session = { connected: true, apiKey: 'k', backendUrl: 'http://backend.test', getSessionToken: () => 'tok', getPersistedConfig: () => ({}) };

const FEEDS = [
  { id: 'managed:dsk', name: 'DSK', managed: true, kind: 'dsk', label: 'dsk', transport: 'rtmp', feedKey: 'k', ingestUrl: 'rtmp://h/dsk/k', live: null, deviceType: null, deviceId: null },
  { id: 'feed-main', name: 'Main video', managed: false, primary: true, kind: 'generic', label: 'main', transport: 'rtmp', feedKey: 'vid', ingestUrl: 'rtmp://h/stream/vid', live: true, deviceType: null, deviceId: null },
  { id: 'feed-altar', name: 'Altar cam', managed: false, kind: 'camera', label: null, transport: 'rtmp', feedKey: 'altar', ingestUrl: 'rtmp://h/feed/altar', live: true, deviceType: 'camera', deviceId: 'cam-12345678-aaaa' },
  { id: 'feed-prog', name: 'Program', managed: false, kind: 'generic', label: 'program', transport: 'whip', feedKey: 'prog', whipUrl: 'http://w/prog/whip', live: false, deviceType: null, deviceId: null },
];
const CONFIG = { video: { enabled: true, ingestUrl: 'rtmp://h/stream/vid', rotatable: true, live: true }, dsk: { enabled: false, ingestUrl: 'rtmp://h/dsk/k', live: null } };

function reply(body, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

let routes;
let calls;

function renderSection() {
  const { hook } = memoryLocation({ path: '/setup' });
  return render(
    <LangProvider>
      <SessionContext.Provider value={session}>
        <Router hook={hook}><FeedsSection /></Router>
      </SessionContext.Provider>
    </LangProvider>,
  );
}

beforeEach(() => {
  localStorage.setItem('lcyt:lang', 'en');
  calls = [];
  routes = {
    'GET /feeds': () => reply({ feeds: FEEDS }),
    'GET /ingestion/config': () => reply(CONFIG),
    'GET /stream': () => reply({ relays: [{ sourceFeedId: 'feed-prog' }] }),
  };
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const path = String(url).replace('http://backend.test/api/v1', '');
    const method = opts.method || 'GET';
    calls.push({ method, path, body: opts.body ? JSON.parse(opts.body) : undefined });
    const handler = routes[`${method} ${path}`];
    return handler ? handler(opts) : reply({}, 404);
  });
});

afterEach(() => { vi.restoreAllMocks(); });

describe('FeedsSection', () => {
  it('offers to add the main stream only when the project has none, since a project may have no incoming stream', async () => {
    routes['GET /feeds'] = () => reply({ feeds: FEEDS.filter(f => !f.primary) });
    routes['POST /feeds/main'] = () => reply({ ...FEEDS[1] }, 201);
    renderSection();
    fireEvent.click(await screen.findByText('Add main stream'));
    await waitFor(() => expect(calls.some(c => c.method === 'POST' && c.path === '/feeds/main')).toBe(true));
  });

  it('does not offer it when the main feed exists', async () => {
    renderSection();
    await screen.findByText('Altar cam');
    expect(screen.queryByText('Add main stream')).toBeNull();
  });

  it('renders the managed feeds, then the named feeds with kind, transport, live state and link', async () => {
    renderSection();
    expect(await screen.findByText('Altar cam')).toBeInTheDocument();
    expect(screen.getByText('Program')).toBeInTheDocument();
    expect(screen.getByText('Main video')).toBeInTheDocument();
    expect(screen.getByText('Main')).toBeInTheDocument(); // the primary feed's badge
    expect(screen.getAllByText('DSK').length).toBeGreaterThan(0);
    expect(screen.getByText('Disabled')).toBeInTheDocument(); // DSK slot from GET /ingestion/config
    expect(screen.getByText('WHIP · http://w/prog/whip')).toBeInTheDocument();
    expect(screen.getByText('Linked: camera cam-1234')).toBeInTheDocument();
    expect(screen.getByText('program')).toBeInTheDocument(); // the generic label
  });

  it('marks a named feed no relay uses as Monitor, and not one a relay sources from', async () => {
    renderSection();
    await screen.findByText('Altar cam');
    expect(screen.getByText('Monitor')).toBeInTheDocument();
    expect(calls.map(c => c.path)).toEqual(expect.arrayContaining(['/feeds', '/ingestion/config', '/stream']));
  });

  it('makes another rtmp feed the main one with POST /feeds/:id/primary, and offers no delete on the main feed', async () => {
    routes['POST /feeds/feed-altar/primary'] = () => reply({ id: 'feed-altar', primary: true });
    renderSection();
    await screen.findByText('Altar cam');
    expect(screen.getAllByTitle('Delete')).toHaveLength(2); // Altar cam and Program only
    fireEvent.click(screen.getAllByTitle('Settings')[2]);
    fireEvent.click(screen.getByRole('button', { name: 'Make main feed' }));
    await waitFor(() => expect(calls.some(c => c.method === 'POST' && c.path === '/feeds/feed-altar/primary')).toBe(true));
  });

  it('adds a generic feed with its label through POST /feeds', async () => {
    routes['POST /feeds'] = () => reply({ id: 'new' }, 201);
    renderSection();
    await screen.findByText('Altar cam');
    fireEvent.click(screen.getByRole('button', { name: 'Add feed' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Preview' } });
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'preview' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find(c => c.method === 'POST')).toBeTruthy());
    expect(calls.find(c => c.method === 'POST')).toMatchObject({
      path: '/feeds',
      body: { name: 'Preview', transport: 'rtmp', kind: 'generic', label: 'preview' },
    });
  });

  it('sends a typed key, and no label, for a camera feed', async () => {
    routes['POST /feeds'] = () => reply({ id: 'new' }, 201);
    renderSection();
    await screen.findByText('Altar cam');
    fireEvent.click(screen.getByRole('button', { name: 'Add feed' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Pulpit' } });
    fireEvent.change(screen.getByLabelText('Key'), { target: { value: 'pulpit-1' } });
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'camera' } });
    expect(screen.queryByLabelText('Label')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find(c => c.method === 'POST')).toBeTruthy());
    expect(calls.find(c => c.method === 'POST').body).toEqual({ name: 'Pulpit', feedKey: 'pulpit-1', transport: 'rtmp', kind: 'camera', label: null });
  });

  it('explains a 409 key clash in the dialog and keeps it open', async () => {
    routes['POST /feeds'] = () => reply({ error: "feedKey 'altar' is already in use" }, 409);
    renderSection();
    await screen.findByText('Altar cam');
    fireEvent.click(screen.getByRole('button', { name: 'Add feed' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Copy' } });
    fireEvent.change(screen.getByLabelText('Key'), { target: { value: 'altar' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('That key is already in use. Choose another.')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Copy');
  });

  it('shows the server reason for a 400', async () => {
    routes['POST /feeds'] = () => reply({ error: 'feedKey may only contain letters, digits, _ and - (max 64)' }, 400);
    renderSection();
    await screen.findByText('Altar cam');
    fireEvent.click(screen.getByRole('button', { name: 'Add feed' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Bad' } });
    fireEvent.change(screen.getByLabelText('Key'), { target: { value: 'a b' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('feedKey may only contain letters, digits, _ and - (max 64)')).toBeInTheDocument();
  });

  it('edits a named feed with PATCH /feeds/:id, prefilled from the row', async () => {
    routes['PATCH /feeds/feed-prog'] = () => reply({ id: 'feed-prog' });
    renderSection();
    await screen.findByText('Program');
    fireEvent.click(screen.getAllByTitle('Settings')[3]); // rows: DSK, Main video, Altar cam, Program
    expect(screen.getByLabelText('Name')).toHaveValue('Program');
    expect(screen.getByLabelText('Label')).toHaveValue('program');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find(c => c.method === 'PATCH')).toBeTruthy());
    expect(calls.find(c => c.method === 'PATCH')).toMatchObject({
      path: '/feeds/feed-prog',
      body: { name: 'Program', transport: 'whip', kind: 'generic', label: 'program' },
    });
  });

  it('deletes a named feed after confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    routes['DELETE /feeds/feed-altar'] = () => reply({}, 204);
    renderSection();
    await screen.findByText('Altar cam');
    fireEvent.click(screen.getAllByTitle('Delete')[0]);
    expect(confirm).toHaveBeenCalledWith('Delete the feed "Altar cam"?');
    await waitFor(() => expect(calls.some(c => c.method === 'DELETE' && c.path === '/feeds/feed-altar')).toBe(true));
  });

  it('does not call the server when the user cancels the delete', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderSection();
    await screen.findByText('Altar cam');
    fireEvent.click(screen.getAllByTitle('Delete')[0]);
    expect(calls.some(c => c.method === 'DELETE')).toBe(false);
  });

  it('rotates the main feed key from its settings', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    routes['POST /ingestion/config/rotate'] = () => reply({ streamKey: 'new', ingestUrl: 'rtmp://h/stream/new' });
    renderSection();
    await screen.findByText('Altar cam');
    fireEvent.click(screen.getAllByTitle('Settings')[1]); // the main feed
    fireEvent.click(screen.getByRole('button', { name: 'Rotate stream key' }));
    await waitFor(() => expect(calls.some(c => c.method === 'POST' && c.path === '/ingestion/config/rotate')).toBe(true));
  });

  it('names the linked device in the chip when the device list is available', async () => {
    routes['GET /production/cameras'] = () => reply([{ id: 'cam-12345678-aaaa', name: 'Altar camera' }]);
    renderSection();
    expect(await screen.findByText('Linked: Altar camera')).toBeInTheDocument();
    expect(screen.queryByText('Linked: camera cam-1234')).toBeNull();
    expect(calls.map(c => c.path)).toEqual(expect.arrayContaining(['/production/cameras', '/production/mixers', '/production/encoders']));
  });

  it('shows the placeholder when not connected and makes no requests', () => {
    const { hook } = memoryLocation({ path: '/setup' });
    render(
      <LangProvider>
        <SessionContext.Provider value={{ ...session, connected: false }}>
          <Router hook={hook}><FeedsSection /></Router>
        </SessionContext.Provider>
      </LangProvider>,
    );
    expect(screen.getByText('Connect to a project to set up feeds.')).toBeInTheDocument();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('feedBody', () => {
  const base = { name: '  Mixer out ', feedKey: '', transport: 'rtmp', kind: 'generic', label: ' program ' };

  it('trims the name and label, and leaves the key out when empty', () => {
    expect(feedBody(base)).toEqual({ name: 'Mixer out', transport: 'rtmp', kind: 'generic', label: 'program' });
  });

  it('sends a null label for kinds other than generic', () => {
    expect(feedBody({ ...base, kind: 'dsk' })).toEqual({ name: 'Mixer out', transport: 'rtmp', kind: 'dsk', label: null });
  });
});
