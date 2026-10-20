import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { SessionContext } from '../../src/contexts/SessionContext.jsx';
import { LangProvider } from '../../src/contexts/LangContext.jsx';
import { EgressSection } from '../../src/components/setup-hub/EgressSection.jsx';
import { setSlotYoutubeKey } from '../../src/lib/relayConfig.js';

const FEEDS = [
  { id: 'managed:video', managed: true, name: 'Main video', kind: 'generic', label: 'main', deviceType: null, deviceId: null },
  { id: 'feed-altar', managed: false, name: 'Altar cam', kind: 'camera', label: null, deviceType: 'camera', deviceId: 'cam-1' },
  { id: 'feed-prog', managed: false, name: 'Mixer 2', kind: 'generic', label: 'program', deviceType: null, deviceId: null },
];

let session;

function reply(body, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

function renderEgress() {
  const { hook } = memoryLocation({ path: '/setup' });
  return render(
    <LangProvider>
      <SessionContext.Provider value={session}>
        <Router hook={hook}><EgressSection /></Router>
      </SessionContext.Provider>
    </LangProvider>,
  );
}

function sourceSelect(container) {
  return [...container.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'crop')) || null;
}

async function openSlotSettings(container) {
  fireEvent.click(await screen.findByTitle('Settings'));
  fireEvent.click(screen.getByTitle('Advanced'));
  await waitFor(() => expect(sourceSelect(container)).not.toBeNull());
  return sourceSelect(container);
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('lcyt:lang', 'en');
  setSlotYoutubeKey(1, 'abcd-efgh-ijkl-mnop');
  globalThis.fetch = vi.fn(async (url) => {
    const path = String(url).replace('http://backend.test/api/v1', '');
    if (path === '/feeds') return reply({ feeds: FEEDS });
    if (path === '/outputs') return reply({ outputs: [{ id: 'out-aaa', name: 'Vertical', enabled: true }, { id: 'out-off', name: 'Off', enabled: false }] });
    return reply({}, 404);
  });
  session = {
    connected: true,
    apiKey: 'k',
    backendUrl: 'http://backend.test',
    getSessionToken: () => 'tok',
    getPersistedConfig: () => ({}),
    getRelayStatus: vi.fn(async () => ({ active: false, runningSlots: [] })),
    configureRelay: vi.fn(async () => ({})),
    setRelayActive: vi.fn(async () => ({})),
  };
});

afterEach(() => { vi.restoreAllMocks(); });

describe('EgressSection source picker', () => {
  it('a feed pick sends sourceFeedId in the relay request', async () => {
    const { container } = renderEgress();
    const select = await openSlotSettings(container);
    fireEvent.change(select, { target: { value: 'feed:feed-prog' } });

    await waitFor(() => expect(session.configureRelay).toHaveBeenCalled());
    const body = session.configureRelay.mock.calls.at(-1)[0];
    expect(body.sourceFeedId).toBe('feed-prog');
    expect(localStorage.getItem('lcyt.relay.slot1.sourceFeedId')).toBe('feed-prog');
  });

  it('an output pick sends sourceOutputId alone and lists only enabled outputs', async () => {
    const { container } = renderEgress();
    const select = await openSlotSettings(container);
    await waitFor(() => expect([...select.options].some(o => o.value === 'output:out-aaa')).toBe(true));
    expect([...select.options].some(o => o.value === 'output:out-off')).toBe(false);
    fireEvent.change(select, { target: { value: 'output:out-aaa' } });

    await waitFor(() => expect(session.configureRelay.mock.calls.at(-1)[0].sourceOutputId).toBe('out-aaa'));
    const body = session.configureRelay.mock.calls.at(-1)[0];
    expect(body.sourceFeedId).toBeUndefined();
    expect(localStorage.getItem('lcyt.relay.slot1.sourceOutputId')).toBe('out-aaa');
  });
});
