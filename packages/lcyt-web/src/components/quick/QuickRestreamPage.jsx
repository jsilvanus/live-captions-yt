import { useState } from 'react';
import { useLang } from '../../contexts/LangContext';
import { usePolling } from '../../hooks/usePolling.js';
import {
  EMPTY_OUTPUT_FORM, formFromRelay, isYoutubeRelay, outputBody, outputFormError, relayDetail, relayState, sortedRelays,
} from '../../lib/quickRestream.js';
import { IngestDirections } from './IngestDirections.jsx';
import { QuickShell } from './QuickShell.jsx';
import { useQuickApi } from './useQuickApi.js';
import s from './quick.module.css';

function OutputForm({ initial, onSave, onCancel, t }) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState('');
  const set = (patch) => setForm(f => ({ ...f, ...patch }));

  async function save() {
    const problem = outputFormError(form);
    if (problem) { setError(t(`quick.restream.err.${problem}`)); return; }
    setError('');
    try { await onSave(form); } catch (err) { setError(err?.message || t('quick.restream.err.save')); }
  }

  return (
    <div className={s.card} data-testid="output-form">
      <div className={s.segment} role="radiogroup" aria-label={t('quick.restream.form.type')}>
        {['youtube', 'generic'].map(type => (
          <button
            key={type}
            type="button"
            role="radio"
            aria-checked={form.type === type}
            className={`${s.segBtn} ${form.type === type ? s.segBtnOn : ''}`}
            onClick={() => set({ type })}
          >
            {t(`quick.restream.form.${type}`)}
          </button>
        ))}
      </div>
      {form.type === 'youtube' ? (
        <label className={s.field}>
          <span>{t('quick.restream.form.youtubeKey')}</span>
          <input className={s.input} type="text" value={form.youtubeKey} autoComplete="off" spellCheck={false}
            onChange={e => set({ youtubeKey: e.target.value })} aria-label={t('quick.restream.form.youtubeKey')} />
        </label>
      ) : (
        <>
          <label className={s.field}>
            <span>{t('quick.restream.form.url')}</span>
            <input className={s.input} type="text" value={form.url} autoComplete="off" spellCheck={false}
              onChange={e => set({ url: e.target.value })} aria-label={t('quick.restream.form.url')} />
          </label>
          <label className={s.field}>
            <span>{t('quick.restream.form.name')}</span>
            <input className={s.input} type="text" value={form.name}
              onChange={e => set({ name: e.target.value })} aria-label={t('quick.restream.form.name')} />
          </label>
        </>
      )}
      {error && <p className={s.error} role="alert">{error}</p>}
      <div className={s.row}>
        <button type="button" className="btn btn--primary btn--sm" onClick={save}>{t('quick.restream.form.save')}</button>
        <button type="button" className="btn btn--sm" onClick={onCancel}>{t('quick.restream.form.cancel')}</button>
      </div>
    </div>
  );
}

/**
 * Quick workflow "Send broadcast to multiple targets": where to send the stream, any number of outputs (each one a
 * relay slot: a YouTube key or an rtmp(s) address) and one switch for the relay.
 */
export function QuickRestreamPage() {
  const { t } = useLang();
  const { connected, call } = useQuickApi();
  const [relay, setRelay] = useState(null);          // GET /stream, null until it has answered
  const [unavailable, setUnavailable] = useState(false);
  const [ingest, setIngest] = useState({ enabled: false, live: false });
  const [editing, setEditing] = useState(null);      // null | 'new' | relay slot object
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setRelay(await call('/stream'));
      setUnavailable(false);
    } catch (err) {
      // 403/404: the relay is not allowed or not mounted for this project; anything else keeps what is on screen.
      if (err.status === 403 || err.status === 404) setUnavailable(true);
    }
  }
  usePolling(load, 4000, { enabled: connected });

  async function saveOutput(form) {
    if (editing && editing !== 'new') await call(`/stream/${editing.slot}`, { method: 'PUT', body: outputBody(form) });
    else await call('/stream', { method: 'POST', body: outputBody(form) });
    setEditing(null);
    await load();
  }

  async function removeOutput(slot) {
    if (!window.confirm(t('quick.restream.removeConfirm'))) return;
    setError('');
    try { await call(`/stream/${slot}`, { method: 'DELETE' }); await load(); }
    catch (err) { setError(err.message); }
  }

  async function toggleRelay() {
    setBusy(true);
    setError('');
    try { await call('/stream/active', { method: 'PUT', body: { active: !relay?.active } }); await load(); }
    catch (err) { setError(`${t('quick.restream.err.toggle')}: ${err.message}`); }
    finally { setBusy(false); }
  }

  const relays = sortedRelays(relay?.relays);
  const running = relay?.runningSlots || [];
  const state = relayState(relay, ingest.live);
  const on = !!relay?.active;

  return (
    <QuickShell title={t('quick.workflow.restream.title')}>
      <IngestDirections onChange={setIngest} />

      <section className={s.card} aria-label={t('quick.restream.outputs')}>
        <div className={s.cardHead}>
          <span className={s.cardTitle}>{t('quick.section.setup')} · {t('quick.restream.outputs')}</span>
          <button type="button" className="btn btn--sm" onClick={() => setEditing('new')} disabled={!connected || unavailable || editing === 'new'}>
            {t('quick.restream.add')}
          </button>
        </div>
        {unavailable && <p className={s.hint}>{t('quick.ingest.unavailable')}</p>}
        {!unavailable && relays.length === 0 && editing !== 'new' && <p className={s.hint}>{t('quick.restream.empty')}</p>}
        {relays.map(r => (
          editing && editing !== 'new' && editing.slot === r.slot ? (
            <OutputForm key={r.slot} initial={formFromRelay(r)} onSave={saveOutput} onCancel={() => setEditing(null)} t={t} />
          ) : (
            <div key={r.slot} className={s.entry} data-testid={`output-${r.slot}`}>
              <div className={s.row}>
                <div className={s.grow}>
                  <strong>{isYoutubeRelay(r) ? t('quick.restream.form.youtube') : (r.targetName || t('quick.restream.form.generic'))}</strong>
                  <div className={`${s.hint} ${s.mono}`}>{relayDetail(r)}</div>
                </div>
                {running.includes(r.slot) && <span className={`${s.badge} ${s.badgeOk}`}>{t('quick.restream.sending')}</span>}
                <button type="button" className="btn btn--sm" onClick={() => setEditing(r)}>{t('quick.restream.edit')}</button>
                <button type="button" className="btn btn--sm" onClick={() => removeOutput(r.slot)}>{t('quick.restream.remove')}</button>
              </div>
            </div>
          )
        ))}
        {editing === 'new' && <OutputForm initial={EMPTY_OUTPUT_FORM} onSave={saveOutput} onCancel={() => setEditing(null)} t={t} />}
      </section>

      <section className={s.card} aria-label={t('quick.section.action')}>
        <div className={s.cardHead}>
          <span className={s.cardTitle}>{t('quick.section.action')}</span>
          <span className={s.conn} role="status">
            <span className={`${s.dot} ${state === 'running' ? s.dotOn : (state === 'off' ? '' : s.dotWarn)}`} />
            {t(`quick.restream.state.${state}`)}
          </span>
        </div>
        <button
          type="button"
          className={`${s.big} ${on ? s.bigOn : ''}`}
          aria-pressed={on}
          disabled={busy || !connected || unavailable || (!on && relays.length === 0)}
          onClick={toggleRelay}
        >
          {on ? t('quick.restream.stop') : t('quick.restream.start')}
        </button>
        {!on && relays.length === 0 && <p className={s.hint}>{t('quick.restream.needOutput')}</p>}
        <p className={s.hint}>{t('quick.restream.note')}</p>
        {error && <p className={s.error} role="alert">{error}</p>}
        {relay?.stderrTail && (
          <details>
            <summary className={s.hint}>{t('quick.restream.lastExit')}</summary>
            <pre className={s.pre}>{typeof relay.stderrTail === 'string' ? relay.stderrTail : JSON.stringify(relay.stderrTail, null, 2)}</pre>
          </details>
        )}
      </section>
    </QuickShell>
  );
}
