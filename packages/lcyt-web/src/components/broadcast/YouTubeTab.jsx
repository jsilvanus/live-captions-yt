import { useState, useCallback } from 'react';
import {
  requestYouTubeToken, getYouTubeToken, revokeYouTubeToken,
} from '../../lib/youtubeAuth';
import {
  listScheduledBroadcasts, transitionBroadcast, enableHttpCaptions,
} from '../../lib/youtubeApi';
import { useToastContext } from '../../contexts/ToastContext';
import { useSessionContext } from '../../contexts/SessionContext';
import { useEffect } from 'react';

export function YouTubeTab() {
  const { showToast } = useToastContext();
  const session = useSessionContext();
  const [clientId, setClientId] = useState('');
  const [clientIdLoading, setClientIdLoading] = useState(false);
  const [token, setToken] = useState(getYouTubeToken);
  const [loggingIn, setLoggingIn] = useState(false);
  const [broadcasts, setBroadcasts] = useState([]);
  const [loadingBroadcasts, setLoadingBroadcasts] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [ytBusy, setYtBusy] = useState(false);
  const [captionsBusy, setCaptionsBusy] = useState(false);

  // Fetch the OAuth client ID from the backend when connected
  useEffect(() => {
    if (!session.connected) return;
    setClientIdLoading(true);
    session.getYouTubeConfig()
      .then(cfg => setClientId(cfg.clientId))
      .catch(err => showToast(`YouTube not configured on server: ${err.message}`, 'error'))
      .finally(() => setClientIdLoading(false));
  }, [session.connected]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedBroadcast = broadcasts.find(b => b.id === selectedId) || null;
  const broadcastStatus = selectedBroadcast?.status?.lifeCycleStatus || '';
  const isLive = broadcastStatus === 'live';
  const isComplete = broadcastStatus === 'complete';
  const httpCaptionsEnabled =
    selectedBroadcast?.contentDetails?.closedCaptionsType === 'closedCaptionsHttpPost';

  const fetchBroadcasts = useCallback(async (tok) => {
    setLoadingBroadcasts(true);
    try {
      const items = await listScheduledBroadcasts(tok);
      setBroadcasts(items);
      if (items.length > 0) setSelectedId(items[0].id);
    } catch (err) {
      showToast(`Could not load broadcasts: ${err.message}`, 'error');
      setBroadcasts([]);
    } finally {
      setLoadingBroadcasts(false);
    }
  }, [showToast]);

  async function handleSignIn() {
    setLoggingIn(true);
    try {
      const tok = await requestYouTubeToken(clientId);
      setToken(tok);
      await fetchBroadcasts(tok);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoggingIn(false);
    }
  }

  function handleSignOut() {
    revokeYouTubeToken();
    setToken(null);
    setBroadcasts([]);
    setSelectedId('');
  }

  async function handleTransition(targetStatus) {
    if (!token || !selectedId) return;
    setYtBusy(true);
    try {
      await transitionBroadcast(token, selectedId, targetStatus);
      showToast(
        targetStatus === 'live' ? 'Stream is now live!' : 'Stream ended.',
        targetStatus === 'live' ? 'success' : 'info',
      );
      await fetchBroadcasts(token);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setYtBusy(false);
    }
  }

  async function handleEnableHttpCaptions() {
    if (!token || !selectedBroadcast) return;
    setCaptionsBusy(true);
    try {
      await enableHttpCaptions(token, selectedBroadcast);
      showToast(
        'HTTP captions enabled. YouTube requires a ~30 s caption delay for live streams — this is now configured.',
        'success',
      );
      await fetchBroadcasts(token);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setCaptionsBusy(false);
    }
  }

  const thumb = selectedBroadcast?.snippet?.thumbnails?.medium?.url
    || selectedBroadcast?.snippet?.thumbnails?.default?.url
    || null;
  const scheduledStart = selectedBroadcast?.snippet?.scheduledStartTime;

  return (
    <div className="settings-panel settings-panel--active broadcast-tab">
      {!session.connected && (
        <p className="broadcast-hint">Connect to the backend first to use YouTube features.</p>
      )}

      {/* Auth row */}
      {!token ? (
        <button
          className="btn btn--primary broadcast-google-btn"
          onClick={handleSignIn}
          disabled={loggingIn || !clientId || clientIdLoading || !session.connected}
        >
          {clientIdLoading ? 'Loading…' : loggingIn ? 'Signing in…' : 'Sign in with Google'}
        </button>
      ) : (
        <div className="broadcast-signed-in-row">
          <span className="broadcast-signed-in-label">Signed in</span>
          <button className="btn btn--secondary btn--sm" onClick={handleSignOut}>Sign out</button>
        </div>
      )}

      {token && (
        <>
          {/* Broadcast selector */}
          <div className="settings-field">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <label className="settings-field__label" style={{ margin: 0 }}>Scheduled stream</label>
              <button
                className="btn btn--secondary btn--sm"
                onClick={() => fetchBroadcasts(token)}
                disabled={loadingBroadcasts}
                title="Refresh scheduled streams list"
              >
                {loadingBroadcasts ? '…' : '↻ Refresh'}
              </button>
            </div>
            {loadingBroadcasts ? (
              <p className="broadcast-hint">Loading broadcasts…</p>
            ) : broadcasts.length === 0 ? (
              <p className="broadcast-hint">No upcoming scheduled streams found.</p>
            ) : (
              <select
                className="settings-field__input"
                value={selectedId}
                onChange={e => setSelectedId(e.target.value)}
              >
                {broadcasts.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.snippet?.title || b.id}
                    {b.snippet?.scheduledStartTime
                      ? ` — ${new Date(b.snippet.scheduledStartTime).toLocaleString()}`
                      : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Preview */}
          {selectedBroadcast && (
            <div className="broadcast-preview">
              {thumb && (
                <a
                  href={`https://www.youtube.com/watch?v=${selectedBroadcast.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <img className="yt-thumb" src={thumb} alt="Stream preview" />
                </a>
              )}
              <div className="broadcast-preview-meta">
                <span className="broadcast-preview-title">{selectedBroadcast.snippet?.title}</span>
                {scheduledStart && (
                  <span className="broadcast-preview-time">
                    Scheduled: {new Date(scheduledStart).toLocaleString()}
                  </span>
                )}
                <span className={`broadcast-preview-status broadcast-preview-status--${broadcastStatus}`}>
                  {broadcastStatus || 'unknown'}
                </span>
              </div>
            </div>
          )}

          {/* Go Live / End Stream */}
          {selectedBroadcast && (
            <div className="broadcast-actions">
              <button
                className="btn btn--primary"
                onClick={() => handleTransition('live')}
                disabled={ytBusy || isLive || isComplete}
                title={isComplete ? 'Stream has ended' : isLive ? 'Already live' : 'Go live'}
              >
                {ytBusy && !isLive ? 'Going live…' : 'Go Live'}
              </button>
              <button
                className="btn btn--danger"
                onClick={() => handleTransition('complete')}
                disabled={ytBusy || !isLive || isComplete}
                title={!isLive ? 'Stream is not live' : 'End the stream'}
              >
                {ytBusy && isLive ? 'Ending…' : 'End Stream'}
              </button>
            </div>
          )}

          {/* HTTP captions */}
          {selectedBroadcast && (
            <div className="broadcast-captions-section">
              <div className="broadcast-captions-status">
                HTTP captions:{' '}
                <strong className={httpCaptionsEnabled ? 'broadcast-captions-on' : 'broadcast-captions-off'}>
                  {httpCaptionsEnabled ? 'enabled' : 'disabled'}
                </strong>
              </div>
              {!httpCaptionsEnabled && (
                <>
                  <button
                    className="btn btn--secondary"
                    onClick={handleEnableHttpCaptions}
                    disabled={captionsBusy}
                  >
                    {captionsBusy ? 'Enabling…' : 'Enable HTTP Captions (30 s delay)'}
                  </button>
                  <p className="broadcast-hint">
                    Enables HTTP POST caption ingestion on this broadcast. YouTube uses a ~30-second
                    caption delay to align captions with stream latency — this is a YouTube requirement
                    and is handled automatically when you enable HTTP captions.
                  </p>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
