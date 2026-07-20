import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionContext } from '../../src/contexts/SessionContext.jsx';

vi.mock('../../src/components/AdminKeyGate.jsx', () => ({ AdminKeyGate: ({ children }) => <div>{children}</div> }));

import { AiObservabilityPage } from '../../src/components/AiObservabilityPage.jsx';

const CONNECTED_SESSION = {
  connected: true,
  backendUrl: 'https://api.test',
  apiKey: 'key-1',
  getSessionToken: () => 'tok',
  getPersistedConfig: () => ({ backendUrl: 'https://api.test', apiKey: 'key-1' }),
};

const DISCONNECTED_SESSION = {
  connected: false,
  backendUrl: '',
  apiKey: '',
  getSessionToken: () => null,
  getPersistedConfig: () => ({ backendUrl: 'https://api.test', apiKey: 'key-1' }),
};

function mockFetchImpl({ statuses = {}, captures = {}, onStart, onStop, onReplay } = {}) {
  return vi.fn(async (url, opts = {}) => {
    const method = opts.method || 'GET';

    const statusMatch = url.match(/\/roles\/([^/]+)\/status$/);
    if (statusMatch && method === 'GET') {
      const role = statusMatch[1];
      return { ok: true, json: async () => ({ ok: true, running: false, lastUpdateAt: null, lastError: null, ...(statuses[role] || {}) }) };
    }

    const startMatch = url.match(/\/roles\/([^/]+)\/start$/);
    if (startMatch && method === 'POST') {
      onStart?.(startMatch[1]);
      return { ok: true, json: async () => ({ ok: true }) };
    }

    const stopMatch = url.match(/\/roles\/([^/]+)\/stop$/);
    if (stopMatch && method === 'POST') {
      onStop?.(stopMatch[1]);
      return { ok: true, json: async () => ({ ok: true, wasRunning: true }) };
    }

    const capturesMatch = url.match(/\/roles\/([^/]+)\/captures$/);
    if (capturesMatch && method === 'GET') {
      const role = capturesMatch[1];
      return { ok: true, json: async () => ({ ok: true, captures: captures[role] || [] }) };
    }

    const replayMatch = url.match(/\/roles\/([^/]+)\/captures\/([^/]+)\/replay$/);
    if (replayMatch && method === 'POST') {
      const [, role, id] = replayMatch;
      const body = JSON.parse(opts.body);
      onReplay?.(role, id, body);
      return {
        ok: true,
        json: async () => ({
          ok: true,
          original: { prompt: 'built-in prompt', result: { text: null, json: { objects: [{ label: 'person' }] } }, error: null },
          replay: { prompt: body.promptOverride, result: { text: null, json: { objects: [{ label: 'dog' }] } } },
        }),
      };
    }

    return { ok: true, json: async () => ({}) };
  });
}

function renderWith(session, fetchImpl) {
  global.fetch = fetchImpl || mockFetchImpl();
  return render(
    <SessionContext.Provider value={session}>
      <AiObservabilityPage />
    </SessionContext.Provider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('AiObservabilityPage', () => {
  it('shows a connect prompt when no project session is connected', async () => {
    renderWith(DISCONNECTED_SESSION);
    expect(await screen.findByText('Connect a project session to inspect its vision roles.')).toBeInTheDocument();
  });

  it('shows Tracker/Describer status chips from GET /roles/:roleCode/status', async () => {
    renderWith(CONNECTED_SESSION, mockFetchImpl({
      statuses: { tracker: { running: true }, describer: { running: false, lastError: 'boom' } },
    }));

    await waitFor(() => expect(screen.getByText('tracker', { selector: 'strong' })).toBeInTheDocument());
    expect(screen.getByText('describer', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();
    expect(screen.getByText(/stopped/)).toBeInTheDocument();
    expect(screen.getByText(/boom/)).toBeInTheDocument();
  });

  it('starting a stopped role calls POST /roles/:roleCode/start', async () => {
    const onStart = vi.fn();
    renderWith(CONNECTED_SESSION, mockFetchImpl({
      statuses: { tracker: { running: false }, describer: { running: false } },
      onStart,
    }));

    await waitFor(() => expect(screen.getByText('tracker', { selector: 'strong' })).toBeInTheDocument());
    const user = userEvent.setup();
    const trackerChip = screen.getByText('tracker', { selector: 'strong' }).closest('div');
    await user.click(within(trackerChip).getByRole('button', { name: 'Start' }));

    await waitFor(() => expect(onStart).toHaveBeenCalledWith('tracker'));
  });

  it('lists captures for the selected role tab and switches lists with the tab', async () => {
    const captures = {
      tracker: [{ id: 't1', ts: 1000, prompt: 'find the goalkeeper', result: { text: null, json: { objects: [] } }, error: null }],
      describer: [{ id: 'd1', ts: 2000, prompt: 'describe the scene', result: { text: 'a quiet room', json: null }, error: null }],
    };
    renderWith(CONNECTED_SESSION, mockFetchImpl({ captures }));

    await waitFor(() => expect(screen.getByText('Captures (1)')).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'describer' }));

    await waitFor(() => expect(screen.getByText('Captures (1)')).toBeInTheDocument());
    // Only the describer capture's timestamp row should now be selectable —
    // switching tabs re-renders the list from hook.captures.describer.
    expect(screen.getAllByRole('button').some((b) => b.textContent.includes(new Date(2000).toLocaleTimeString()))).toBe(true);
  });

  it('replays a selected capture with an edited prompt and shows the diffed result', async () => {
    const captures = {
      tracker: [{ id: 't1', ts: 1000, prompt: 'find the goalkeeper', result: { text: null, json: { objects: [{ label: 'person' }] } }, error: null }],
      describer: [],
    };
    const onReplay = vi.fn();
    renderWith(CONNECTED_SESSION, mockFetchImpl({ captures, onReplay }));

    await waitFor(() => expect(screen.getByText('Captures (1)')).toBeInTheDocument());

    const user = userEvent.setup();
    // Select the one capture in the list.
    const captureButtons = screen.getAllByRole('button').filter((b) => b.textContent.includes(new Date(1000).toLocaleTimeString()));
    await user.click(captureButtons[0]);

    const textarea = await screen.findByLabelText(/Prompt \(editable/);
    expect(textarea.value).toBe('find the goalkeeper');
    await user.clear(textarea);
    await user.type(textarea, 'find the dog instead');

    await user.click(screen.getByRole('button', { name: /Replay against this frame/ }));

    await waitFor(() => expect(onReplay).toHaveBeenCalledWith('tracker', 't1', { promptOverride: 'find the dog instead' }));
    await waitFor(() => expect(screen.getByText(/"label": "dog"/)).toBeInTheDocument());
    expect(screen.getByText(/"label": "person"/)).toBeInTheDocument();
  });
});
