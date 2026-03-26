import { useState } from 'react';
import { RelaySlotRow } from './RelaySlotRow.jsx';
import { useLang } from '../../contexts/LangContext.jsx';
import { MAX_RELAY_SLOTS } from '../../lib/relayConfig.js';

/**
 * RelayPanel — RTMP relay slot list.
 * Data shape: { slot, targetType, youtubeKey, genericUrl, genericName, captionMode, scale, fps, videoBitrate, audioBitrate }[]
 *
 * Props:
 *   relayList: object[]
 *   onRelayListChange: (relayList) => void
 *   relayStatus?: { relays: { slot, targetUrl, targetName }[], runningSlots: number[] } | null
 *   relayError?: string
 *   connected?: boolean
 *   backendUrl?: string
 *   apiKey?: string
 */
export function RelayPanel({ relayList = [], onRelayListChange, relayStatus = null, relayError = '', connected = false, backendUrl = '', apiKey = '' }) {
  const { t } = useLang();
  const runningSlots = relayStatus?.runningSlots ?? [];

  function addRelay() {
    const usedSlots = relayList.map(r => r.slot);
    for (let s = 1; s <= MAX_RELAY_SLOTS; s++) {
      if (!usedSlots.includes(s)) {
        onRelayListChange([...relayList, { slot: s, targetType: 'youtube', youtubeKey: '', genericUrl: '', genericName: '', captionMode: 'http', scale: '', fps: null, videoBitrate: '', audioBitrate: '' }]);
        return;
      }
    }
  }

  function updateItem(slot, updated) {
    onRelayListChange(relayList.map(r => r.slot === slot ? { ...r, ...updated } : r));
  }

  function removeItem(slot) {
    onRelayListChange(relayList.filter(r => r.slot !== slot));
  }

  return (
    <>
      {!connected && (
        <div className="settings-field">
          <span className="settings-field__hint" style={{ color: 'var(--color-text-dim)' }}>
            {t('settings.relay.notConnected')}
          </span>
        </div>
      )}

      <div className="settings-field">
        <span className="settings-field__hint">{t('settings.relay.fanOutHint')}</span>
      </div>

      <div className="settings-field">
        <label className="settings-field__label">{t('settings.relay.relayTargets')}</label>
        {relayList.length === 0 && (
          <span className="settings-field__hint">{t('settings.relay.noRelays')}</span>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {relayList.map(entry => (
            <RelaySlotRow
              key={entry.slot}
              entry={entry}
              onChange={updated => updateItem(entry.slot, updated)}
              onRemove={() => removeItem(entry.slot)}
              runningSlots={runningSlots}
            />
          ))}
        </div>
        {relayList.length < MAX_RELAY_SLOTS && (
          <button type="button" className="btn btn--secondary btn--sm" onClick={addRelay} style={{ marginTop: 8 }}>
            + {t('settings.relay.addRelay')}
          </button>
        )}
      </div>

      {relayStatus && relayStatus.relays?.length > 0 && (
        <div className="settings-field">
          <label className="settings-field__label">{t('settings.relay.status')}</label>
          {relayStatus.relays.map(r => (
            <div key={r.slot} style={{ fontSize: '0.85em', marginBottom: '0.25rem' }}>
              {runningSlots.includes(r.slot) ? '🔴 ' + t('settings.relay.live') : '⚫ ' + t('settings.relay.inactive')}
              {' — '}{r.targetUrl}{r.targetName ? `/${r.targetName}` : ''}
            </div>
          ))}
        </div>
      )}

      {relayError && <div className="settings-error">{relayError}</div>}

      {backendUrl && apiKey && (
        <DskRtmpUrlField backendUrl={backendUrl} apiKey={apiKey} />
      )}
    </>
  );
}

function DskRtmpUrlField({ backendUrl, apiKey }) {
  const { t } = useLang();
  const [copied, setCopied] = useState(false);
  const url = (() => {
    try {
      const host = new URL(backendUrl).hostname;
      return `rtmp://${host}/dsk/${encodeURIComponent(apiKey)}`;
    } catch { return null; }
  })();
  if (!url) return null;
  const copy = () => {
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => { setCopied(false); });
  };
  return (
    <div className="settings-field">
      <label className="settings-field__label">{t('settings.relay.dskRtmpIngestUrl')}</label>
      <span className="settings-field__hint">{t('settings.relay.dskRtmpHint')}</span>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
        <input
          className="settings-field__input"
          type="text"
          readOnly
          value={url}
          style={{ fontFamily: 'monospace', fontSize: 12, flex: 1 }}
        />
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={copy}
          title="Copy URL"
        >{copied ? '✓' : '⎘'}</button>
      </div>
    </div>
  );
}
