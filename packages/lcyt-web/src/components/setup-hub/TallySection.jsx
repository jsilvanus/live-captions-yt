import { useState, useEffect, useCallback } from 'react';
import { useSessionContext } from '../../contexts/SessionContext';
import { SetupCard, SetupItemRow } from './SetupCard.jsx';
import { TallyIcon } from './icons.jsx';
import { Dialog } from '../Dialog.jsx';
import { useSetupT } from '../../lib/useSetupT.js';

const API = '/api/v1/tally';
const POLL_MS = 5000;

const inputStyle = { padding: '0.4rem 0.5rem', borderRadius: 6, border: '1px solid var(--border, #ccc)', width: '100%', boxSizing: 'border-box' };
const labelStyle = { fontSize: '0.8em', fontWeight: 600, opacity: 0.8, display: 'block', marginBottom: 2 };
const fieldStyle = { marginBottom: '0.6rem' };

const STATES = {
  'live-signal': ['LIVE', 'DEGRADED', 'STARTING', 'OFF', 'UNKNOWN'],
  camera: ['PGM', 'PRV', 'OFF', 'UNKNOWN'],
};
const STATE_COLOR = {
  LIVE: '#d32f2f', PGM: '#d32f2f', DEGRADED: '#f59e0b', STARTING: '#2563eb', PRV: '#16a34a', OFF: '#9ca3af', UNKNOWN: '#f59e0b',
};

const EMPTY_FORM = {
  name: '', kind: 'live-signal',
  mode: 'A', videoId: '',
  atemHost: '', atemInput: '1', atemMe: '0',
  lampHost: '',
  runner: 'auto', bridgeInstanceId: '',
  enabled: true,
};

function formFromLight(l) {
  return {
    name: l.name, kind: l.kind, enabled: l.enabled !== false,
    mode: l.source?.mode || 'A', videoId: l.source?.videoId || '',
    atemHost: l.source?.host || '', atemInput: String(l.source?.input ?? 1), atemMe: String(l.source?.meIndex ?? 0),
    lampHost: l.output?.host || '',
    runner: l.runner || 'auto', bridgeInstanceId: l.bridgeInstanceId || '',
  };
}

function bodyFromForm(f) {
  const body = {
    name: f.name.trim(), kind: f.kind, enabled: f.enabled, runner: f.runner,
    output: { type: 'tally-ma', host: f.lampHost.trim() },
    source: f.kind === 'live-signal'
      ? { type: 'youtube', mode: f.mode, ...(f.mode === 'B' ? { videoId: f.videoId.trim() } : {}) }
      : { type: 'atem', host: f.atemHost.trim(), input: Number(f.atemInput), meIndex: Number(f.atemMe) },
  };
  if (f.runner === 'bridge' || f.bridgeInstanceId) body.bridgeInstanceId = f.bridgeInstanceId || undefined;
  return body;
}

/**
 * TallySection — Setup Hub card "Tally": lights that show whether the stream is on
 * (live signal, read from YouTube) or which camera is on air (camera tally, from a switcher).
 * Backed by `/api/v1/tally` (lcyt-tally). Several lights per project are fine.
 */
export function TallySection() {
  const t = useSetupT();
  const session = useSessionContext();
  const connected = session?.connected;
  const backendUrl = session?.backendUrl;
  const getSessionToken = session?.getSessionToken;

  const [lights, setLights] = useState([]);
  const [bridges, setBridges] = useState([]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // null | { id?: string, form }
  const [formError, setFormError] = useState('');
  const [testMsg, setTestMsg] = useState('');

  const api = useCallback(async (path, { method = 'GET', body } = {}) => {
    const token = getSessionToken?.();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${backendUrl}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }, [backendUrl, getSessionToken]);

  const load = useCallback(async () => {
    if (!connected || !backendUrl) return;
    try {
      const data = await api(`${API}/lights`);
      setLights(data.lights || []);
      setError('');
    } catch (e) { setError(e.message); }
  }, [connected, backendUrl, api]);

  useEffect(() => {
    load();
    if (!connected) return undefined;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [load, connected]);

  useEffect(() => {
    if (!editing || bridges.length) return;
    api('/api/v1/production/bridge/instances')
      .then((d) => setBridges(Array.isArray(d) ? d : (d.instances || [])))
      .catch(() => {});
  }, [editing, bridges.length, api]);

  function openAdd() { setFormError(''); setTestMsg(''); setEditing({ form: { ...EMPTY_FORM } }); }
  function openEdit(l) { setFormError(''); setTestMsg(''); setEditing({ id: l.id, form: formFromLight(l) }); }
  const setField = (name, value) => setEditing((e) => ({ ...e, form: { ...e.form, [name]: value } }));

  async function save() {
    const f = editing.form;
    if (!f.name.trim()) { setFormError(t('tally.err.name')); return; }
    if (!f.lampHost.trim()) { setFormError(t('tally.err.lamp')); return; }
    try {
      await api(editing.id ? `${API}/lights/${editing.id}` : `${API}/lights`, { method: editing.id ? 'PUT' : 'POST', body: bodyFromForm(f) });
      setEditing(null);
      load();
    } catch (e) { setFormError(e.message); }
  }

  async function remove(l) {
    if (!window.confirm(t('tally.confirmDelete', { name: l.name }))) return;
    try { await api(`${API}/lights/${l.id}`, { method: 'DELETE' }); load(); } catch (e) { setError(e.message); }
  }

  async function testState(state) {
    setTestMsg('');
    try {
      await api(`${API}/lights/${editing.id}/test`, { method: 'POST', body: { state } });
      setTestMsg(t('tally.testSent', { state: t(`tally.state.${state}`) }));
    } catch (e) { setTestMsg(e.message); }
  }

  const f = editing?.form;

  return (
    <SetupCard
      id="tally"
      icon={TallyIcon}
      color="teal"
      title={t('hub.card.tally')}
      description={t('tally.desc')}
      status="ready"
      headerAction={connected ? { label: t('tally.add'), onClick: openAdd } : undefined}
      emptyText={lights.length === 0 ? (connected ? t('tally.empty') : t('tally.connect')) : undefined}
    >
      {(error || lights.length > 0 || editing) ? (<>
      {error && <p className="setup-card__empty" style={{ color: 'var(--color-error)' }}>{error}</p>}
      {lights.map((l) => {
        const st = l.status || {};
        const state = st.state || null;
        return (
          <SetupItemRow
            key={l.id}
            name={l.name}
            statusDot={state ? STATE_COLOR[state] : STATE_COLOR.OFF}
            meta={[
              t(`tally.kind.${l.kind}`),
              state ? t(`tally.state.${state}`) : (st.note || t('tally.notRunning')),
              st.error ? `⚠ ${st.error}` : null,
            ].filter(Boolean).join(' · ')}
            faded={l.enabled === false}
            onSettings={() => openEdit(l)}
            onDelete={() => remove(l)}
          />
        );
      })}

      {editing && (
        <Dialog
          title={editing.id ? t('tally.editTitle') : t('tally.addTitle')}
          onClose={() => setEditing(null)}
          footer={(
            <>
              {formError && <span style={{ fontSize: 12, color: 'var(--color-error)', marginRight: 'auto' }}>{formError}</span>}
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => setEditing(null)}>{t('tally.cancel')}</button>
              <button type="button" className="btn btn--primary btn--sm" onClick={save}>{t('tally.save')}</button>
            </>
          )}
        >
          <div style={fieldStyle}>
            <label style={labelStyle} htmlFor="tally-name">{t('tally.field.name')}</label>
            <input id="tally-name" style={inputStyle} value={f.name} onChange={(e) => setField('name', e.target.value)} />
          </div>

          <div style={fieldStyle}>
            <label style={labelStyle} htmlFor="tally-kind">{t('tally.field.kind')}</label>
            <select id="tally-kind" style={inputStyle} value={f.kind} disabled={Boolean(editing.id)} onChange={(e) => setField('kind', e.target.value)}>
              <option value="live-signal">{t('tally.kindLong.live-signal')}</option>
              <option value="camera">{t('tally.kindLong.camera')}</option>
            </select>
          </div>

          {f.kind === 'live-signal' ? (
            <>
              <div style={fieldStyle}>
                <label style={labelStyle} htmlFor="tally-mode">{t('tally.field.mode')}</label>
                <select id="tally-mode" style={inputStyle} value={f.mode} onChange={(e) => setField('mode', e.target.value)}>
                  <option value="A">{t('tally.mode.A')}</option>
                  <option value="B">{t('tally.mode.B')}</option>
                </select>
              </div>
              {f.mode === 'B' && (
                <div style={fieldStyle}>
                  <label style={labelStyle} htmlFor="tally-video">{t('tally.field.videoId')}</label>
                  <input id="tally-video" style={inputStyle} value={f.videoId} onChange={(e) => setField('videoId', e.target.value)} />
                </div>
              )}
            </>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ ...fieldStyle, flex: 2 }}>
                <label style={labelStyle} htmlFor="tally-atem">{t('tally.field.atemHost')}</label>
                <input id="tally-atem" style={inputStyle} value={f.atemHost} onChange={(e) => setField('atemHost', e.target.value)} />
              </div>
              <div style={{ ...fieldStyle, flex: 1 }}>
                <label style={labelStyle} htmlFor="tally-input">{t('tally.field.atemInput')}</label>
                <input id="tally-input" type="number" min="1" max="99" style={inputStyle} value={f.atemInput} onChange={(e) => setField('atemInput', e.target.value)} />
              </div>
              <div style={{ ...fieldStyle, flex: 1 }}>
                <label style={labelStyle} htmlFor="tally-me">{t('tally.field.atemMe')}</label>
                <input id="tally-me" type="number" min="0" max="3" style={inputStyle} value={f.atemMe} onChange={(e) => setField('atemMe', e.target.value)} />
              </div>
            </div>
          )}

          <div style={fieldStyle}>
            <label style={labelStyle} htmlFor="tally-lamp">{t('tally.field.lampHost')}</label>
            <input id="tally-lamp" style={inputStyle} placeholder="192.168.1.50" value={f.lampHost} onChange={(e) => setField('lampHost', e.target.value)} />
          </div>

          <div style={fieldStyle}>
            <label style={labelStyle} htmlFor="tally-runner">{t('tally.field.runner')}</label>
            <select id="tally-runner" style={inputStyle} value={f.runner} onChange={(e) => setField('runner', e.target.value)}>
              <option value="auto">{t('tally.runner.auto')}</option>
              <option value="backend">{t('tally.runner.backend')}</option>
              <option value="bridge">{t('tally.runner.bridge')}</option>
            </select>
          </div>
          {(f.runner === 'bridge' || f.runner === 'auto' || f.kind === 'camera') && (
            <div style={fieldStyle}>
              <label style={labelStyle} htmlFor="tally-bridge">{t('tally.field.bridge')}</label>
              <select id="tally-bridge" style={inputStyle} value={f.bridgeInstanceId} onChange={(e) => setField('bridgeInstanceId', e.target.value)}>
                <option value="">{t('tally.noBridge')}</option>
                {bridges.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          )}

          <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
            <input type="checkbox" checked={f.enabled} onChange={(e) => setField('enabled', e.target.checked)} />
            {t('tally.field.enabled')}
          </label>

          {editing.id && (
            <div style={fieldStyle}>
              <span style={labelStyle}>{t('tally.testTitle')}</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {STATES[f.kind].map((s) => (
                  <button key={s} type="button" className="btn btn--secondary btn--sm" onClick={() => testState(s)}>{t(`tally.state.${s}`)}</button>
                ))}
              </div>
              <p style={{ fontSize: 12, opacity: 0.8, margin: '6px 0 0' }}>{testMsg || t('tally.testHint')}</p>
            </div>
          )}
        </Dialog>
      )}
      </>) : null}
    </SetupCard>
  );
}
