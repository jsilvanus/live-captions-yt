import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { SessionContext } from '../../src/contexts/SessionContext.jsx';
import { TallySection } from '../../src/components/setup-hub/TallySection.jsx';

const session = { connected: true, apiKey: 'k', backendUrl: 'http://backend.test', getSessionToken: () => 'tok', getPersistedConfig: () => ({}) };

function renderSection(value = session) {
  const { hook } = memoryLocation({ path: '/setup' });
  return render(
    <SessionContext.Provider value={value}>
      <Router hook={hook}><TallySection /></Router>
    </SessionContext.Provider>,
  );
}

let calls;
let lights;

beforeEach(() => {
  calls = [];
  lights = [];
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const path = String(url).replace('http://backend.test', '');
    calls.push({ path, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : undefined, auth: opts.headers?.Authorization });
    if (path === '/api/v1/tally/lights' && (opts.method || 'GET') === 'GET') return { ok: true, status: 200, json: async () => ({ lights }) };
    if (path === '/api/v1/production/bridge/instances') return { ok: true, status: 200, json: async () => [{ id: 'b1', name: 'Church bridge' }] };
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  });
});
afterEach(() => { vi.restoreAllMocks(); });

describe('TallySection', () => {
  it('asks to connect when there is no project session', () => {
    renderSection({ ...session, connected: false });
    expect(screen.getByText(/Connect to a project/)).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('lists lights from /api/v1/tally with their state and error', async () => {
    lights = [
      { id: 'l1', name: 'Door', kind: 'live-signal', enabled: true, source: { mode: 'A' }, output: { host: '10.0.0.5' }, status: { state: 'LIVE', error: null } },
      { id: 'l2', name: 'Cam 1', kind: 'camera', enabled: true, source: { host: '10.0.0.6', input: 2 }, output: { host: '10.0.0.7' }, status: { runner: 'none', note: 'Runs on the bridge', error: 'tally-ma: boom' } },
    ];
    renderSection();
    expect(await screen.findByText('Door')).toBeInTheDocument();
    expect(screen.getByText(/Live signal · Live$/)).toBeInTheDocument();
    expect(screen.getByText(/Camera tally · Runs on the bridge · ⚠ tally-ma: boom/)).toBeInTheDocument();
    expect(calls[0]).toMatchObject({ path: '/api/v1/tally/lights', method: 'GET', auth: 'Bearer tok' });
  });

  it('creates a live-signal light with the project login and a lamp address', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Door' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Enter the lamp address.')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Lamp address (Tally-MA)'), { target: { value: '192.168.1.50' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.method === 'POST');
    expect(post.path).toBe('/api/v1/tally/lights');
    expect(post.body).toEqual({
      name: 'Door', kind: 'live-signal', enabled: true, runner: 'auto',
      output: { type: 'tally-ma', host: '192.168.1.50' },
      source: { type: 'youtube', mode: 'A' },
    });
  });

  it('creates a camera light on a chosen bridge', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Cam 2' } });
    fireEvent.change(within(dialog).getByLabelText('Kind'), { target: { value: 'camera' } });
    fireEvent.change(within(dialog).getByLabelText('ATEM address'), { target: { value: '192.168.1.60' } });
    fireEvent.change(within(dialog).getByLabelText('Input'), { target: { value: '3' } });
    fireEvent.change(within(dialog).getByLabelText('Lamp address (Tally-MA)'), { target: { value: '192.168.1.51' } });
    fireEvent.change(within(dialog).getByLabelText('Where it runs'), { target: { value: 'bridge' } });
    await within(dialog).findByRole('option', { name: 'Church bridge' });
    fireEvent.change(within(dialog).getByLabelText('Bridge'), { target: { value: 'b1' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST').body).toMatchObject({
      kind: 'camera', runner: 'bridge', bridgeInstanceId: 'b1',
      source: { type: 'atem', host: '192.168.1.60', input: 3, meIndex: 0 },
      output: { type: 'tally-ma', host: '192.168.1.51' },
    });
  });

  it('shows the server error in the dialog', async () => {
    globalThis.fetch = vi.fn(async (url, opts = {}) => {
      if ((opts.method || 'GET') === 'GET') return { ok: true, status: 200, json: async () => ({ lights: [] }) };
      return { ok: false, status: 409, json: async () => ({ error: 'Lights "a" and "b" would drive the same lamp' }) };
    });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'b' } });
    fireEvent.change(within(dialog).getByLabelText('Lamp address (Tally-MA)'), { target: { value: '10.0.0.1' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText(/same lamp/)).toBeInTheDocument();
  });

  it('tests a lamp state from the edit dialog', async () => {
    lights = [{ id: 'l1', name: 'Door', kind: 'live-signal', enabled: true, source: { mode: 'A' }, output: { host: '10.0.0.5' }, status: { state: 'OFF' } }];
    const { container } = renderSection();
    await screen.findByText('Door');
    const edit = container.querySelector('[title="Settings"]');
    fireEvent.click(edit);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Live' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/v1/tally/lights/l1/test')).toBe(true));
    expect(calls.find((c) => c.path.endsWith('/test')).body).toEqual({ state: 'LIVE' });
    expect(await within(dialog).findByText('Sent: Live.')).toBeInTheDocument();
  });
});
