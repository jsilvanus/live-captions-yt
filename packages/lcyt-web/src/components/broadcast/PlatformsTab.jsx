/**
 * Broadcast page → "YouTube" sub-tab.
 *
 * This used to be `YouTubeTab.jsx`, which ran its own Google Identity Services
 * implicit-token flow in the browser and listed the channel's upcoming
 * broadcasts. That is gone: the token it obtained could never be refreshed and
 * did not survive the tab closing, so nothing built on it could schedule
 * ahead, upload a thumbnail in the background, or gather stats.
 *
 * The work moved to two places, and this tab now points at both rather than
 * being a third parallel implementation:
 *   - connecting channels → the Setup Hub "Broadcast platforms" card
 *   - acting on a specific broadcast → the Platforms panel on /broadcasts
 *
 * It still shows connection state, so the tab answers "is YouTube set up?"
 * without a trip elsewhere.
 */
import { usePlatformCredentials, liveCredentialsFor } from '../../hooks/usePlatforms.js';

export function PlatformsTab() {
  const { credentials, storageAvailable, loading, error } = usePlatformCredentials();
  const channels = liveCredentialsFor(credentials, 'youtube');

  return (
    <div className="broadcast-platforms-tab" style={{ padding: '0.5rem 0' }}>
      <h3 style={{ marginTop: 0 }}>YouTube</h3>

      {loading && <p style={mutedStyle}>Loading…</p>}
      {error && <p role="alert" style={errorStyle}>{error}</p>}

      {!loading && !storageAvailable && (
        <p style={mutedStyle}>
          This server cannot store platform credentials (no <code>PLATFORM_CREDENTIAL_KEY</code> is
          configured). Ask an administrator to set one before connecting a channel.
        </p>
      )}

      {!loading && storageAvailable && (
        channels.length ? (
          <>
            <p style={mutedStyle}>
              {channels.length === 1
                ? 'Connected channel:'
                : `${channels.length} connected channels:`}
            </p>
            <ul style={{ margin: '0 0 1rem', paddingLeft: '1.2rem' }}>
              {channels.map(c => (
                <li key={c.credentialId}>{c.accountLabel || c.externalAccountId}</li>
              ))}
            </ul>
          </>
        ) : (
          <p style={mutedStyle}>No YouTube channel is connected to this project yet.</p>
        )
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.5rem' }}>
        <a className="btn btn--sm" href="/setup/broadcast-platforms">
          {channels.length ? 'Manage channels' : 'Connect a channel'}
        </a>
        <a className="btn btn--sm" href="/broadcasts">Schedule &amp; go live</a>
        <a className="btn btn--sm" href="https://studio.youtube.com" target="_blank" rel="noopener noreferrer">
          YouTube Studio ↗
        </a>
      </div>

      <p style={{ ...mutedStyle, marginTop: '1rem' }}>
        Scheduling, thumbnails, going live and viewer stats are per-broadcast — open a broadcast
        on the Broadcasts page and use its Platforms panel.
      </p>
    </div>
  );
}

const mutedStyle = { opacity: 0.85, fontSize: '0.9em' };
const errorStyle = { color: 'var(--danger, #c0392b)', fontSize: '0.9em' };
