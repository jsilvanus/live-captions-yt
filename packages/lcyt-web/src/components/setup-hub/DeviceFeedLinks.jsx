import { useState } from 'react';
import { useSetupT } from '../../lib/useSetupT.js';

const LIVE_DOT = 'var(--color-success)';
const IDLE_DOT = 'var(--color-text-muted)';

const ROW_STYLE = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, fontSize: 12 };
const CHIP_STYLE = {
  display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 4px 2px 8px', borderRadius: 999,
  border: '1px solid var(--color-border)', color: 'var(--color-text)',
};
const MUTED = { color: 'var(--color-text-muted)' };

/**
 * The feeds linked to one device (a row of the Devices card), with "Link feed" and "Unlink".
 * `linked` and `candidates` come from lib/deviceFeeds.js; `onLink(feedId)` and `onUnlink(feedId)` resolve to
 * whether the server accepted the change. Several feeds can link to one device.
 */
export function DeviceFeedLinks({ linked, candidates, onLink, onUnlink }) {
  const t = useSetupT();
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  async function link(feedId) {
    if (!feedId) return;
    setBusy(true);
    const ok = await onLink(feedId);
    setBusy(false);
    if (ok) setPicking(false);
  }

  async function unlink(feedId) {
    setBusy(true);
    await onUnlink(feedId);
    setBusy(false);
  }

  return (
    <div style={ROW_STYLE} data-testid="device-feed-links">
      {linked.length === 0 && <span style={MUTED}>{t('devices.noLinkedFeed')}</span>}
      {linked.map(feed => (
        <span key={feed.id} style={CHIP_STYLE} data-testid="linked-feed">
          <span
            aria-label={feed.live === true ? t('devices.live') : t('devices.notLive')}
            title={feed.live === true ? t('devices.live') : t('devices.notLive')}
            style={{ width: 7, height: 7, borderRadius: '50%', background: feed.live === true ? LIVE_DOT : IDLE_DOT, flexShrink: 0 }}
          />
          <span>{feed.name}</span>
          <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => unlink(feed.id)}>
            {t('devices.unlink')}
          </button>
        </span>
      ))}
      {!picking && (
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => setPicking(true)}>
          {t('devices.linkFeed')}
        </button>
      )}
      {picking && (
        candidates.length === 0 ? (
          <span style={MUTED}>
            {t('devices.noFeedsToLink')}{' '}
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPicking(false)}>{t('devices.cancel')}</button>
          </span>
        ) : (
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <select
              aria-label={t('devices.chooseFeed')}
              className="settings-field__input"
              style={{ fontSize: 12, padding: '2px 6px', width: 'auto' }}
              disabled={busy}
              defaultValue=""
              onChange={e => link(e.target.value)}
            >
              <option value="" disabled>{t('devices.chooseFeed')}</option>
              {candidates.map(feed => <option key={feed.id} value={feed.id}>{feed.name}</option>)}
            </select>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPicking(false)}>{t('devices.cancel')}</button>
          </span>
        )
      )}
    </div>
  );
}
