import { KEYS } from '../lib/storageKeys.js';
import { useState, useEffect, useCallback, useContext } from 'react';
import { SessionContext } from '../contexts/SessionContext';
import { ConnectionSourceSelect } from './ProductionEncodersPage.jsx';

const MIXER_TYPES = [
  { value: 'roland', label: 'Roland V-series' },
  { value: 'amx',    label: 'AMX NetLinx' },
  { value: 'atem',   label: 'Blackmagic ATEM' },
  { value: 'obs',    label: 'OBS Studio' },
  { value: 'lcyt',   label: 'LCYT Software Mixer' },
];

const EMPTY_INPUT     = (n) => ({ number: n, command: '' });
const EMPTY_OBS_INPUT = (n) => ({ number: n, sceneName: '' });

function ConnectionDot({ connected }) {
  return (
    <span
      title={connected ? 'Connected' : 'Disconnected'}
      style={{
        display: 'inline-block', width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
        background: connected ? 'var(--color-success)' : 'var(--color-text-muted)',
        boxShadow: connected ? '0 0 5px var(--color-success)' : 'none',
      }}
    />
  );
}

function InputRow({ entry, onChange, onRemove }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
      <input
        className="settings-field__input"
        type="number"
        min={1}
        placeholder="#"
        value={entry.number}
        onChange={e => onChange({ ...entry, number: Number(e.target.value) })}
        style={{ width: 60 }}
      />
      <input
        className="settings-field__input"
        placeholder="AMX command (e.g. SEND_COMMAND dvRouter,'INPUT-1')"
        value={entry.command}
        onChange={e => onChange({ ...entry, command: e.target.value })}
        style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }}
      />
      <button className="btn btn--sm btn--ghost" onClick={onRemove} title="Remove input" style={{ flexShrink: 0 }}>
        ✕
      </button>
    </div>
  );
}

function ObsInputRow({ entry, onChange, onRemove }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
      <input
        className="settings-field__input"
        type="number"
        min={1}
        placeholder="#"
        value={entry.number}
        onChange={e => onChange({ ...entry, number: Number(e.target.value) })}
        style={{ width: 60 }}
      />
      <input
        className="settings-field__input"
        placeholder="OBS scene name (e.g. Wide Shot)"
        value={entry.sceneName}
        onChange={e => onChange({ ...entry, sceneName: e.target.value })}
        style={{ flex: 1 }}
      />
      <button className="btn btn--sm btn--ghost" onClick={onRemove} title="Remove input" style={{ flexShrink: 0 }}>
        ✕
      </button>
    </div>
  );
}

function MixerForm({ initial, bridges, onSave, onCancel, backendUrl, headers }) {
  const initType = initial?.type ?? 'roland';

  const [name,             setName]             = useState(initial?.name ?? '');
  const [type,             setType]             = useState(initType);
  const [host,             setHost]             = useState(initial?.connectionConfig?.host ?? '');
  const [port,             setPort]             = useState(
    initial?.connectionConfig?.port ?? (initType === 'amx' ? 1319 : initType === 'atem' ? '' : initType === 'obs' ? 4455 : 8023)
  );
  const [meIndex,          setMeIndex]          = useState(
    initial?.connectionConfig?.meIndex != null ? String(initial.connectionConfig.meIndex) : ''
  );
  const [inputs,           setInputs]           = useState(
    initType === 'amx' ? (initial?.connectionConfig?.inputs?.map(i => ({ ...i })) ?? []) : []
  );
  const [obsPassword,      setObsPassword]      = useState(initial?.connectionConfig?.password ?? '');
  const [obsInputs,        setObsInputs]        = useState(
    initType === 'obs' ? (initial?.connectionConfig?.inputs?.map(i => ({ ...i })) ?? []) : []
  );
  const [bridgeInstanceId, setBridgeInstanceId] = useState(initial?.bridgeInstanceId ?? '');
  const [connectionSource, setConnectionSource] = useState(initial?.connectionSource ?? 'backend');
  const [outputKey,        setOutputKey]        = useState(initial?.outputKey ?? '');
  const [testResult,       setTestResult]       = useState(null);
  const [testing,          setTesting]          = useState(false);

  // Update default port when type changes
  function handleTypeChange(newType) {
    setType(newType);
    if (!initial?.connectionConfig?.port) {
      if (newType === 'amx')       setPort(1319);
      else if (newType === 'atem') setPort('');
      else if (newType === 'obs')  setPort(4455);
      else                         setPort(8023);
    }
  }

  function buildConnectionConfig() {
    if (type === 'roland') return { host, port: Number(port) };
    if (type === 'amx')    return { host, port: Number(port), inputs };
    if (type === 'atem')   return { host, ...(meIndex !== '' ? { meIndex: Number(meIndex) } : {}) };
    if (type === 'obs')    return { host, port: Number(port), password: obsPassword, inputs: obsInputs };
    if (type === 'lcyt')   return {};
    return {};
  }

  async function handleTest() {
    if (!initial?.id) { setTestResult({ ok: false, error: 'Save the mixer first to test.' }); return; }
    setTesting(true); setTestResult(null);
    try {
      const r = await fetch(`${backendUrl}/production/mixers/${initial.id}/test`, { method: 'POST', headers });
      setTestResult(await r.json());
    } catch (e) {
      setTestResult({ ok: false, error: e.message });
    } finally {
      setTesting(false);
    }
  }

  function addInput() {
    const nextNum = inputs.length > 0 ? Math.max(...inputs.map(i => i.number)) + 1 : 1;
    setInputs(prev => [...prev, EMPTY_INPUT(nextNum)]);
  }
  function updateInput(idx, updated) { setInputs(prev => prev.map((i, n) => n === idx ? updated : i)); }
  function removeInput(idx)          { setInputs(prev => prev.filter((_, n) => n !== idx)); }

  function addObsInput() {
    const nextNum = obsInputs.length > 0 ? Math.max(...obsInputs.map(i => i.number)) + 1 : 1;
    setObsInputs(prev => [...prev, EMPTY_OBS_INPUT(nextNum)]);
  }
  function updateObsInput(idx, updated) { setObsInputs(prev => prev.map((i, n) => n === idx ? updated : i)); }
  function removeObsInput(idx)          { setObsInputs(prev => prev.filter((_, n) => n !== idx)); }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="settings-field">
        <label className="settings-field__label">Mixer name *</label>
        <input className="settings-field__input" value={name} onChange={e => setName(e.target.value)}
          placeholder="e.g. Main switcher" autoFocus />
      </div>

      <div className="settings-field">
        <label className="settings-field__label">Type</label>
        <select className="settings-field__input" value={type} onChange={e => handleTypeChange(e.target.value)}>
          {MIXER_TYPES.map(mt => <option key={mt.value} value={mt.value}>{mt.label}</option>)}
        </select>
      </div>

      {/* LCYT Software Mixer — output key only */}
      {type === 'lcyt' && (
        <div className="settings-field">
          <label className="settings-field__label">Output stream key</label>
          <input
            className="settings-field__input"
            value={outputKey}
            onChange={e => setOutputKey(e.target.value)}
            placeholder="e.g. myevent-mix"
            style={{ fontFamily: 'monospace' }}
          />
          <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--color-text-muted)' }}>
            MediaMTX path name for the mixed output. HLS will be available at <code>/stream-hls/{outputKey || '…'}/index.m3u8</code>.
          </p>
        </div>
      )}

      {/* Host — shown for hardware mixer types */}
      {type !== 'lcyt' && (
      <div style={{ display: 'flex', gap: 12 }}>
        <div className="settings-field" style={{ flex: 2 }}>
          <label className="settings-field__label">Host (IP)</label>
          <input className="settings-field__input" value={host} onChange={e => setHost(e.target.value)}
            placeholder={type === 'amx' ? '192.168.2.50' : '192.168.2.100'} />
        </div>
        {/* Port — hidden for ATEM (UDP on 9910, managed by atem-connection) */}
        {type !== 'atem' && (
          <div className="settings-field" style={{ flex: 1 }}>
            <label className="settings-field__label">{type === 'obs' ? 'WebSocket port' : 'TCP port'}</label>
            <input className="settings-field__input" type="number" value={port}
              onChange={e => setPort(e.target.value)}
              placeholder={type === 'amx' ? '1319' : type === 'obs' ? '4455' : '8023'} />
          </div>
        )}
      </div>
      )}

      {/* ATEM-specific: M/E index — only for hardware types */}
      {type === 'atem' && type !== 'lcyt' && (
        <div className="settings-field">
          <label className="settings-field__label">
            M/E Index
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginLeft: 6, fontWeight: 400 }}>
              (0 = M/E 1, 1 = M/E 2 — leave blank for M/E 1)
            </span>
          </label>
          <input className="settings-field__input" type="number" min={0}
            value={meIndex} onChange={e => setMeIndex(e.target.value)}
            placeholder="0" style={{ width: 80 }} />
        </div>
      )}

      {/* AMX-specific: input command rows */}
      {type === 'amx' && (
        <div className="settings-field">
          <label className="settings-field__label">
            Input commands
            <button className="btn btn--sm btn--ghost" style={{ marginLeft: 8 }} onClick={addInput}>
              + Add input
            </button>
          </label>
          {inputs.length === 0 && (
            <p style={{ color: 'var(--color-text-muted)', fontSize: 12, margin: '4px 0' }}>
              No inputs. Click "Add input" to add one.
            </p>
          )}
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>
            Input # → AMX command sent to switch to that input
          </div>
          {inputs.map((inp, i) => (
            <InputRow key={i} entry={inp}
              onChange={updated => updateInput(i, updated)}
              onRemove={() => removeInput(i)} />
          ))}
        </div>
      )}

      {/* OBS-specific: password + scene inputs */}
      {type === 'obs' && (
        <>
          <div className="settings-field">
            <label className="settings-field__label">Password</label>
            <input
              className="settings-field__input"
              type="password"
              value={obsPassword}
              onChange={e => setObsPassword(e.target.value)}
              placeholder="OBS WebSocket password (leave blank if disabled)"
              autoComplete="new-password"
            />
          </div>

          <div className="settings-field">
            <label className="settings-field__label">
              Scene inputs
              <button className="btn btn--sm btn--ghost" style={{ marginLeft: 8 }} onClick={addObsInput}>
                + Add input
              </button>
            </label>
            {obsInputs.length === 0 && (
              <p style={{ color: 'var(--color-text-muted)', fontSize: 12, margin: '4px 0' }}>
                No inputs. Click "Add input" to map input numbers to OBS scene names.
              </p>
            )}
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>
              Input # → OBS scene name (must match exactly)
            </div>
            {obsInputs.map((inp, i) => (
              <ObsInputRow key={i} entry={inp}
                onChange={updated => updateObsInput(i, updated)}
                onRemove={() => removeObsInput(i)} />
            ))}
          </div>
        </>
      )}

      {/* Connection source — not applicable for LCYT software mixer */}
      {type !== 'lcyt' && (
        <ConnectionSourceSelect
          connectionSource={connectionSource}
          bridgeInstanceId={bridgeInstanceId}
          bridges={bridges}
          onChange={({ connectionSource: cs, bridgeInstanceId: bid }) => {
            setConnectionSource(cs);
            setBridgeInstanceId(bid ?? '');
          }}
        />
      )}

      {testResult && (
        <div style={{
          padding: '6px 10px', borderRadius: 4, fontSize: 12,
          background: testResult.ok ? 'var(--color-success-bg, #d1fae5)' : 'var(--color-error-bg, #fee2e2)',
          color: testResult.ok ? 'var(--color-success-text, #065f46)' : 'var(--color-error)',
        }}>
          {testResult.ok ? `✓ Connected to ${testResult.host}:${testResult.port}` : `✗ ${testResult.error}`}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4, flexWrap: 'wrap' }}>
        <button
          className="btn btn--ghost btn--sm"
          onClick={handleTest}
          disabled={testing || type === 'atem' || type === 'obs' || type === 'lcyt'}
          title={
            type === 'lcyt'  ? 'Not applicable for software mixer' :
            type === 'atem'  ? 'UDP-based; connection test requires bridge' :
            type === 'obs'   ? 'WebSocket; save first and check mixer status' : undefined
          }
          style={{ marginRight: 'auto' }}
        >
          {testing ? 'Testing…' : 'Test connection'}
        </button>
        <button className="btn btn--ghost" onClick={onCancel}>Cancel</button>
        <button className="btn btn--primary"
          onClick={() => onSave({
            name: name.trim(), type,
            connectionConfig: buildConnectionConfig(),
            connectionSource, bridgeInstanceId: bridgeInstanceId || null,
            outputKey: outputKey.trim() || null,
          })}
          disabled={!name.trim()}>
          Save
        </button>
      </div>
    </div>
  );
}

function MixerRow({ mixer, bridges, onEdit, onDelete }) {
  const typeLabel  = MIXER_TYPES.find(t => t.value === mixer.type)?.label ?? mixer.type;
  const cfg        = mixer.connectionConfig || {};
  const isLcyt     = mixer.type === 'lcyt';
  // Progressive disclosure: bridge name only when 2+ bridges exist
  const bridge     = bridges.length >= 2 ? bridges.find(b => b.id === mixer.bridgeInstanceId) : null;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
      border: '1px solid var(--color-border)', borderRadius: 4,
    }}>
      <ConnectionDot connected={mixer.connected} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontWeight: 600 }}>{mixer.name}</span>
        {!isLcyt && cfg.host && (
          <span style={{ marginLeft: 8, color: 'var(--color-text-muted)', fontSize: 12 }}>
            {mixer.type === 'atem'
              ? cfg.host
              : `${cfg.host}:${cfg.port ?? (mixer.type === 'amx' ? 1319 : mixer.type === 'obs' ? 4455 : 8023)}`}
          </span>
        )}
        {isLcyt && mixer.outputKey && (
          <span style={{ marginLeft: 8, fontSize: 11, fontFamily: 'monospace', color: 'var(--color-text-muted)' }}>
            {mixer.outputKey}
          </span>
        )}
        {bridge && (
          <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--color-text-muted)' }}>
            via {bridge.name}
          </span>
        )}
      </div>
      <span style={{
        fontSize: 11, padding: '2px 6px', borderRadius: 3,
        background: 'var(--color-surface-alt)', color: 'var(--color-text-muted)', whiteSpace: 'nowrap',
      }}>{typeLabel}</span>
      {(mixer.type === 'amx' || mixer.type === 'obs') && (
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
          {cfg.inputs?.length ?? 0} input{(cfg.inputs?.length ?? 0) !== 1 ? 's' : ''}
        </span>
      )}
      {mixer.activeSource != null && (
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
          PGM: {mixer.activeSource}
        </span>
      )}
      {isLcyt && (
        <a
          href={`/production/lcyt-mixer/${mixer.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn--sm btn--ghost"
          style={{ textDecoration: 'none' }}
        >
          Open mixer
        </a>
      )}
      <button className="btn btn--sm btn--ghost" onClick={() => onEdit(mixer)}>Edit</button>
      <button className="btn btn--sm btn--ghost btn--danger" onClick={() => onDelete(mixer)}>Delete</button>
    </div>
  );
}

export function ProductionMixersPage() {
  const session    = useContext(SessionContext);
  const params     = new URLSearchParams(window.location.search);
  const backendUrl = params.get('server') || session?.backendUrl || localStorage.getItem(KEYS.session.backendUrl) || '';
  const apiKey     = params.get('apikey') || '';

  const [mixers,        setMixers]        = useState([]);
  const [bridges,       setBridges]       = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState(null);
  const [editing,       setEditing]       = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const headers = { 'Content-Type': 'application/json', ...(apiKey ? { 'X-Admin-Key': apiKey } : {}) };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [mixRes, bridgeRes] = await Promise.all([
        fetch(`${backendUrl}/production/mixers`,           { headers }),
        fetch(`${backendUrl}/production/bridge/instances`, { headers }),
      ]);
      if (!mixRes.ok)    throw new Error(`mixers: HTTP ${mixRes.status}`);
      if (!bridgeRes.ok) throw new Error(`bridges: HTTP ${bridgeRes.status}`);
      setMixers(await mixRes.json());
      setBridges(await bridgeRes.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [backendUrl, apiKey]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  async function handleSave(data) {
    const isNew = editing === 'new';
    const url   = isNew
      ? `${backendUrl}/production/mixers`
      : `${backendUrl}/production/mixers/${editing.id}`;
    try {
      const r = await fetch(url, { method: isNew ? 'POST' : 'PUT', headers, body: JSON.stringify(data) });
      if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error(b.error || `HTTP ${r.status}`); }
      setEditing(null);
      fetchAll();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDelete(mixer) {
    try {
      const r = await fetch(`${backendUrl}/production/mixers/${mixer.id}`, { method: 'DELETE', headers });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setConfirmDelete(null);
      fetchAll();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div style={{ padding: 20, maxWidth: 700, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16, gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Mixers</h2>
        <button className="btn btn--primary btn--sm" onClick={() => setEditing('new')} disabled={!!editing}>
          + Add mixer
        </button>
      </div>

      {error && <div style={{ color: 'var(--color-error)', marginBottom: 12, fontSize: 13 }}>{error}</div>}

      {editing && (
        <div style={{
          border: '1px solid var(--color-border)', borderRadius: 6, padding: 16,
          marginBottom: 16, background: 'var(--color-surface-alt)',
        }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>
            {editing === 'new' ? 'Add mixer' : `Edit: ${editing.name}`}
          </h3>
          <MixerForm
            initial={editing === 'new' ? null : editing}
            bridges={bridges}
            onSave={handleSave}
            onCancel={() => setEditing(null)}
            backendUrl={backendUrl}
            headers={headers}
          />
        </div>
      )}

      {loading ? (
        <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p>
      ) : mixers.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)' }}>No mixers configured yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {mixers.map(m => (
            <MixerRow key={m.id} mixer={m} bridges={bridges}
              onEdit={mx => setEditing(mx)} onDelete={mx => setConfirmDelete(mx)} />
          ))}
        </div>
      )}

      {confirmDelete && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{ background: 'var(--color-surface)', borderRadius: 8, padding: 24, maxWidth: 360, width: '90%' }}>
            <p style={{ margin: '0 0 16px' }}>Delete mixer <strong>{confirmDelete.name}</strong>?</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn--ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn btn--danger" onClick={() => handleDelete(confirmDelete)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
