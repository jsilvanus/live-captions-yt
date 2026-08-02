import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionContext } from '../../src/contexts/SessionContext.jsx';
import { PlatformsSection } from '../../src/components/setup-hub/PlatformsSection.jsx';

const baseSession = {
  connected: true, backendUrl: 'https://api.test', apiKey: 'key-1', getSessionToken: () => 'tok',
};

const CHANNEL_A = {
  credentialId: 'cred-a', platform: 'youtube', externalAccountId: 'UC-a',
  accountLabel: 'Channel A', scopes: [], connectedAt: '2026-07-01T10:00:00.000', revokedAt: null,
};
const CHANNEL_B = { ...CHANNEL_A, credentialId: 'cred-b', externalAccountId: 'UC-b', accountLabel: 'Channel B' };

function mockFetch({ credentials = [], storageAvailable = true, onDisconnect, onStart } = {}) {
  return vi.fn((url, opts = {}) => {
    const method = opts.method || 'GET';
    if (url.endsWith('/platforms') && method === 'GET') {
      return Promise.resolve({
        ok: true,
        json: async () => ({ credentialStorageAvailable: storageAvailable, credentials }),
      });
    }
    if (url.includes('/oauth/start')) {
      onStart?.(url);
      return Promise.resolve({ ok: true, json: async () => ({ url: 'https://consent.test/auth?state=abc' }) });
    }
    if (url.includes('/disconnect')) {
      const body = JSON.parse(opts.body);
      onDisconnect?.(body);
      return Promise.resolve({ ok: true, json: async () => ({ revoked: true, remoteRevoked: true }) });
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({ error: 'not found' }) });
  });
}

function renderSection(session = baseSession) {
  return render(
    <SessionContext.Provider value={session}>
      <PlatformsSection />
    </SessionContext.Provider>,
  );
}

let assignSpy;

beforeEach(() => {
  window.history.replaceState({}, '', '/setup');
  assignSpy = vi.fn();
  // jsdom throws on a real navigation; replace the whole location object.
  delete window.location;
  window.location = { search: '', pathname: '/setup', assign: assignSpy };
});

afterEach(() => { vi.restoreAllMocks(); });

describe('PlatformsSection', () => {
  it('lists connected channels', async () => {
    global.fetch = mockFetch({ credentials: [CHANNEL_A] });
    renderSection();
    expect(await screen.findByText('Channel A')).toBeInTheDocument();
  });

  it('lists several channels on one platform', async () => {
    // Multi-channel is the normal case, not an error state.
    global.fetch = mockFetch({ credentials: [CHANNEL_A, CHANNEL_B] });
    renderSection();
    expect(await screen.findByText('Channel A')).toBeInTheDocument();
    expect(screen.getByText('Channel B')).toBeInTheDocument();
  });

  it('offers "Connect another" once a channel exists', async () => {
    global.fetch = mockFetch({ credentials: [CHANNEL_A] });
    renderSection();
    expect(await screen.findByText('Connect another')).toBeInTheDocument();
  });

  it('offers "Connect a channel" when none exists', async () => {
    global.fetch = mockFetch({ credentials: [] });
    renderSection();
    expect(await screen.findByText('Connect a channel')).toBeInTheDocument();
  });

  it('navigates the top-level window to the consent URL', async () => {
    // A fetch cannot follow a cross-origin redirect to a consent screen.
    global.fetch = mockFetch({ credentials: [] });
    renderSection();
    await userEvent.click(await screen.findByText('Connect a channel'));
    await waitFor(() => expect(assignSpy).toHaveBeenCalledWith('https://consent.test/auth?state=abc'));
  });

  it('explains itself and hides connecting when the server has no credential key', async () => {
    global.fetch = mockFetch({ credentials: [], storageAvailable: false });
    renderSection();
    expect(await screen.findByText(/PLATFORM_CREDENTIAL_KEY/)).toBeInTheDocument();
    expect(screen.queryByText('Connect a channel')).not.toBeInTheDocument();
  });

  it('confirms before disconnecting and sends the credentialId', async () => {
    const onDisconnect = vi.fn();
    global.fetch = mockFetch({ credentials: [CHANNEL_A], onDisconnect });
    renderSection();
    await userEvent.click(await screen.findByTitle('Delete'));
    expect(await screen.findByText('Disconnect this channel?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(onDisconnect).toHaveBeenCalledWith({ credentialId: 'cred-a' }));
  });

  it('warns when the provider would not confirm revocation', async () => {
    // Local disconnect succeeded, but the grant may still sit in the user's
    // Google account — papering over that would be dishonest.
    global.fetch = vi.fn((url, opts = {}) => {
      if (url.endsWith('/platforms') && (opts.method || 'GET') === 'GET') {
        return Promise.resolve({ ok: true, json: async () => ({ credentialStorageAvailable: true, credentials: [CHANNEL_A] }) });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ revoked: true, remoteRevoked: false, warning: 'you may want to remove access manually' }),
      });
    });
    renderSection();
    await userEvent.click(await screen.findByTitle('Delete'));
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(await screen.findByText(/remove access manually/)).toBeInTheDocument();
  });

  it('reports the outcome the OAuth callback redirect left on the URL', async () => {
    window.location.search = '?connected=1&platform=youtube&account=Channel%20A';
    global.fetch = mockFetch({ credentials: [CHANNEL_A] });
    renderSection();
    expect(await screen.findByText(/Connected Channel A/)).toBeInTheDocument();
  });

  it('explains a failed connect attempt', async () => {
    window.location.search = '?connected=0&platform=youtube&reason=denied';
    global.fetch = mockFetch({ credentials: [] });
    renderSection();
    expect(await screen.findByText(/You cancelled the consent screen/)).toBeInTheDocument();
  });

  it('hides revoked credentials', async () => {
    global.fetch = mockFetch({ credentials: [{ ...CHANNEL_A, revokedAt: '2026-07-02T00:00:00.000' }] });
    renderSection();
    expect(await screen.findByText('No channels connected yet.')).toBeInTheDocument();
    expect(screen.queryByText('Channel A')).not.toBeInTheDocument();
  });
});
