import { useState, useEffect, useCallback } from 'react';
import { useSessionContext } from '../../contexts/SessionContext';
import { SetupCard, SetupItemRow } from './SetupCard.jsx';
import { SttServiceIcon } from './icons.jsx';
import { Dialog } from '../Dialog.jsx';
import { SttPanel } from '../panels/SttPanel.jsx';
import { setupToken } from '../../lib/setupToken.js';
import { useDeviceFeeds } from './useDeviceFeeds.js';

const PROVIDER_LABELS = {
  webspeech: 'Web Speech API (browser)',
  google: 'Google Cloud Speech-to-Text',
  whisper_http: 'Whisper (HTTP)',
  openai: 'OpenAI Whisper',
  auditor: 'Auditor (pulls the stream itself)'
};

/**
 * SttSection — embeds the real (session-scoped) server-side STT config panel,
 * wired to the actual `GET/PUT /stt/config` endpoints. Reuses the same
 * SttPanel component the setup wizard uses for its draft-state step; here it
 * is wired to live persisted config instead of a wizard draft. The panel now
 * opens in a Dialog off the card's summary row instead of always-inline.
 */
export function SttSection() {
  const session = useSessionContext();
  const connected = session?.connected;
  const backendUrl = session?.backendUrl;
  const getSessionToken = session?.getSessionToken;

  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState(false);
  const { feeds } = useDeviceFeeds({ connected, backendUrl, getSessionToken });

  const load = useCallback(async () => {
    if (!connected || !backendUrl) return;
    const token = setupToken(session);
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${backendUrl}/api/v1/stt/config`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setConfig(data.config || {});
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [connected, backendUrl, getSessionToken, session?.projectAccessToken]);

  useEffect(() => { load(); }, [load]);

  async function handleSave() {
    const token = setupToken(session);
    if (!token || !config) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const r = await fetch(`${backendUrl}/api/v1/stt/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(config),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SetupCard
      id="stt"
      icon={SttServiceIcon}
      color="purple"
      title="STT service"
      description="Server-side transcription (Google Cloud, Whisper HTTP, or OpenAI) from your RTMP/HLS/WHEP audio."
      status="ready"
    >
      {!connected ? (
        <p className="setup-card__empty">Connect to a project to configure server-side STT.</p>
      ) : loading || !config ? (
        <p className="setup-card__empty">Loading…</p>
      ) : (
        <SetupItemRow
          name={PROVIDER_LABELS[config.provider] || config.provider || 'Google Cloud Speech-to-Text'}
          meta={`Audio source: ${feeds?.find(f => f.id === config.feedId)?.name || config.audioSource || 'hls'} · Language: ${config.language || 'en-US'}`}
          onSettings={() => setOpen(true)}
        />
      )}

      {open && (
        <Dialog title="Speech-to-text service" onClose={() => setOpen(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <SttPanel feeds={feeds || []} config={config || {}} onChange={cfg => { setConfig(cfg); setSaved(false); }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
              {error && <span style={{ fontSize: 12, color: 'var(--color-error)' }}>{error}</span>}
              {saved && <span style={{ fontSize: 12, color: 'var(--color-success, #2e9e5b)' }}>Saved.</span>}
              <button className="btn btn--primary btn--sm" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </SetupCard>
  );
}
