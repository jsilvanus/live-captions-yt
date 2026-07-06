import { useState, useEffect, useCallback } from 'react';
import { useSessionContext } from '../../contexts/SessionContext';
import { SetupCard, SetupItemRow } from './SetupCard.jsx';
import { IngestionIcon } from './icons.jsx';
import { Dialog } from '../Dialog.jsx';

const LIVE_DOT    = 'var(--color-success)';
const OFFLINE_DOT = 'var(--color-text-muted)';
const UNKNOWN_DOT  = 'var(--color-border)';

function statusDotFor(live) {
  if (live === true) return LIVE_DOT;
  if (live === false) return OFFLINE_DOT;
  return UNKNOWN_DOT; // null/undefined — unknown, e.g. DSK slot before its status is wired server-side
}

/**
 * IngestionSection — "one Video, one DSK" RTMP ingest, per the mockup's
 * `IngestionCard.dc.html`. Wired against `GET/PATCH /ingestion/config`
 * as specced in `docs/plans/plan_selfservice_config_backend.md` §2/§2a —
 * that contract isn't implemented server-side yet, so this fails soft
 * (shows the empty state) against a real backend until it is.
 *
 * Also shows any browser-type camera (`controlType` webcam/mobile — real
 * data via the existing `GET /production/cameras`) as a faded "camera"
 * badge row, matching the mockup's `ingestionCamPhantoms` cross-reference —
 * those cameras stream in over RTMP too, just on their own per-camera path.
 */
export function IngestionSection() {
  const session = useSessionContext();
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(false);
  const [camPhantoms, setCamPhantoms] = useState([]);
  const [editingSlot, setEditingSlot] = useState(null); // 'video' | 'dsk' | null

  const authedFetch = useCallback((path, opts = {}) => {
    const token = session.getSessionToken?.();
    return fetch(`${session.backendUrl}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
    });
  }, [session]);

  const load = useCallback(async () => {
    if (!session?.connected) return;
    setLoading(true);
    try {
      const r = await authedFetch('/ingestion/config');
      if (r.ok) setConfig((await r.json()) || null);
    } catch { /* backend not implemented yet — leave config null */ }
    finally { setLoading(false); }
  }, [session?.connected, authedFetch]);

  const loadCameraPhantoms = useCallback(async () => {
    if (!session?.connected) return;
    try {
      const r = await authedFetch('/production/cameras');
      if (!r.ok) return;
      const cams = await r.json();
      setCamPhantoms((cams || []).filter(c => c.controlType === 'webcam' || c.controlType === 'mobile'));
    } catch { /* ignore */ }
  }, [session?.connected, authedFetch]);

  useEffect(() => { load(); loadCameraPhantoms(); }, [load, loadCameraPhantoms]);

  async function toggleSlot(slot, enabled) {
    setConfig(c => c ? { ...c, [slot]: { ...c[slot], enabled } } : c);
    try {
      await authedFetch('/ingestion/config', { method: 'PATCH', body: JSON.stringify({ [slot]: { enabled } }) });
      load();
    } catch { /* optimistic update stands; next load() reconciles when backend exists */ }
  }

  const video = config?.video;
  const dsk = config?.dsk;

  return (
    <SetupCard
      id="ingestion"
      icon={IngestionIcon}
      color="cyan"
      title="Ingestion"
      description="RTMP ingest endpoint — one Video, one DSK."
      status="ready"
    >
      {!session?.connected ? (
        <p className="setup-card__empty">Connect to a project to configure ingestion.</p>
      ) : loading ? (
        <p className="setup-card__empty">Loading…</p>
      ) : !config ? (
        <p className="setup-card__empty">Not configured — backend support for this card is pending (see plan_selfservice_config_backend.md).</p>
      ) : (
        <>
          <SetupItemRow
            name="Video"
            meta={video?.enabled ? (video.ingestUrl || 'Enabled') : 'Disabled'}
            statusDot={statusDotFor(video?.live)}
            toggleOn={!!video?.enabled}
            onToggle={() => toggleSlot('video', !video?.enabled)}
            onSettings={() => setEditingSlot('video')}
          />
          <SetupItemRow
            name="DSK"
            meta={dsk?.enabled ? (dsk.ingestUrl || 'Enabled') : 'Disabled'}
            statusDot={statusDotFor(dsk?.live)}
            toggleOn={!!dsk?.enabled}
            onToggle={() => toggleSlot('dsk', !dsk?.enabled)}
            onSettings={() => setEditingSlot('dsk')}
          />
        </>
      )}

      {camPhantoms.map(cam => (
        <SetupItemRow
          key={cam.id}
          name={cam.name}
          meta="Browser camera — streams in via its own RTMP path"
          badge="camera"
          faded
        />
      ))}

      {editingSlot && (
        <Dialog title={`${editingSlot === 'video' ? 'Video' : 'DSK'} ingest`} onClose={() => setEditingSlot(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="settings-field">
              <label className="settings-field__label">Ingest URL</label>
              <input className="settings-field__input" readOnly
                value={(editingSlot === 'video' ? video?.ingestUrl : dsk?.ingestUrl) || ''}
                onClick={e => e.target.select()} style={{ fontFamily: 'monospace', fontSize: 12 }} />
            </div>
            {editingSlot === 'video' && video?.rotatable && (
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: 0 }}>
                Stream key rotation isn't wired up yet — see <code>plan_selfservice_config_backend.md</code> §2's <code>POST /ingestion/config/rotate</code>.
              </p>
            )}
          </div>
        </Dialog>
      )}
    </SetupCard>
  );
}
