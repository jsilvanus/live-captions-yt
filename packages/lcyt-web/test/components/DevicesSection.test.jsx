import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { SessionContext } from '../../src/contexts/SessionContext.jsx';
import { LangProvider } from '../../src/contexts/LangContext.jsx';
import { DevicesSection } from '../../src/components/setup-hub/DevicesSection.jsx';
import { notifyFeedsChanged, FEEDS_CHANGED_EVENT } from '../../src/lib/deviceFeeds.js';

const session = { connected: true, apiKey: 'k', backendUrl: 'http://backend.test', getSessionToken: () => 'tok', getPersistedConfig: () => ({}) };

const FEEDS = [
  { id: 'managed:video', name: 'Main video', managed: true, kind: 'generic', label: 'main', transport: 'rtmp', feedKey: 'vid', ingestUrl: 'rtmp://h/stream/vid', live: true, deviceType: null, deviceId: null },
  { id: 'feed-altar', name: 'Altar cam', managed: false, kind: 'camera', label: null, transport: 'rtmp', feedKey: 'altar', ingestUrl: 'rtmp://h/feed/altar', live: true, deviceType: 'camera', deviceId: 'cam-1' },
  { id: 'feed-prog', name: 'Program', managed: false, kind: 'generic', label: 'program', transport: 'whip', feedKey: 'prog', whipUrl: 'http://w/prog/whip', live: false, deviceType: null, deviceId: null },
  { id: 'feed-loose', name: 'Loose feed', managed: false, kind: 'dsk', label: null, transport: 'rtmp', feedKey: 'loose', ingestUrl: 'rtmp://h/feed/loose', live: null, deviceType: null, deviceId: null },
];

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
        <Router hook={hook}><DevicesSection /></Router>
      </SessionContext.Provider>
    </LangProvider>,
  );
}

beforeEach(() => {
  localStorage.setItem('lcyt:lang', 'en');
  calls = [];
  routes = {
    'GET /feeds': () => reply({ feeds: FEEDS }),
    'GET /production/cameras': () => reply([{ id: 'cam-1', name: 'Altar', controlType: 'none', controlConfig: {} }]),
    'GET /production/mixers': () => reply([{ id: 'mix-1', name: 'Main mixer', type: 'atem', connectionConfig: { host: '10.0.0.5' } }]),
    'GET /production/encoders': () => reply([]),
    'GET /production/bridge/instances': () => reply([]),
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

describe('DevicesSection', () => {
  it('renders one card with three device sections: Cameras, Mixers and Encoders', async () => {
    renderSection();
    expect(screen.getByText('Devices', { selector: '.setup-card__title' })).toBeInTheDocument();
    for (const [id, title] of [['cameras', 'Cameras'], ['mixers', 'Mixers'], ['encoders', 'Encoders']]) {
      const section = screen.getByTestId(`devices-${id}`);
      expect(within(section).getByRole('heading', { name: title })).toBeInTheDocument();
    }
    expect(await screen.findByText('Altar')).toBeInTheDocument();
    expect(await screen.findByText('Main mixer')).toBeInTheDocument();
  });

  it('shows the linked feed on its device row with a live dot', async () => {
    renderSection();
    const cameras = await waitFor(() => screen.getByTestId('devices-cameras'));
    const linked = await within(cameras).findByTestId('linked-feed');
    expect(linked).toHaveTextContent('Altar cam');
    expect(within(linked).getByLabelText('Live')).toBeInTheDocument();
    // the mixer row has no feed linked
    expect(within(screen.getByTestId('devices-mixers')).getByText('No feed linked')).toBeInTheDocument();
  });

  it('the Link feed picker offers only named feeds not already on this device, and PATCHes the chosen one', async () => {
    routes['PATCH /feeds/feed-prog'] = () => reply({ id: 'feed-prog' });
    renderSection();
    const cameras = await waitFor(() => screen.getByTestId('devices-cameras'));
    await within(cameras).findByTestId('linked-feed');
    fireEvent.click(within(cameras).getByRole('button', { name: 'Link feed' }));

    const picker = within(cameras).getByLabelText('Choose a feed');
    const options = within(picker).getAllByRole('option').map(o => o.textContent);
    expect(options).toEqual(['Choose a feed', 'Program', 'Loose feed']);
    expect(within(picker).queryByText('Main video')).toBeNull();   // managed
    expect(within(picker).queryByText('Altar cam')).toBeNull();    // already on this camera

    fireEvent.change(picker, { target: { value: 'feed-prog' } });
    await waitFor(() => expect(calls.some(c => c.method === 'PATCH')).toBe(true));
    expect(calls.find(c => c.method === 'PATCH')).toMatchObject({
      path: '/feeds/feed-prog',
      body: { deviceType: 'camera', deviceId: 'cam-1' },
    });
  });

  it('Unlink PATCHes the feed with a cleared device link', async () => {
    routes['PATCH /feeds/feed-altar'] = () => reply({ id: 'feed-altar' });
    renderSection();
    const cameras = await waitFor(() => screen.getByTestId('devices-cameras'));
    const linked = await within(cameras).findByTestId('linked-feed');
    fireEvent.click(within(linked).getByRole('button', { name: 'Unlink' }));
    await waitFor(() => expect(calls.some(c => c.method === 'PATCH')).toBe(true));
    expect(calls.find(c => c.method === 'PATCH')).toMatchObject({
      path: '/feeds/feed-altar',
      body: { deviceType: null, deviceId: null },
    });
  });

  it('reloads the feed list when another card announces a feed change', async () => {
    renderSection();
    await screen.findByText('Altar');
    const before = calls.filter(c => c.path === '/feeds').length;
    window.dispatchEvent(new Event(FEEDS_CHANGED_EVENT));
    await waitFor(() => expect(calls.filter(c => c.path === '/feeds').length).toBeGreaterThan(before));
    expect(calls.filter(c => c.path === '/feeds').length).toBe(before + 1);
  });

  it('a link change announces itself, so the Feeds card reloads', async () => {
    routes['PATCH /feeds/feed-prog'] = () => reply({ id: 'feed-prog' });
    const heard = vi.fn();
    window.addEventListener(FEEDS_CHANGED_EVENT, heard);
    renderSection();
    const cameras = await waitFor(() => screen.getByTestId('devices-cameras'));
    await within(cameras).findByTestId('linked-feed');
    fireEvent.click(within(cameras).getByRole('button', { name: 'Link feed' }));
    fireEvent.change(within(cameras).getByLabelText('Choose a feed'), { target: { value: 'feed-prog' } });
    await waitFor(() => expect(heard).toHaveBeenCalled());
    window.removeEventListener(FEEDS_CHANGED_EVENT, heard);
    notifyFeedsChanged();
  });

  it('shows the device rows without link controls when the feed list is unavailable', async () => {
    routes['GET /feeds'] = () => reply({}, 500);
    renderSection();
    expect(await screen.findByText('Altar')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Link feed' })).toBeNull();
  });
});
