/**
 * EmbedRtmpPage — RTMP relay settings widget for iframe embedding.
 *
 * Rendered when lcyt-web is opened at /embed/rtmp
 *
 * Shows the RTMP relay configuration panel:
 *   - RTMP ingest address (where to point the streaming software)
 *   - Relay slot management (YouTube / generic RTMP targets)
 *   - Relay active toggle + running status
 *
 * Settings are persisted to localStorage by relayConfig.js, so other embed
 * widgets on the same origin inherit them.
 *
 * URL params:
 *   ?server=<backendUrl>   Pre-populate backend URL (saved to localStorage)
 *   ?apikey=<key>          Pre-populate API key (saved to localStorage)
 *   ?theme=dark|light      UI theme (default: dark)
 *
 * Host page usage:
 *   <iframe
 *     src="https://your-lcyt-host/embed/rtmp?server=https://api.example.com&apikey=KEY&theme=dark"
 *     style="width:100%; height:500px; border:none;">
 *   </iframe>
 */

import { useEffect, useState } from 'react';
import { AppProviders } from '../contexts/AppProviders';
import { useSessionContext } from '../contexts/SessionContext';
import { useLang } from '../contexts/LangContext';
import { useToastContext } from '../contexts/ToastContext';
import {
  setSlotTargetType,
  setSlotYoutubeKey, setSlotGenericUrl, setSlotGenericName,
  setSlotCaptionMode, setSlotScale, setSlotFps, setSlotVideoBitrate, setSlotAudioBitrate,
  clearSlot,
  MAX_RELAY_SLOTS,
  buildInitialRelayList,
} from '../lib/relayConfig.js';

// ─── RelayRow (mirrors SettingsModal's RelayRow) ──────────────────────────────

function RelayRow({ entry, onChange, onRemove, t }) {
  const [showAdvanced, setShowAdvanced] = useState(
    Boolean(entry.scale || entry.fps != null || entry.videoBitrate || entry.audioBitrate || entry.captionMode === 'cea708')
  );
  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 4, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <select
          className="settings-field__input"
          value={entry.targetType}
          onChange={e => onChange({ ...entry, targetType: e.target.value })}
          style={{ width: 'auto' }}
        >
          <option value="youtube">YouTube</option>
          <option value="generic">{t('settings.relay.generic')}</option>
        </select>
        {entry.targetType === 'youtube' ? (
          <input
            className="settings-field__input"
            type="password"
            placeholder="xxxx-xxxx-xxxx-xxxx-xxxx"
            autoComplete="off"
            value={entry.youtubeKey || ''}
            onChange={e => onChange({ ...entry, youtubeKey: e.target.value })}
            style={{ flex: 1 }}
          />
        ) : (
          <input
            className="settings-field__input"
            type="text"
            placeholder={t('settings.relay.rtmpFullPathPlaceholder')}
            autoComplete="off"
            value={entry.genericUrl || ''}
            onChange={e => onChange({ ...entry, genericUrl: e.target.value })}
            style={{ flex: 1 }}
          />
        )}
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={() => setShowAdvanced(v => !v)}
          title={t('settings.relay.slotAdvanced')}
          style={{ flexShrink: 0, fontSize: '0.75em' }}
        >⚙</button>
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={onRemove}
          title={t('settings.relay.removeRelay')}
          style={{ flexShrink: 0 }}
        >✕</button>
      </div>
      {entry.targetType === 'youtube' && (entry.youtubeKey || '').trim() && (
        <span className="settings-field__hint">
          → rtmp://a.rtmp.youtube.com/live2/{(entry.youtubeKey || '').trim()}
        </span>
      )}
      {showAdvanced && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 10px', borderTop: '1px solid var(--color-border)', paddingTop: 6, marginTop: 2 }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <label className="settings-field__label" style={{ fontSize: '0.8em', marginBottom: 2 }}>{t('settings.relay.slotCaptionMode')}</label>
            <select
              className="settings-field__input"
              value={entry.captionMode || 'http'}
              onChange={e => onChange({ ...entry, captionMode: e.target.value })}
              style={{ width: '100%' }}
            >
              <option value="http">{t('settings.relay.slotCaptionModeHttp')}</option>
              <option value="cea708">{t('settings.relay.slotCaptionModeCea708')}</option>
            </select>
          </div>
          <div>
            <label className="settings-field__label" style={{ fontSize: '0.8em', marginBottom: 2 }}>{t('settings.relay.slotScale')}</label>
            <input className="settings-field__input" type="text" placeholder={t('settings.relay.slotScalePlaceholder')}
              value={entry.scale || ''} onChange={e => onChange({ ...entry, scale: e.target.value })} />
          </div>
          <div>
            <label className="settings-field__label" style={{ fontSize: '0.8em', marginBottom: 2 }}>{t('settings.relay.slotFps')}</label>
            <input className="settings-field__input" type="number" min="1" max="120" placeholder={t('settings.relay.slotFpsPlaceholder')}
              value={entry.fps ?? ''} onChange={e => onChange({ ...entry, fps: e.target.value ? parseInt(e.target.value, 10) : null })} />
          </div>
          <div>
            <label className="settings-field__label" style={{ fontSize: '0.8em', marginBottom: 2 }}>{t('settings.relay.slotVideoBitrate')}</label>
            <input className="settings-field__input" type="text" placeholder={t('settings.relay.slotVideoBitratePlaceholder')}
              value={entry.videoBitrate || ''} onChange={e => onChange({ ...entry, videoBitrate: e.target.value })} />
          </div>
          <div>
            <label className="settings-field__label" style={{ fontSize: '0.8em', marginBottom: 2 }}>{t('settings.relay.slotAudioBitrate')}</label>
            <input className="settings-field__input" type="text" placeholder={t('settings.relay.slotAudioBitratePlaceholder')}
              value={entry.audioBitrate || ''} onChange={e => onChange({ ...entry, audioBitrate: e.target.value })} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── IngestAddress ────────────────────────────────────────────────────────────

function IngestAddress({ backendUrl, apiKey }) {
  const [rtmpIngest, setRtmpIngest] = useState(null);

  useEffect(() => {
    if (!backendUrl) return;
    fetch(`${backendUrl}/health`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.rtmpIngest) setRtmpIngest(data.rtmpIngest); })
      .catch(() => {});
  }, [backendUrl]);

  if (!rtmpIngest) return null;

  const ingestUrl = `rtmp://${rtmpIngest.host}/${rtmpIngest.app}/${apiKey || '<api-key>'}`;

  return (
    <div className="settings-field" style={{ background: 'var(--color-surface-elevated, #252525)', borderRadius: 6, padding: '10px 12px' }}>
      <label className="settings-field__label" style={{ marginBottom: 4 }}>RTMP ingest address</label>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          className="settings-field__input"
          readOnly
          value={ingestUrl}
          style={{ fontFamily: 'monospace', fontSize: '0.85em', flex: 1 }}
          onClick={e => e.target.select()}
        />
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={() => navigator.clipboard?.writeText(ingestUrl)}
          title="Copy"
        >Copy</button>
      </div>
      <span className="settings-field__hint">
        Point your streaming software here. Use your API key as the stream name.
      </span>
    </div>
  );
}

// ─── RelayPanel ───────────────────────────────────────────────────────────────

function RelayPanel({ backendUrl, apiKey }) {
  const session = useSessionContext();
  const { t } = useLang();
  const { showToast } = useToastContext();

  const [relayList, setRelayList] = useState(buildInitialRelayList);
  const [relayStatus, setRelayStatus] = useState(null);
  const [relayActive, setRelayActiveState] = useState(false);
  const [relayError, setRelayError] = useState('');

  function refreshStatus() {
    if (!session.connected) { setRelayStatus(null); return; }
    session.getRelayStatus()
      .then(s => { setRelayStatus(s); setRelayActiveState(!!s.active); })
      .catch(() => setRelayStatus(null));
  }

  useEffect(() => { refreshStatus(); }, [session.connected]); // eslint-disable-line react-hooks/exhaustive-deps

  function addRelay() {
    const usedSlots = relayList.map(r => r.slot);
    for (let s = 1; s <= MAX_RELAY_SLOTS; s++) {
      if (!usedSlots.includes(s)) {
        setRelayList(prev => [...prev, { slot: s, targetType: 'youtube', youtubeKey: '', genericUrl: '', genericName: '', captionMode: 'http', scale: '', fps: null, videoBitrate: '', audioBitrate: '' }]);
        return;
      }
    }
  }

  function updateRelayItem(slot, updated) {
    if ('targetType'   in updated) setSlotTargetType(slot, updated.targetType);
    if ('youtubeKey'   in updated) setSlotYoutubeKey(slot, updated.youtubeKey);
    if ('genericUrl'   in updated) setSlotGenericUrl(slot, updated.genericUrl);
    if ('genericName'  in updated) setSlotGenericName(slot, updated.genericName);
    if ('captionMode'  in updated) setSlotCaptionMode(slot, updated.captionMode);
    if ('scale'        in updated) setSlotScale(slot, updated.scale ?? '');
    if ('fps'          in updated) setSlotFps(slot, updated.fps ?? null);
    if ('videoBitrate' in updated) setSlotVideoBitrate(slot, updated.videoBitrate ?? '');
    if ('audioBitrate' in updated) setSlotAudioBitrate(slot, updated.audioBitrate ?? '');
    setRelayList(prev => prev.map(r => r.slot === slot ? { ...r, ...updated } : r));
  }

  function removeRelay(slot) {
    clearSlot(slot);
    setRelayList(prev => prev.filter(r => r.slot !== slot));
  }

  async function handleRelayActive(active) {
    try {
      setRelayError('');
      await session.setRelayActive(active);
      setRelayActiveState(active);
      refreshStatus();
    } catch (err) {
      const msg = err.message || 'Failed to toggle relay';
      setRelayError(msg);
      showToast(msg, 'error');
    }
  }

  const runningSlots = relayStatus?.runningSlots ?? [];

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto', flex: 1 }}>

      {/* RTMP ingest address */}
      <IngestAddress backendUrl={backendUrl} apiKey={apiKey} />

      {/* Connection status */}
      {!session.connected && (
        <div className="settings-field">
          <span className="settings-field__hint" style={{ color: 'var(--color-text-dim)' }}>
            {t('settings.relay.notConnected')}
          </span>
        </div>
      )}

      {/* Fan-out hint */}
      <div className="settings-field">
        <span className="settings-field__hint">{t('settings.relay.fanOutHint')}</span>
      </div>

      {/* Relay targets */}
      <div className="settings-field">
        <label className="settings-field__label">{t('settings.relay.relayTargets')}</label>
        {relayList.length === 0 && (
          <span className="settings-field__hint">{t('settings.relay.noRelays')}</span>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {relayList.map(entry => (
            <RelayRow
              key={entry.slot}
              entry={entry}
              onChange={updated => updateRelayItem(entry.slot, updated)}
              onRemove={() => removeRelay(entry.slot)}
              t={t}
            />
          ))}
        </div>
        {relayList.length < MAX_RELAY_SLOTS && (
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={addRelay}
            style={{ marginTop: 8 }}
          >
            + {t('settings.relay.addRelay')}
          </button>
        )}
      </div>

      {/* Relay active toggle — only when connected */}
      {session.connected && (
        <div className="settings-field">
          <label className="settings-field__label">{t('settings.relay.status')}</label>
          <label className="settings-checkbox">
            <input
              type="checkbox"
              checked={relayActive}
              onChange={e => handleRelayActive(e.target.checked)}
            />
            {relayActive ? t('settings.relay.live') : t('settings.relay.inactive')}
          </label>
        </div>
      )}

      {/* Running slot status */}
      {relayStatus && relayStatus.relays?.length > 0 && (
        <div className="settings-field">
          {relayStatus.relays.map(r => (
            <div key={r.slot} style={{ fontSize: '0.85em', marginBottom: '0.25rem' }}>
              {runningSlots.includes(r.slot) ? '🔴 ' + t('settings.relay.live') : '⚫ ' + t('settings.relay.inactive')}
              {' — '}{r.targetUrl}{r.targetName ? `/${r.targetName}` : ''}
            </div>
          ))}
        </div>
      )}

      {relayError && <div className="settings-error">{relayError}</div>}
    </div>
  );
}

// ─── Page root ────────────────────────────────────────────────────────────────

export function EmbedRtmpPage() {
  const params     = new URLSearchParams(window.location.search);
  const serverUrl  = params.get('server')  || '';
  const apiKey     = params.get('apikey')  || '';
  const theme      = params.get('theme')   || 'dark';

  const initConfig = (serverUrl && apiKey)
    ? { backendUrl: serverUrl, apiKey }
    : undefined;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, []);

  return (
    <AppProviders initConfig={initConfig} autoConnect={!!(serverUrl && apiKey)}>
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--color-bg, #111)' }}>
        <div style={headerStyle}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Stream</span>
        </div>
        <RelayPanel backendUrl={serverUrl} apiKey={apiKey} />
      </div>
    </AppProviders>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const headerStyle = {
  padding:      '10px 16px',
  borderBottom: '1px solid var(--color-border, #333)',
  background:   'var(--color-surface, #1e1e1e)',
  flexShrink:   0,
  color:        'var(--color-text, #eee)',
};
