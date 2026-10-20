import { useState } from 'react';
import { useLang } from '../../contexts/LangContext';
import { usePolling } from '../../hooks/usePolling.js';
import { splitIngestUrl } from '../../lib/quickRestream.js';
import { useQuickApi } from './useQuickApi.js';
import s from './quick.module.css';

function CopyField({ label, value, t }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  }
  return (
    <div className={s.field}>
      <span>{label}</span>
      <div className={s.row}>
        <code className={`${s.input} ${s.mono} ${s.grow}`} data-testid={`ingest-${label}`}>{value}</code>
        <button type="button" className="btn btn--sm" onClick={copy}>{copied ? t('quick.copied') : t('quick.copy')}</button>
      </div>
    </div>
  );
}

/**
 * Where to send the audio or video stream: the main feed's ingest server and key, whether anything is arriving, and a
 * switch to turn stream input on. Reads `GET /ingestion/config` (polled), switches with `PATCH /ingestion/config`.
 * `onChange({ enabled, live, streamKey, available })` tells the page what it needs to know.
 */
export function IngestDirections({ onChange }) {
  const { t } = useLang();
  const { connected, call } = useQuickApi();
  const [video, setVideo] = useState(null);       // GET /ingestion/config .video
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState('');

  function publish(next, ok) {
    setVideo(next);
    setAvailable(ok);
    onChange?.({ enabled: !!next?.enabled, live: !!next?.live, streamKey: next?.streamKey || '', available: ok });
  }

  async function load() {
    try {
      const data = await call('/ingestion/config');
      publish(data?.video || null, !!data?.video);
    } catch (err) {
      // 404 = the relay stack is not mounted on this server; anything else keeps what is on screen.
      if (err.status === 404) publish(null, false);
    }
  }
  usePolling(load, 5000, { enabled: connected });

  async function enable() {
    setError('');
    try {
      await call('/ingestion/config', { method: 'PATCH', body: { video: { enabled: true } } });
      await load();
    } catch (err) { setError(err.message); }
  }

  const { server, key } = splitIngestUrl(video?.ingestUrl);
  return (
    <section className={s.card} aria-label={t('quick.ingest.title')}>
      <div className={s.cardHead}>
        <span className={s.cardTitle}>{t('quick.ingest.title')}</span>
        {video?.enabled && (
          <span className={s.conn}>
            <span className={`${s.dot} ${video.live ? s.dotOn : ''}`} />
            {video.live ? t('quick.ingest.live') : t('quick.ingest.waiting')}
          </span>
        )}
      </div>
      {!available && <p className={s.hint}>{t('quick.ingest.unavailable')}</p>}
      {available && video && !video.enabled && (
        <div className={s.row}>
          <p className={`${s.hint} ${s.grow}`}>{t('quick.ingest.disabled')}</p>
          <button type="button" className="btn btn--primary btn--sm" onClick={enable}>{t('quick.ingest.enable')}</button>
        </div>
      )}
      {available && video?.enabled && (
        <>
          <CopyField label={t('quick.ingest.server')} value={server} t={t} />
          <CopyField label={t('quick.ingest.key')} value={key} t={t} />
          <p className={s.hint}>{t('quick.ingest.hint')}</p>
        </>
      )}
      {error && <p className={s.error} role="alert">{error}</p>}
    </section>
  );
}
