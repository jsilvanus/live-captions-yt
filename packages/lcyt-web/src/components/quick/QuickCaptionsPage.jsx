import { useCallback, useEffect, useState } from 'react';
import { useSessionContext } from '../../contexts/SessionContext';
import { useAudioContext } from '../../contexts/AudioContext';
import { useCaptionContext } from '../../contexts/CaptionContext';
import { useSentLogContext } from '../../contexts/SentLogContext';
import { useLang } from '../../contexts/LangContext';
import { usePolling } from '../../hooks/usePolling.js';
import { useSourceLanguages } from '../../hooks/useSourceLanguages.js';
import {
  COMMON_LANGUAGES, getSttEngine, getSttLang, setSttEngine, setSttLang, subscribeSttConfig,
} from '../../lib/sttConfig.js';
import { getTargets, setTargets } from '../../lib/targetConfig.js';
import {
  parseCaptionKey, maskKey, findYoutubeTarget, withYoutubeKey, withoutYoutubeTarget, newTargetId,
} from '../../lib/quickTargets.js';
import { IngestDirections } from './IngestDirections.jsx';
import { QuickShell } from './QuickShell.jsx';
import { useQuickApi } from './useQuickApi.js';
import s from './quick.module.css';

/** A server target row in the shape of the browser's own target list (what `session.updateTargets` takes). */
function toLocalShape(t) {
  return {
    id: t.id,
    enabled: t.enabled !== false && t.enabled !== 0,
    type: t.type,
    streamKey: t.streamKey,
    url: t.url,
    viewerKey: t.viewerKey,
    headers: t.headers ? JSON.stringify(t.headers) : '',
  };
}

/** Live transcripts of the server speech-to-text (auditor), newest first. Open only while `enabled`. */
function useServerTranscripts({ enabled, backendUrl, getToken }) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    if (!enabled || !backendUrl) return undefined;
    const token = getToken?.();
    const es = new EventSource(`${backendUrl}/api/v1/stt/events${token ? `?token=${encodeURIComponent(token)}` : ''}`);
    es.addEventListener('transcript', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data?.text) setItems(prev => [{ text: data.text, at: data.timestamp || Date.now() }, ...prev].slice(0, 30));
      } catch { /* ignore a malformed event */ }
    });
    return () => es.close();
  }, [enabled, backendUrl, getToken]);
  return items;
}

/**
 * Quick workflow "Send captions to YouTube": the YouTube caption key, the speech source (browser microphone or the
 * auditor service listening to the user's stream), the language, then Start/Stop, what was sent and a typed-caption box.
 */
export function QuickCaptionsPage() {
  const { t } = useLang();
  const session = useSessionContext();
  const { connected, call } = useQuickApi();
  const audio = useAudioContext();
  const { send, updateTargets } = useCaptionContext();
  const sentLog = useSentLogContext();
  const { sourceLanguages } = useSourceLanguages();

  // ── YouTube caption key ──────────────────────────────────────────────────────
  const [serverTargets, setServerTargets] = useState(null);
  const [localTargets, setLocalTargets] = useState(getTargets);
  const [editingKey, setEditingKey] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [keyError, setKeyError] = useState('');
  const savedKey = findYoutubeTarget(localTargets)?.streamKey || findYoutubeTarget(serverTargets)?.streamKey || '';

  const loadTargets = useCallback(async () => {
    if (!connected) return;
    try { setServerTargets((await call('/targets'))?.targets || []); } catch { setServerTargets([]); }
  }, [connected, call]);
  useEffect(() => { loadTargets(); }, [loadTargets]);

  /** Tell the running session about the targets it should use now: the browser's own list when it has one, else the saved ones. */
  async function applyToSession(serverList) {
    const local = getTargets();
    const list = (local.length ? local : (serverList || []).map(toLocalShape)).filter(x => x.enabled);
    try { await updateTargets?.(list); } catch { /* the next connect picks the targets up */ }
  }

  async function saveKey() {
    const key = parseCaptionKey(keyDraft);
    if (!key) { setKeyError(t('quick.captions.key.invalid')); return; }
    setKeyError('');
    let serverList = serverTargets || [];
    let serverOk = true;
    try {
      const existing = findYoutubeTarget(serverList);
      if (existing) await call(`/targets/${encodeURIComponent(existing.id)}`, { method: 'PUT', body: { enabled: true, streamKey: key } });
      else await call('/targets', { method: 'POST', body: { type: 'youtube', streamKey: key, enabled: true } });
      serverList = (await call('/targets'))?.targets || [];
      setServerTargets(serverList);
    } catch { serverOk = false; }
    // The browser's own list, when it is in use, overrides the saved targets at connect: keep it in step.
    // When saving to the server failed (no setup rights), the key still has to work, so it goes there.
    const local = getTargets();
    if (local.length || !serverOk) {
      const next = withYoutubeKey(local, key, newTargetId);
      setTargets(next);
      setLocalTargets(next);
    }
    await applyToSession(serverList);
    setEditingKey(false);
    setKeyDraft('');
  }

  async function removeKey() {
    let serverList = serverTargets || [];
    const existing = findYoutubeTarget(serverList);
    if (existing) {
      try { await call(`/targets/${encodeURIComponent(existing.id)}`, { method: 'DELETE' }); serverList = serverList.filter(x => x !== existing); setServerTargets(serverList); } catch { /* keep it */ }
    }
    const next = withoutYoutubeTarget(getTargets());
    setTargets(next);
    setLocalTargets(next);
    await applyToSession(serverList);
  }

  // ── Speech source and language ───────────────────────────────────────────────
  const [stt, setStt] = useState(() => ({ engine: getSttEngine(), lang: getSttLang() }));
  useEffect(() => subscribeSttConfig(() => setStt({ engine: getSttEngine(), lang: getSttLang() })), []);
  const engine = stt.engine === 'server' ? 'auditor' : 'browser';
  const [setupError, setSetupError] = useState('');
  const [ingest, setIngest] = useState({ enabled: false, live: false, streamKey: '', available: true });
  const [serverRunning, setServerRunning] = useState(false);
  const listening = engine === 'auditor' ? serverRunning : audio.listening;

  async function chooseEngine(next) {
    if (listening || next === engine) return;
    setSetupError('');
    if (next === 'auditor') {
      setSttEngine('server');
      try { await call('/stt/config', { method: 'PUT', body: { provider: 'auditor', language: stt.lang } }); }
      catch { setSetupError(t('quick.captions.engine.saveFailed')); }
    } else {
      setSttEngine('webkit');
    }
  }

  async function chooseLanguage(code) {
    setSttLang(code);
    if (engine !== 'auditor') return;
    try { await call('/stt/config', { method: 'PUT', body: { language: code } }); }
    catch { setSetupError(t('quick.captions.engine.saveFailed')); }
  }

  const langs = sourceLanguages.length > 0
    ? sourceLanguages.map(l => ({ code: l.lang, label: l.label || l.lang }))
    : COMMON_LANGUAGES;
  const langOptions = langs.some(l => l.code === stt.lang) ? langs : [{ code: stt.lang, label: stt.lang }, ...langs];

  usePolling(async () => {
    const status = await session.getSttStatus();
    setServerRunning(!!status?.running && status?.provider === 'auditor');
  }, 4000, { enabled: connected && engine === 'auditor' });

  const heard = useServerTranscripts({
    enabled: connected && engine === 'auditor' && serverRunning,
    backendUrl: session?.backendUrl,
    getToken: session?.getSessionToken,
  });

  // ── Start / stop ─────────────────────────────────────────────────────────────
  const [busy, setBusy] = useState(false);
  const [runError, setRunError] = useState('');

  async function toggle() {
    setRunError('');
    if (!listening && !savedKey) { setRunError(t('quick.captions.needKey')); return; }
    if (engine === 'browser') { audio.toggle(); return; }
    setBusy(true);
    try {
      if (serverRunning) {
        await session.stopStt();
        setServerRunning(false);
      } else {
        await session.startStt({ provider: 'auditor', language: stt.lang, ...(ingest.streamKey ? { streamKey: ingest.streamKey } : {}) });
        setServerRunning(true);
      }
    } catch (err) {
      setRunError(`${t('quick.captions.startFailed')}: ${err?.message || ''}`.trim());
    } finally { setBusy(false); }
  }

  // ── Sent captions and typed captions ─────────────────────────────────────────
  const entries = (sentLog?.entries || []).slice(0, 30);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');

  async function submit() {
    const text = draft.trim();
    if (!text || sending || !connected) return;
    setSending(true);
    setSendError('');
    try { await send(text, Date.now()); setDraft(''); }
    catch (err) { setSendError(err?.message || t('quick.captions.sendFailed')); }
    finally { setSending(false); }
  }

  const setupReady = !!savedKey && (engine === 'browser' || ingest.enabled);

  return (
    <QuickShell title={t('quick.workflow.captions.title')}>
      {/* ── Setup ── */}
      <section className={s.card} aria-label={t('quick.captions.key.label')}>
        <div className={s.cardHead}>
          <span className={s.cardTitle}>{t('quick.section.setup')} · {t('quick.captions.key.label')}</span>
          <span className={`${s.badge} ${savedKey ? s.badgeOk : ''}`}>{savedKey ? maskKey(savedKey) : t('quick.captions.key.none')}</span>
        </div>
        {(!savedKey || editingKey) ? (
          <>
            <label className={s.field}>
              <span>{t('quick.captions.key.help')}</span>
              <input
                className={s.input}
                type="text"
                value={keyDraft}
                onChange={e => setKeyDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveKey(); }}
                aria-label={t('quick.captions.key.label')}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            {keyError && <p className={s.error} role="alert">{keyError}</p>}
            <div className={s.row}>
              <button type="button" className="btn btn--primary btn--sm" onClick={saveKey} disabled={!connected}>{t('quick.captions.key.save')}</button>
              {editingKey && <button type="button" className="btn btn--sm" onClick={() => { setEditingKey(false); setKeyError(''); }}>{t('quick.restream.form.cancel')}</button>}
            </div>
          </>
        ) : (
          <div className={s.row}>
            <button type="button" className="btn btn--sm" onClick={() => setEditingKey(true)}>{t('quick.captions.key.change')}</button>
            <button type="button" className="btn btn--sm" onClick={removeKey}>{t('quick.captions.key.remove')}</button>
          </div>
        )}
      </section>

      <section className={s.card} aria-label={t('quick.captions.engine.label')}>
        <div className={s.cardHead}><span className={s.cardTitle}>{t('quick.section.setup')} · {t('quick.captions.engine.label')}</span></div>
        <div className={s.segment} role="radiogroup" aria-label={t('quick.captions.engine.label')}>
          {['browser', 'auditor'].map(id => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={engine === id}
              disabled={listening}
              className={`${s.segBtn} ${engine === id ? s.segBtnOn : ''}`}
              onClick={() => chooseEngine(id)}
            >
              {t(`quick.captions.engine.${id}`)}
            </button>
          ))}
        </div>
        <p className={s.hint}>{t(`quick.captions.engine.${engine}Hint`)}</p>
        <label className={s.field}>
          <span>{t('quick.captions.language')}</span>
          <select
            className={s.input}
            value={stt.lang}
            disabled={engine === 'auditor' && serverRunning}
            onChange={e => chooseLanguage(e.target.value)}
            aria-label={t('quick.captions.language')}
          >
            {langOptions.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </label>
        {engine === 'auditor' && serverRunning && <p className={s.hint}>{t('quick.captions.languageLocked')}</p>}
        {setupError && <p className={s.error} role="alert">{setupError}</p>}
      </section>

      {engine === 'auditor' && <IngestDirections onChange={setIngest} />}

      {/* ── Run ── */}
      <section className={s.card} aria-label={t('quick.section.action')}>
        <div className={s.cardHead}>
          <span className={s.cardTitle}>{t('quick.section.action')}</span>
          <span className={s.conn}>
            <span className={`${s.dot} ${listening ? s.dotOn : ''}`} />
            {listening ? t('quick.captions.listening') : t('quick.captions.idle')}
          </span>
        </div>
        <button
          type="button"
          className={`${s.big} ${listening ? s.bigOn : ''}`}
          aria-pressed={listening}
          disabled={busy || !connected || (!listening && !setupReady && engine === 'auditor' && !!savedKey && !ingest.enabled)}
          onClick={toggle}
        >
          {listening ? t('quick.captions.stop') : t('quick.captions.start')}
        </button>
        {runError && <p className={s.error} role="alert">{runError}</p>}
        {engine === 'browser' && audio.interimText && <div className={s.interim}>{audio.interimText}</div>}

        {engine === 'auditor' && heard.length > 0 && (
          <div className={s.list} aria-label={t('quick.captions.heard')}>
            {heard.map((h, i) => <div key={`${h.at}-${i}`} className={`${s.entry} ${i === 0 ? s.entryNew : ''}`}>{h.text}</div>)}
          </div>
        )}

        <div className={s.list} aria-label={t('quick.captions.sent')}>
          {entries.length === 0 && <p className={s.hint}>{t('quick.captions.none')}</p>}
          {entries.map((e, i) => (
            <div key={e.requestId || i} className={`${s.entry} ${i === 0 && !e.error ? s.entryNew : ''} ${e.error ? s.entryError : ''}`}>
              <div className={`${s.entryMeta} ${e.pending ? s.entryPending : ''}`}>{e.pending ? t('quick.captions.pending') : `#${e.sequence ?? ''}`}</div>
              <div>{e.text}</div>
            </div>
          ))}
        </div>

        <div className={s.row}>
          <input
            className={`${s.input} ${s.grow}`}
            type="text"
            value={draft}
            disabled={!connected}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
            placeholder={t('quick.captions.placeholder')}
            aria-label={t('quick.captions.placeholder')}
          />
          <button type="button" className="btn btn--primary btn--sm" disabled={!connected || sending || !draft.trim()} onClick={submit}>
            {sending ? '…' : t('quick.captions.send')}
          </button>
        </div>
        {sendError && <p className={s.error} role="alert">{sendError}</p>}
      </section>
    </QuickShell>
  );
}
