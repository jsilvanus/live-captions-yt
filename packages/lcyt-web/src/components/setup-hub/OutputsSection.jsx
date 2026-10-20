import { useState, useEffect, useCallback } from 'react';
import { useSessionContext } from '../../contexts/SessionContext';
import { SetupCard, SetupItemRow } from './SetupCard.jsx';
import { EgressIcon } from './icons.jsx';
import { Dialog } from '../Dialog.jsx';
import { useSetupT } from '../../lib/useSetupT.js';
import { setupToken } from '../../lib/setupToken.js';
import { feedOptionLabel } from '../../lib/relaySource.js';
import {
  EMPTY_OUTPUT_FORM, formFromOutput, outputBody, toggleDsk, selectableChainOutputs, selectableOutputFeeds,
} from '../../lib/outputs.js';

const HINT_STYLE = { fontSize: 12, color: 'var(--color-text-muted)', margin: '4px 0 0' };

/**
 * OutputsSection: the Setup Hub "Outputs" card (`/setup/outputs`, plan_egress_outputs.md PR 5). An output is a
 * named pipeline `source (feed or output) -> DSK viewports -> crop -> destinations`. The rows come from
 * `GET /outputs`; add, edit and delete go through `POST/PATCH/DELETE /outputs`. The Egress card lists the outputs
 * as relay sources. The DSK picker offers the project's viewports (`GET /dsk/:key/viewports`); the audio picker
 * offers "the picture's own sound" or one feed (one audio source per output for now).
 */
export function OutputsSection() {
  const session = useSessionContext();
  const t = useSetupT();
  const connected = session?.connected;
  const backendUrl = session?.backendUrl;
  const apiKey = session?.apiKey;

  const [outputs, setOutputs] = useState(null);   // null until GET /outputs has answered
  const [feeds, setFeeds] = useState([]);
  const [viewports, setViewports] = useState([]);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null);     // { mode: 'add' } | { mode: 'edit', output } | null
  const [form, setForm] = useState(EMPTY_OUTPUT_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const authedFetch = useCallback((path, opts = {}) => {
    const token = setupToken(session);
    return fetch(`${backendUrl}/api/v1${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
    });
  }, [backendUrl, session?.projectAccessToken, session?.getSessionToken]);

  const load = useCallback(async () => {
    if (!connected || !backendUrl) return;
    try {
      const r = await authedFetch('/outputs');
      setOutputs(r.ok ? ((await r.json())?.outputs || []) : null);
    } catch { setOutputs(null); }
    try {
      const r = await authedFetch('/feeds');
      if (r.ok) setFeeds((await r.json())?.feeds || []);
    } catch { /* the source picker stays empty */ }
    if (apiKey) {
      try {
        const r = await authedFetch(`/dsk/${encodeURIComponent(apiKey)}/viewports`);
        if (r.ok) setViewports((await r.json())?.viewports || []);
      } catch { /* no DSK picker */ }
    }
  }, [connected, backendUrl, apiKey, authedFetch]);

  useEffect(() => { load(); }, [load]);

  function openAdd() {
    const firstFeed = selectableOutputFeeds(feeds)[0];
    setForm({ ...EMPTY_OUTPUT_FORM, dsk: [], source: firstFeed ? `feed:${firstFeed.id}` : '' });
    setFormError('');
    setDialog({ mode: 'add' });
  }

  function openEdit(output) {
    setForm(formFromOutput(output));
    setFormError('');
    setDialog({ mode: 'edit', output });
  }

  async function save() {
    const body = outputBody(form);
    if (!body) { setFormError(t('outputs.err.incomplete')); return; }
    const editing = dialog.mode === 'edit';
    setSaving(true);
    setFormError('');
    try {
      const r = await authedFetch(editing ? `/outputs/${encodeURIComponent(dialog.output.id)}` : '/outputs', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        setFormError(data?.error || t('outputs.err.save'));
        return;
      }
      setDialog(null);
      await load();
    } catch { setFormError(t('outputs.err.save')); }
    finally { setSaving(false); }
  }

  async function toggleEnabled(output) {
    setError('');
    setOutputs(list => (list || []).map(o => (o.id === output.id ? { ...o, enabled: !o.enabled } : o)));
    try {
      const r = await authedFetch(`/outputs/${encodeURIComponent(output.id)}`, {
        method: 'PATCH', body: JSON.stringify({ enabled: !output.enabled }),
      });
      if (!r.ok) setError(t('outputs.err.save'));
    } catch { setError(t('outputs.err.save')); }
    load();
  }

  async function remove(output) {
    if (typeof window !== 'undefined' && !window.confirm(t('outputs.confirmDelete', { name: output.name }))) return;
    setError('');
    try {
      const r = await authedFetch(`/outputs/${encodeURIComponent(output.id)}`, { method: 'DELETE' });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        setError(data?.error || t('outputs.err.delete'));
        return;
      }
      load();
    } catch { setError(t('outputs.err.delete')); }
  }

  const feedOptions = selectableOutputFeeds(feeds);
  const chainOptions = selectableChainOutputs(outputs, dialog?.output?.id);
  const sourceName = output => {
    if (output.sourceType === 'output') return (outputs || []).find(o => o.id === output.sourceId)?.name || output.sourceId;
    const feed = feeds.find(f => f.id === output.sourceId);
    return feed ? feedOptionLabel(feed) : output.sourceId;
  };
  const metaFor = output => [
    t('outputs.from', { name: sourceName(output) }),
    output.dsk?.length ? t('outputs.dskCount', { count: output.dsk.length }) : null,
    output.cropEnabled ? t('outputs.crop') : null,
  ].filter(Boolean).join(' · ');

  return (
    <SetupCard
      id="outputs"
      icon={EgressIcon}
      color="cyan"
      title={t('hub.card.outputs')}
      description={t('outputs.desc')}
      status="ready"
      headerAction={connected ? { label: t('outputs.add'), onClick: openAdd } : undefined}
    >
      {!connected ? (
        <p className="setup-card__empty">{t('outputs.connect')}</p>
      ) : outputs === null ? (
        <p className="setup-card__empty">{t('outputs.unavailable')}</p>
      ) : (
        <>
          {error && <p role="alert" style={{ color: 'var(--color-danger, #c33)', fontSize: 13 }}>{error}</p>}
          {outputs.length === 0 && <p className="setup-card__empty">{t('outputs.empty')}</p>}
          {outputs.map(output => (
            <SetupItemRow
              key={output.id}
              name={output.name}
              meta={metaFor(output)}
              toggleOn={output.enabled !== false}
              onToggle={() => toggleEnabled(output)}
              onSettings={() => openEdit(output)}
              onDelete={() => remove(output)}
            />
          ))}
        </>
      )}

      {dialog && (
        <Dialog title={dialog.mode === 'add' ? t('outputs.addTitle') : t('outputs.editTitle')} onClose={() => setDialog(null)}>
          <div style={{ display: 'grid', gap: 10 }}>
            <label className="settings-field">
              <span className="settings-field__label">{t('outputs.name')}</span>
              <input
                className="settings-field__input"
                type="text"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </label>
            <label className="settings-field">
              <span className="settings-field__label">{t('outputs.source')}</span>
              <select
                className="settings-field__input"
                value={form.source}
                onChange={e => setForm(f => ({ ...f, source: e.target.value }))}
              >
                {!form.source && <option value="">{t('outputs.pickSource')}</option>}
                <optgroup label={t('outputs.sourceFeeds')}>
                  {feedOptions.map(feed => (
                    <option key={feed.id} value={`feed:${feed.id}`}>{feedOptionLabel(feed)}</option>
                  ))}
                </optgroup>
                {chainOptions.length > 0 && (
                  <optgroup label={t('outputs.sourceOutputs')}>
                    {chainOptions.map(o => <option key={o.id} value={`output:${o.id}`}>{o.name}</option>)}
                  </optgroup>
                )}
              </select>
            </label>
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="settings-field__label">{t('outputs.dsk')}</legend>
              {viewports.length === 0 && <p style={HINT_STYLE}>{t('outputs.dskNone')}</p>}
              {viewports.map(vp => (
                <label key={vp.name} className="settings-checkbox">
                  <input
                    type="checkbox"
                    checked={form.dsk.includes(vp.name)}
                    onChange={() => setForm(f => ({ ...f, dsk: toggleDsk(f.dsk, vp.name) }))}
                  />
                  {vp.label || vp.name}
                </label>
              ))}
              <p style={HINT_STYLE}>{t('outputs.dskHint')}</p>
            </fieldset>
            <label className="settings-checkbox">
              <input
                type="checkbox"
                checked={form.cropEnabled}
                onChange={e => setForm(f => ({ ...f, cropEnabled: e.target.checked }))}
              />
              {t('outputs.cropEnabled')}
            </label>
            <label className="settings-field">
              <span className="settings-field__label">{t('outputs.audio')}</span>
              <select
                className="settings-field__input"
                value={form.audio}
                onChange={e => setForm(f => ({ ...f, audio: e.target.value }))}
              >
                <option value="source">{t('outputs.audioSource')}</option>
                {feedOptions.map(feed => (
                  <option key={feed.id} value={`feed:${feed.id}`}>{t('outputs.audioFrom', { name: feedOptionLabel(feed) })}</option>
                ))}
              </select>
              <p style={HINT_STYLE}>{t('outputs.audioHint')}</p>
            </label>
            {formError && <p role="alert" style={{ color: 'var(--color-danger, #c33)', fontSize: 13, margin: 0 }}>{formError}</p>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => setDialog(null)}>{t('outputs.cancel')}</button>
              <button type="button" className="btn btn--primary btn--sm" disabled={saving} onClick={save}>{t('outputs.save')}</button>
            </div>
          </div>
        </Dialog>
      )}
    </SetupCard>
  );
}
