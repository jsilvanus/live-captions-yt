import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionContext } from '../../src/contexts/SessionContext.jsx';
import { BroadcastPlatformPanel } from '../../src/components/broadcast/BroadcastPlatformPanel.jsx';

const session = {
  connected: true, backendUrl: 'https://api.test', apiKey: 'key-1', getSessionToken: () => 'tok',
};

const BROADCAST = { id: 'b1', title: 'Sunday Service', description: 'Weekly', scheduledStart: '2026-08-02T09:00:00' };

const CHANNEL_A = {
  credentialId: 'cred-a', platform: 'youtube', externalAccountId: 'UC-a',
  accountLabel: 'Channel A', scopes: [], connectedAt: '2026-07-01T10:00:00.000', revokedAt: null,
};
const CHANNEL_B = { ...CHANNEL_A, credentialId: 'cred-b', externalAccountId: 'UC-b', accountLabel: 'Channel B' };

const NO_STATS = { latest: null, summary: null, peakConcurrentViewers: null, history: [] };

/**
 * @param {object} opts
 * @param {object[]} opts.credentials connected accounts
 * @param {object[]} opts.links       this broadcast's platform links
 * @param {object}   opts.stats       stats payload
 * @param {object}   opts.responses   per-action response or Error to throw
 */
function mockFetch({
  credentials = [CHANNEL_A], storageAvailable = true, links = [], stats = NO_STATS,
  responses = {}, onCall,
} = {}) {
  return vi.fn((url, opts = {}) => {
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : null;
    onCall?.({ url, method, body });

    if (url.endsWith('/platforms') && method === 'GET' && !url.includes('/broadcasts/')) {
      return Promise.resolve({ ok: true, json: async () => ({ credentialStorageAvailable: storageAvailable, credentials }) });
    }
    if (url.includes('/broadcasts/b1/platforms') && method === 'GET' && !url.includes('/stats')) {
      return Promise.resolve({ ok: true, json: async () => ({ links }) });
    }
    if (url.includes('/stats')) {
      return Promise.resolve({ ok: true, json: async () => stats });
    }
    for (const [action, response] of Object.entries(responses)) {
      if (url.includes(`/${action}`)) {
        if (response.status) {
          return Promise.resolve({ ok: false, status: response.status, json: async () => response.body });
        }
        return Promise.resolve({ ok: true, json: async () => response.body });
      }
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
}

const link = (over = {}) => ({
  platform: 'youtube', credentialId: 'cred-a', externalBroadcastId: 'yt-bc-1',
  externalStreamId: 'yt-st-1', externalVideoIds: [], thumbnailUrl: null,
  lastStatus: 'ready', lastSyncedAt: null, lastSyncError: null, ...over,
});

function renderPanel(broadcast = BROADCAST) {
  return render(
    <SessionContext.Provider value={session}>
      <BroadcastPlatformPanel broadcast={broadcast} />
    </SessionContext.Provider>,
  );
}

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('BroadcastPlatformPanel', () => {
  it('points at Setup when no channel is connected, rather than hiding', async () => {
    // An absent panel would read as "this feature doesn't exist".
    global.fetch = mockFetch({ credentials: [] });
    renderPanel();
    expect(await screen.findByText(/No YouTube channel is connected/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Connect one in Setup/ })).toBeInTheDocument();
  });

  it('explains a server with no credential key', async () => {
    global.fetch = mockFetch({ credentials: [], storageAvailable: false });
    renderPanel();
    expect(await screen.findByText(/PLATFORM_CREDENTIAL_KEY/)).toBeInTheDocument();
  });

  it('offers scheduling for an unlinked broadcast', async () => {
    global.fetch = mockFetch();
    renderPanel();
    expect(await screen.findByRole('button', { name: 'Schedule on YouTube' })).toBeInTheDocument();
  });

  it('shows no account picker for a single connected channel', async () => {
    // The common case should not make the operator choose.
    global.fetch = mockFetch({ credentials: [CHANNEL_A] });
    renderPanel();
    await screen.findByRole('button', { name: 'Schedule on YouTube' });
    expect(screen.queryByText('Channel')).not.toBeInTheDocument();
  });

  it('shows an account picker when several channels are connected', async () => {
    global.fetch = mockFetch({ credentials: [CHANNEL_A, CHANNEL_B] });
    renderPanel();
    expect(await screen.findByText('Channel')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Channel A' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Channel B' })).toBeInTheDocument();
  });

  it('sends the chosen credentialId with the action', async () => {
    const calls = [];
    global.fetch = mockFetch({
      credentials: [CHANNEL_A, CHANNEL_B],
      responses: { schedule: { body: { link: link(), captionTarget: null } } },
      onCall: (c) => calls.push(c),
    });
    renderPanel();
    // Two selects coexist once several channels are connected — the account
    // picker and the visibility control — so query by accessible name.
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: /Channel/ }), 'cred-b');
    await userEvent.click(screen.getByRole('button', { name: 'Schedule on YouTube' }));
    await waitFor(() => {
      const scheduleCall = calls.find(c => c.url.includes('/schedule'));
      expect(scheduleCall?.body).toEqual({
        credentialId: 'cred-b', bindStreamKey: false, privacyStatus: 'unlisted',
      });
    });
  });

  it('surfaces a picker in place when the backend reports ambiguity', async () => {
    // Happens when a channel is connected in another tab after we loaded.
    global.fetch = mockFetch({
      credentials: [CHANNEL_A],
      responses: {
        schedule: {
          status: 409,
          body: { error: 'several accounts', code: 'ambiguous_credential', candidates: [CHANNEL_A, CHANNEL_B] },
        },
      },
    });
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Schedule on YouTube' }));
    expect(await screen.findByText(/Pick which channel to use/)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Channel B' })).toBeInTheDocument();
  });

  it('reports when a stream key was bound into a new caption target', async () => {
    global.fetch = mockFetch({
      responses: { schedule: { body: { link: link(), captionTarget: { bound: true, created: true, targetId: 't1' } } } },
    });
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Schedule on YouTube' }));
    expect(await screen.findByText(/saved as a new YouTube caption target/)).toBeInTheDocument();
  });

  it('offers, but does not perform, overwriting a hand-entered stream key', async () => {
    // A key the operator pasted in is not ours to replace without asking.
    global.fetch = mockFetch({
      responses: { schedule: { body: { link: link(), captionTarget: { bound: false, reason: 'existing_target', available: true } } } },
    });
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Schedule on YouTube' }));
    expect(await screen.findByText(/we left it alone/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Replace it with this channel/ })).toBeInTheDocument();
  });

  it('defaults visibility to unlisted and sends the operator\'s choice', async () => {
    const calls = [];
    global.fetch = mockFetch({
      responses: { schedule: { body: { link: link(), captionTarget: null } } },
      onCall: (c) => calls.push(c),
    });
    renderPanel();

    const select = await screen.findByRole('combobox', { name: /Visibility/ });
    expect(select).toHaveValue('unlisted');

    await userEvent.selectOptions(select, 'public');
    await userEvent.click(screen.getByRole('button', { name: 'Schedule on YouTube' }));
    await waitFor(() => {
      const scheduleCall = calls.find(c => c.url.includes('/schedule'));
      expect(scheduleCall?.body.privacyStatus).toBe('public');
    });
  });

  it('seeds visibility from the broadcast rather than always unlisted', async () => {
    global.fetch = mockFetch();
    renderPanel({ ...BROADCAST, privacyStatus: 'private' });
    expect(await screen.findByRole('combobox', { name: /Visibility/ })).toHaveValue('private');
  });

  it('disables the thumbnail button until the broadcast is scheduled', async () => {
    global.fetch = mockFetch({ links: [] });
    renderPanel();
    expect(await screen.findByRole('button', { name: 'Set thumbnail' })).toBeDisabled();
  });

  it('enables go-live once linked, and hides it once live', async () => {
    global.fetch = mockFetch({ links: [link({ lastStatus: 'ready' })] });
    const { unmount } = renderPanel();
    expect(await screen.findByRole('button', { name: 'Go live' })).toBeEnabled();
    unmount();

    global.fetch = mockFetch({ links: [link({ lastStatus: 'live' })] });
    renderPanel();
    expect(await screen.findByRole('button', { name: 'End stream' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Go live' })).not.toBeInTheDocument();
  });

  it('reports a partial go-live as live-without-captions, not as a failure', async () => {
    // The platform transition cannot be undone, so "nothing happened" would be
    // the wrong story to tell.
    global.fetch = mockFetch({
      links: [link({ lastStatus: 'ready' })],
      responses: {
        'go-live': {
          body: {
            status: 'live', captionSessionStarted: false, partial: true,
            warning: 'The broadcast is live on youtube, but the caption session did not start: relay unavailable',
          },
        },
      },
    });
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Go live' }));
    expect(await screen.findByText(/live on youtube, but the caption session did not start/)).toBeInTheDocument();
  });

  it('translates an unusable credential into a reconnect prompt', async () => {
    global.fetch = mockFetch({
      links: [link({ lastStatus: 'ready' })],
      responses: {
        'go-live': {
          status: 409,
          body: { error: 'Refresh was rejected.', code: 'credential_unusable', reason: 'grant_revoked' },
        },
      },
    });
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Go live' }));
    expect(await screen.findByText(/Reconnect the account/)).toBeInTheDocument();
  });

  it('renders the post-broadcast summary once complete', async () => {
    global.fetch = mockFetch({
      links: [link({ lastStatus: 'complete' })],
      stats: {
        latest: null,
        summary: { kind: 'post_broadcast_summary', views: 500, averageWatchTimeSec: 125, peakConcurrentViewers: 91 },
        peakConcurrentViewers: 91,
        history: [],
      },
    });
    renderPanel();
    expect(await screen.findByText('500')).toBeInTheDocument();
    expect(screen.getByText('2m 5s')).toBeInTheDocument();
    expect(screen.getByText('91')).toBeInTheDocument();
  });

  it('shows an em dash rather than 0 when analytics has not processed yet', async () => {
    global.fetch = mockFetch({
      links: [link({ lastStatus: 'complete' })],
      stats: {
        latest: null,
        summary: { kind: 'post_broadcast_summary', views: null, averageWatchTimeSec: null, peakConcurrentViewers: 12 },
        peakConcurrentViewers: 12, history: [],
      },
    });
    renderPanel();
    await screen.findByText('12');
    expect(screen.getAllByText('—').length).toBe(2);
  });

  it('surfaces the last sync error so a stale count is explainable', async () => {
    global.fetch = mockFetch({ links: [link({ lastStatus: 'live', lastSyncError: 'quota exceeded' })] });
    renderPanel();
    expect(await screen.findByText(/Last sync error: quota exceeded/)).toBeInTheDocument();
  });

  it('renders a trend chart once there are at least two samples', async () => {
    global.fetch = mockFetch({
      links: [link({ lastStatus: 'live' })],
      stats: {
        latest: { concurrentViewers: 12 }, summary: null, peakConcurrentViewers: 42,
        history: [
          { capturedAt: '2026-08-02T09:00:00', concurrentViewers: 5 },
          { capturedAt: '2026-08-02T09:00:30', concurrentViewers: 42 },
          { capturedAt: '2026-08-02T09:01:00', concurrentViewers: 12 },
        ],
      },
    });
    renderPanel();
    expect(await screen.findByRole('img', { name: /peak 42/ })).toBeInTheDocument();
  });
});
