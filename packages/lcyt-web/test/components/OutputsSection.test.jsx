import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { SessionContext } from '../../src/contexts/SessionContext.jsx';
import { LangProvider } from '../../src/contexts/LangContext.jsx';
import { OutputsSection } from '../../src/components/setup-hub/OutputsSection.jsx';

const session = { connected: true, apiKey: 'k', backendUrl: 'http://backend.test', getSessionToken: () => 'tok', getPersistedConfig: () => ({}) };

const FEEDS = [
  { id: 'managed:dsk', name: 'DSK', managed: true, kind: 'dsk' },
  { id: 'feed-main', name: 'Main video', managed: false, primary: true, kind: 'generic', label: 'main' },
  { id: 'feed-cam', name: 'Altar cam', managed: false, kind: 'camera', label: null },
];
const OUTPUTS = [
  { id: 'out-prog', name: 'Program', sourceType: 'feed', sourceId: 'feed-main', dsk: ['lower'], cropEnabled: false, audioSource: 'source', enabled: true },
  { id: 'out-vert', name: 'Vertical', sourceType: 'output', sourceId: 'out-prog', dsk: [], cropEnabled: true, audioSource: 'source', enabled: true },
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
        <Router hook={hook}><OutputsSection /></Router>
      </SessionContext.Provider>
    </LangProvider>,
  );
}

beforeEach(() => {
  localStorage.setItem('lcyt:lang', 'en');
  calls = [];
  routes = {
    'GET /outputs': () => reply({ outputs: OUTPUTS }),
    'GET /feeds': () => reply({ feeds: FEEDS }),
    'GET /dsk/k/viewports': () => reply({ viewports: [{ name: 'lower', label: 'Lower third' }, { name: 'bug' }] }),
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

describe('OutputsSection', () => {
  it('lists the outputs with their source, DSK count and crop', async () => {
    renderSection();
    expect(await screen.findByText('Program')).toBeTruthy();
    expect(screen.getByText('from Main video (main) · DSK: 1')).toBeTruthy();
    expect(screen.getByText('from Program · crop')).toBeTruthy();
  });

  it('creates an output from a feed with a ticked viewport and a feed audio source', async () => {
    routes['POST /outputs'] = () => reply({ id: 'out-new' }, 201);
    renderSection();
    await screen.findByText('Program');
    fireEvent.click(screen.getByText('Add output'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(dialog.querySelector('input[type="text"]'), { target: { value: 'Stage' } });
    fireEvent.click(screen.getByLabelText('Lower third'));
    const selects = dialog.querySelectorAll('select');
    fireEvent.change(selects[0], { target: { value: 'feed:feed-cam' } });
    fireEvent.change(selects[1], { target: { value: 'feed:feed-cam' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(calls.some(c => c.method === 'POST' && c.path === '/outputs')).toBe(true));
    expect(calls.find(c => c.method === 'POST').body).toEqual({
      name: 'Stage', sourceType: 'feed', sourceId: 'feed-cam', dsk: ['lower'], cropEnabled: false,
      audioSource: { feed: 'feed-cam' }, enabled: true,
    });
  });

  it('shows the server reason when a save is refused', async () => {
    routes['POST /outputs'] = () => reply({ error: 'An output named "Stage" already exists' }, 409);
    renderSection();
    await screen.findByText('Program');
    fireEvent.click(screen.getByText('Add output'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(dialog.querySelector('input[type="text"]'), { target: { value: 'Stage' } });
    fireEvent.click(screen.getByText('Save'));
    expect(await screen.findByText('An output named "Stage" already exists')).toBeTruthy();
  });

  it('offers other outputs but not itself as a source when editing', async () => {
    renderSection();
    await screen.findByText('Program');
    fireEvent.click(screen.getAllByTitle('Settings')[0]);
    const dialog = await screen.findByRole('dialog');
    const values = [...dialog.querySelectorAll('select')[0].options].map(o => o.value);
    expect(values).toContain('output:out-vert');
    expect(values).not.toContain('output:out-prog');
  });

  it('toggles enabled with a PATCH', async () => {
    routes['PATCH /outputs/out-prog'] = () => reply({});
    renderSection();
    await screen.findByText('Program');
    fireEvent.click(screen.getByLabelText('Disable Program'));
    await waitFor(() => expect(calls.some(c => c.method === 'PATCH' && c.path === '/outputs/out-prog')).toBe(true));
    expect(calls.find(c => c.method === 'PATCH').body).toEqual({ enabled: false });
  });
});
