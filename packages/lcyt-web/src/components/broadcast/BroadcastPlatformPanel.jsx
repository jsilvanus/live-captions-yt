/**
 * Per-broadcast platform panel — schedule, thumbnail, go live, end, stats.
 *
 * The operational half of what the retired `broadcast/YouTubeTab.jsx` did,
 * now tied to a specific `broadcasts` row rather than floating free, and
 * driven by a server-held credential instead of a browser token that vanished
 * with the tab.
 *
 * MULTI-CHANNEL: the account picker only appears when a project actually has
 * more than one channel connected — the common single-channel case stays a
 * plain button with no extra choice to make. When the backend answers 409
 * `ambiguous_credential` (a channel was connected in another tab since we
 * loaded), the returned candidate list populates the picker in place rather
 * than dead-ending.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSessionContext } from '../../contexts/SessionContext.jsx';
import { useEventStream } from '../../hooks/useEventStream.js';
import {
  usePlatforms, usePlatformCredentials, describePlatformError, liveCredentialsFor,
} from '../../hooks/usePlatforms.js';
import { ViewerTrendChart } from './ViewerTrendChart.jsx';

const PLATFORM = 'youtube';
const PLATFORM_LABEL = 'YouTube';
const THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;
const THUMBNAIL_TYPES = ['image/png', 'image/jpeg'];

export function BroadcastPlatformPanel({ broadcast, onChanged }) {
  const api = usePlatforms();
  const { credentials, storageAvailable, reload: reloadCredentials } = usePlatformCredentials();
  const session = useSessionContext();

  const [link, setLink] = useState(null);
  const [stats, setStats] = useState(null);
  const [history, setHistory] = useState([]);
  const [liveViewers, setLiveViewers] = useState(null);
  const [credentialId, setCredentialId] = useState('');
  const [candidates, setCandidates] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const fileInputRef = useRef(null);

  const broadcastId = broadcast?.id;
  const connectedAccounts = candidates || liveCredentialsFor(credentials, PLATFORM);
  const needsPicker = connectedAccounts.length > 1;
  const isLinked = !!link;
  const isLive = link?.lastStatus === 'live';
  const isComplete = link?.lastStatus === 'complete';

  const refresh = useCallback(async () => {
    if (!broadcastId || !api.ready) return;
    try {
      const [linksData, statsData] = await Promise.all([
        api.listLinks(broadcastId),
        api.getStats(broadcastId, PLATFORM, { history: true }),
      ]);
      setLink((linksData.links || []).find(l => l.platform === PLATFORM) || null);
      setStats(statsData);
      setHistory(statsData.history || []);
      setError('');
    } catch (err) {
      setError(describePlatformError(err));
    }
  }, [api, broadcastId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Live viewer count arrives pushed on the shared event stream — the backend
  // is already polling YouTube, so having the UI poll the backend on top of
  // that would just add latency and load for no extra freshness.
  const { on } = useEventStream({
    backendUrl: session?.backendUrl,
    connected: !!session?.connected,
    getToken: session?.getSessionToken,
  });
  useEffect(() => {
    if (!broadcastId) return undefined;
    return on('platform.stats_updated', (event) => {
      const data = event?.data || event;
      if (data?.broadcastId !== broadcastId || data?.platform !== PLATFORM) return;
      setLiveViewers(data.concurrentViewers);
      setHistory(prev => [...prev, {
        capturedAt: data.capturedAt,
        concurrentViewers: data.concurrentViewers,
      }].slice(-500));
    });
  }, [on, broadcastId]);

  /** Wrap an action: clear messages, run, surface a picker on ambiguity, refresh. */
  async function run(name, fn) {
    setError('');
    setNotice('');
    setBusy(name);
    try {
      const result = await fn(credentialId ? { credentialId } : {});
      await refresh();
      onChanged?.();
      return result;
    } catch (err) {
      if (err?.code === 'ambiguous_credential' && err.candidates?.length) {
        // Populate the picker in place instead of dead-ending — this happens
        // when a channel was connected in another tab after we loaded.
        setCandidates(err.candidates);
        setError('Pick which channel to use, then try again.');
      } else {
        setError(describePlatformError(err));
      }
      return null;
    } finally {
      setBusy('');
    }
  }

  async function schedule(bindStreamKey = false) {
    const result = await run('schedule', (creds) =>
      api.schedule(broadcastId, PLATFORM, { ...creds, bindStreamKey }));
    if (!result) return;
    const target = result.captionTarget;
    if (target?.bound && target.created) {
      setNotice('Scheduled. The channel’s stream key was saved as a new YouTube caption target.');
    } else if (target?.bound) {
      setNotice('Scheduled. The existing YouTube caption target now uses this channel’s stream key.');
    } else if (target?.reason === 'existing_target') {
      // Deliberately not silent and deliberately not automatic — a key the
      // operator pasted by hand is not ours to overwrite without asking.
      setNotice('existing-target');
    } else {
      setNotice('Scheduled on YouTube.');
    }
  }

  async function onThumbnailPicked(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!THUMBNAIL_TYPES.includes(file.type)) {
      setError('Thumbnail must be a PNG or JPEG image.');
      return;
    }
    if (file.size > THUMBNAIL_MAX_BYTES) {
      setError('Thumbnail must be 2 MB or smaller.');
      return;
    }
    const data = await fileToBase64(file);
    await run('thumbnail', (creds) =>
      api.setThumbnail(broadcastId, PLATFORM, { ...creds, data, mimeType: file.type }));
  }

  async function goLive() {
    const result = await run('go-live', (creds) => api.goLive(broadcastId, PLATFORM, creds));
    if (!result) return;
    // The platform transition already succeeded and cannot be undone, so a
    // caption-session failure is reported as a partial outcome, not as
    // "nothing happened".
    setNotice(result.partial ? result.warning : 'You are live on YouTube.');
  }

  async function end() {
    const result = await run('end', (creds) => api.endBroadcast(broadcastId, PLATFORM, creds));
    if (result) setNotice('Broadcast ended. Viewer summary captured.');
  }

  if (!broadcast) return null;

  if (!storageAvailable) {
    return (
      <section className="broadcast-platform-panel">
        <h3>{PLATFORM_LABEL}</h3>
        <p style={mutedStyle}>
          This server cannot store platform credentials (no <code>PLATFORM_CREDENTIAL_KEY</code>).
          Ask an administrator to configure one.
        </p>
      </section>
    );
  }

  if (!connectedAccounts.length) {
    // Disabled with an explanation and a way forward, rather than hidden —
    // an absent panel reads as "this feature doesn't exist".
    return (
      <section className="broadcast-platform-panel">
        <h3>{PLATFORM_LABEL}</h3>
        <p style={mutedStyle}>
          No YouTube channel is connected to this project yet.{' '}
          <a href="/setup/broadcast-platforms">Connect one in Setup</a> to schedule this
          broadcast, set its thumbnail, go live, and see viewer stats here.
        </p>
      </section>
    );
  }

  return (
    <section className="broadcast-platform-panel">
      <header style={headerStyle}>
        <h3 style={{ margin: 0 }}>{PLATFORM_LABEL}</h3>
        {link?.lastStatus && <span className="setup-item-row__badge">{link.lastStatus}</span>}
        {isLive && liveViewers != null && (
          <span className="setup-item-row__badge" title="Concurrent viewers right now">
            👁 {liveViewers}
          </span>
        )}
      </header>

      {needsPicker && (
        <label style={fieldStyle}>
          <span style={labelStyle}>Channel</span>
          <select value={credentialId} onChange={e => setCredentialId(e.target.value)}>
            <option value="">Choose a channel…</option>
            {connectedAccounts.map(c => (
              <option key={c.credentialId} value={c.credentialId}>
                {c.accountLabel || c.externalAccountId}
              </option>
            ))}
          </select>
        </label>
      )}

      {error && <p role="alert" style={errorStyle}>{error}</p>}

      {notice === 'existing-target' ? (
        <p role="status" style={mutedStyle}>
          Scheduled. This project already has a YouTube caption target with a stream key
          entered manually — we left it alone.{' '}
          <button type="button" style={linkButtonStyle} onClick={() => schedule(true)}>
            Replace it with this channel’s key
          </button>
        </p>
      ) : notice ? (
        <p role="status" style={mutedStyle}>{notice}</p>
      ) : null}

      <div style={actionsStyle}>
        <button type="button" disabled={!!busy} onClick={() => schedule(false)}>
          {busy === 'schedule' ? 'Working…' : (isLinked ? 'Update on YouTube' : 'Schedule on YouTube')}
        </button>

        <button
          type="button"
          disabled={!!busy || !isLinked}
          title={isLinked ? undefined : 'Schedule this broadcast first'}
          onClick={() => fileInputRef.current?.click()}
        >
          {busy === 'thumbnail' ? 'Uploading…' : (link?.thumbnailUrl ? 'Replace thumbnail' : 'Set thumbnail')}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={THUMBNAIL_TYPES.join(',')}
          style={{ display: 'none' }}
          onChange={onThumbnailPicked}
        />

        {!isLive && !isComplete && (
          <button type="button" disabled={!!busy || !isLinked} onClick={goLive}>
            {busy === 'go-live' ? 'Going live…' : 'Go live'}
          </button>
        )}
        {isLive && (
          <button type="button" className="danger" disabled={!!busy} onClick={end}>
            {busy === 'end' ? 'Ending…' : 'End stream'}
          </button>
        )}
      </div>

      {link?.thumbnailUrl && (
        <img
          src={link.thumbnailUrl}
          alt="Broadcast thumbnail"
          style={{ maxWidth: 240, borderRadius: 6, marginTop: '0.6rem' }}
        />
      )}

      {link?.lastSyncError && (
        <p style={mutedStyle} title="The most recent sync with the platform failed">
          Last sync error: {link.lastSyncError}
        </p>
      )}

      {isComplete && stats?.summary && (
        <dl style={summaryStyle}>
          <Stat label="Views" value={stats.summary.views} />
          <Stat label="Avg. watch time" value={formatDuration(stats.summary.averageWatchTimeSec)} />
          <Stat label="Peak concurrent" value={stats.summary.peakConcurrentViewers} />
        </dl>
      )}

      {history.length > 1 && (
        <ViewerTrendChart points={history} title="Concurrent viewers" />
      )}
    </section>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <dt style={labelStyle}>{label}</dt>
      {/* Analytics is batch-processed, so a summary fetched right after the
          stream ends legitimately has nothing yet — say so rather than 0. */}
      <dd style={{ margin: 0, fontSize: '1.2em' }}>{value ?? '—'}</dd>
    </div>
  );
}

function formatDuration(seconds) {
  if (seconds == null) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m ? `${m}m ${s}s` : `${s}s`;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const headerStyle = { display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem' };
const actionsStyle = { display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.6rem' };
const fieldStyle = { display: 'block', marginBottom: '0.6rem' };
const labelStyle = { fontSize: '0.8em', fontWeight: 600, opacity: 0.8, display: 'block', marginBottom: 2 };
const mutedStyle = { opacity: 0.85, fontSize: '0.9em' };
const errorStyle = { color: 'var(--danger, #c0392b)', fontSize: '0.9em' };
const summaryStyle = { display: 'flex', gap: '1.5rem', margin: '0.8rem 0 0' };
const linkButtonStyle = {
  background: 'none', border: 'none', padding: 0,
  color: 'inherit', textDecoration: 'underline', cursor: 'pointer', font: 'inherit',
};
