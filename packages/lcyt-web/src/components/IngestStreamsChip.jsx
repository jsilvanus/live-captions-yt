import { useCallback, useEffect, useRef, useState } from 'react';
import { useSessionContext } from '../contexts/SessionContext';
import { useLang } from '../contexts/LangContext';
import styles from './IngestStreamsChip.module.css';

const POLL_MS = 10_000;

/** Fills `{name}` placeholders in a translated string. */
function fill(text, params) {
  return text.replace(/\{(\w+)\}/g, (whole, name) => (name in params ? String(params[name]) : whole));
}

function MediaState({ stream, t }) {
  return (
    <span className={styles.media}>
      <span className={stream.video ? '' : styles.missing}>{stream.video ? t('statusBar.ingest.video') : t('statusBar.ingest.noVideo')}</span>
      {' · '}
      <span className={stream.audio ? '' : styles.missing}>{stream.audio ? t('statusBar.ingest.audio') : t('statusBar.ingest.noAudio')}</span>
    </span>
  );
}

/**
 * Top-bar chip with the number of incoming streams (encoders pushing to MediaMTX) of the project; hovering,
 * focusing or clicking it lists their paths with video/audio state. The list also has a "Discover" button that
 * shows streams nobody owns yet and can bind one to the project as a named feed (a `/feeds` row, kind camera).
 * Hidden when the server has no ingest to report (relay off, no MediaMTX API, request failed).
 */
export function IngestStreamsChip() {
  const session = useSessionContext();
  const { t } = useLang();
  const backendUrl = (session.backendUrl || '').replace(/\/$/, '');
  const getToken = session.getSessionToken;
  const [state, setState] = useState(null);
  const [open, setOpen] = useState(false);
  const [found, setFound] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const wrapRef = useRef(null);

  const call = useCallback(async (path, init = {}) => {
    const token = getToken?.();
    if (!backendUrl || !token) throw new Error('not connected');
    const res = await fetch(`${backendUrl}/api/v1${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    return res.json();
  }, [backendUrl, getToken]);

  const refresh = useCallback(async () => {
    try {
      const body = await call('/ingestion/streams');
      setState(body?.available ? body.streams : null);
    } catch {
      setState(null);
    }
  }, [call]);

  useEffect(() => {
    if (!session.connected) { setState(null); return undefined; }
    refresh();
    const id = setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
    return () => clearInterval(id);
  }, [session.connected, refresh]);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    function onDown(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [open]);

  async function discover() {
    setBusy(true); setError('');
    try {
      const body = await call('/ingestion/streams/unclaimed');
      if (!body.available) setError(t('statusBar.ingest.unavailable'));
      setFound(body.streams ?? []);
    } catch (err) {
      setError(err.status === 403 ? t('statusBar.ingest.forbidden') : t('statusBar.ingest.discoverFailed'));
    } finally { setBusy(false); }
  }

  async function attach(stream) {
    setBusy(true); setError('');
    try {
      await call('/feeds', {
        method: 'POST',
        body: JSON.stringify({ name: stream.key, feedKey: stream.key, transport: 'rtmp', kind: 'camera' }),
      });
      setFound(list => (list ?? []).filter(s => s.path !== stream.path));
      refresh();
    } catch {
      setError(t('statusBar.ingest.attachFailed'));
    } finally { setBusy(false); }
  }

  if (!session.connected || state === null) return null;

  const count = state.length;
  return (
    <div
      className={styles.wrap}
      ref={wrapRef}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className={`${styles.chip} ${count > 0 ? styles.live : ''}`}
        aria-expanded={open}
        aria-label={fill(t('statusBar.ingest.label'), { count })}
        onClick={() => setOpen(o => !o)}
        onFocus={() => setOpen(true)}
      >
        ⇄ {count}
      </button>
      {open && (
        <div className={styles.panel} role="region" aria-label={t('statusBar.ingest.title')}>
          <p className={styles.heading}>{t('statusBar.ingest.title')}</p>
          {count === 0 ? (
            <p className={styles.empty}>{t('statusBar.ingest.none')}</p>
          ) : (
            <ul className={styles.list}>
              {state.map(s => (
                <li key={s.path} className={styles.row}>
                  <span className={styles.path}>{s.label ? `${s.label} (${s.path})` : s.path}{s.kind === 'dsk' ? ' · DSK' : ''}</span>
                  <MediaState stream={s} t={t} />
                </li>
              ))}
            </ul>
          )}
          <div className={styles.divider}>
            <button type="button" className={styles.btn} onClick={discover} disabled={busy}>{t('statusBar.ingest.discover')}</button>
            {found && (found.length === 0 ? (
              <p className={styles.empty}>{t('statusBar.ingest.discoverNone')}</p>
            ) : (
              <>
                <p className={styles.heading}>{t('statusBar.ingest.unclaimed')}</p>
                <ul className={styles.list}>
                  {found.map(s => (
                    <li key={s.path} className={styles.row}>
                      <span className={styles.path}>{s.path}</span>
                      <MediaState stream={s} t={t} />
                      {s.attachable && (
                        <button type="button" className={styles.btn} disabled={busy} onClick={() => attach(s)}>{t('statusBar.ingest.attach')}</button>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            ))}
            {error && <p className={styles.error} role="alert">{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
