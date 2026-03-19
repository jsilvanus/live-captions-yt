import { KEYS } from '../lib/storageKeys.js';
import { useState, useEffect, useCallback, useContext } from 'react';
import { SessionContext } from '../contexts/SessionContext';

// ── Constants ──────────────────────────────────────────────────────────────

const ENCODER_TYPES = [
  { value: 'monarch_hdx', label: 'Matrox Monarch HDx' },
  { value: 'monarch_hd',  label: 'Matrox Monarch HD'  },
];

// ── Connection source dropdown ─────────────────────────────────────────────

/**
 * Unified "Connection" dropdown replacing the old bridge-only select.
 * Options:
 *   - Backend (direct HTTP from server)
 *   - Browser (browser makes HTTP calls directly to device)
 *   - One option per configured bridge instance
 */
function ConnectionSourceSelect({ connectionSource, bridgeInstanceId, bridges, onChange }) {
  // Encode as a single string: 'backend' | 'frontend' | 'bridge:<id>'
  const value = connectionSource === 'bridge' && bridgeInstanceId
    ? `bridge:${bridgeInstanceId}`
    : connectionSource;

  function handleChange(e) {
    const v = e.target.value;
    if (v === 'backend' || v === 'frontend') {
      onChange({ connectionSource: v, bridgeInstanceId: null });
    } else if (v.startsWith('bridge:')) {
      onChange({ connectionSource: 'bridge', bridgeInstanceId: v.slice(7) });
    }
  }

  return (
    <div className="settings-field">
      <label className="settings-field__label">Connection</label>
      <select className="settings-field__input" value={value} onChange={handleChange}>
        <option value="backend">Backend (server connects directly)</option>
        <option value="frontend">Browser (your browser connects directly)</option>
        {bridges.map(b => (
          <option key={b.id} value={`bridge:${b.id}`}>
            Bridge: {b.name}{b.status === 'connected' ? ' ●' : ' ○'}
          </option>
        ))}
      </select>
      {connectionSource === 'frontend' && (
        <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--color-text-muted)' }}>
          Your browser will contact the encoder directly. The encoder must be reachable from your network.
        </p>
      )}
      {connectionSource === 'bridge' && (
        <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--color-text-muted)' }}>
          Commands are relayed via the bridge agent on the AV network.
        </p>
      )}
    </div>
  );
}

// ── Encoder form ───────────────────────────────────────────────────────────

function EncoderForm({ initial, bridges, onSave, onCancel, backendUrl, headers }) {
  const [name,             setName]             = useState(initial?.name ?? '');
  const [type,             setType]             = useState(initial?.type ?? 'monarch_hdx');
  const [host,             setHost]             = useState(initial?.connectionConfig?.host ?? '');
  const [protocol,         setProtocol]         = useState(initial?.connectionConfig?.protocol ?? 'http');
  const [username,         setUsername]         = useState(initial?.connectionConfig?.username ?? 'admin');
  const [password,         setPassword]         = useState(initial?.connectionConfig?.password ?? 'admin');
  const [encoderNumber,    setEncoderNumber]    = useState(
    String(initial?.connectionConfig?.encoderNumber ?? 1)
  );
  const [connectionSource, setConnectionSource] = useState(initial?.connectionSource ?? 'backend');
  const [bridgeInstanceId, setBridgeInstanceId] = useState(initial?.bridgeInstanceId ?? '');
  const [testResult,       setTestResult]       = useState(null);
  const [testing,          setTesting]          = useState(false);

  function buildConnectionConfig() {
    const cfg = { host };
    if (protocol !== 'http')      cfg.protocol      = protocol;
    if (username !== 'admin')     cfg.username      = username;
    if (password !== 'admin')     cfg.password      = password;
    if (Number(encoderNumber) !== 1) cfg.encoderNumber = Number(encoderNumber);
    return cfg;
  }

  async function handleTest() {
    if (!initial?.id) { setTestResult({ ok: false, error: 'Save the encoder first to test.' }); return; }
    if (connectionSource === 'frontend') {
      // Test from browser directly
      try {
        const auth = btoa(`${username || 'admin'}:${password || 'admin'}`);
        const r = await fetch(`${protocol}://${host}/Monarch/sdk/status`, {
          headers: { Authorization: `Basic ${auth}` },
          signal: AbortSignal.timeout(4_000),
        });
        const body = await r.json().catch(() => ({}));
        setTestResult(r.ok
          ? { ok: true, host, status: body }
          : { ok: false, host, error: `HTTP ${r.status}` });
      } catch (e) {
        setTestResult({ ok: false, host, error: e.message });
      }
      return;
    }
    setTesting(true); setTestResult(null);
    try {
      const r = await fetch(`${backendUrl}/production/encoders/${initial.id}/test`,
        { method: 'POST', headers });
      setTestResult(await r.json());
    } catch (e) {
      setTestResult({ ok: false, error: e.message });
    } finally {
      setTesting(false);
    }
  }

  function handleConnectionChange({ connectionSource: cs, bridgeInstanceId: bid }) {
    setConnectionSource(cs);
    setBridgeInstanceId(bid ?? '');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="settings-field">
        <label className="settings-field__label">Encoder name *</label>
        <input className="settings-field__input" value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Main encoder" autoFocus />
      </div>

      <div className="settings-field">
        <label className="settings-field__label">Type</label>
        <select className="settings-field__input" value={type}
          onChange={e => setType(e.target.value)}>
          {ENCODER_TYPES.map(et => <option key={et.value} value={et.value}>{et.label}</option>)}
        </select>
      </div>

      {/* Connection config */}
      <div style={{ display: 'flex', gap: 12 }}>
        <div className="settings-field" style={{ flex: 2 }}>
          <label className="settings-field__label">Host (IP)</label>
          <input className="settings-field__input" value={host}
            onChange={e => setHost(e.target.value)}
            placeholder="192.168.1.100" />
        </div>
        <div className="settings-field" style={{ flex: 1 }}>
          <label className="settings-field__label">Protocol</label>
          <select className="settings-field__input" value={protocol}
            onChange={e => setProtocol(e.target.value)}>
            <option value="http">HTTP</option>
            <option value="https">HTTPS</option>
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <div className="settings-field" style={{ flex: 1 }}>
          <label className="settings-field__label">Username</label>
          <input className="settings-field__input" value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="admin" autoComplete="off" />
        </div>
        <div className="settings-field" style={{ flex: 1 }}>
          <label className="settings-field__label">Password</label>
          <input className="settings-field__input" type="password" value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="admin" autoComplete="new-password" />
        </div>
        {type === 'monarch_hdx' && (
          <div className="settings-field" style={{ flex: 1 }}>
            <label className="settings-field__label">Encoder #</label>
            <select className="settings-field__input" value={encoderNumber}
              onChange={e => setEncoderNumber(e.target.value)}>
              <option value="1">Encoder 1</option>
              <option value="2">Encoder 2</option>
            </select>
          </div>
        )}
      </div>

      {/* Unified connection source */}
      <ConnectionSourceSelect
        connectionSource={connectionSource}
        bridgeInstanceId={bridgeInstanceId}
        bridges={bridges}
        onChange={handleConnectionChange}
      />

      {testResult && (
        <div style={{
          padding: '6px 10px', borderRadius: 4, fontSize: 12,
          background: testResult.ok ? 'var(--color-success-bg, #d1fae5)' : 'var(--color-error-bg, #fee2e2)',
          color: testResult.ok ? 'var(--color-success-text, #065f46)' : 'var(--color-error)',
        }}>
          {testResult.ok
            ? `✓ Connected to ${testResult.host}`
            : `✗ ${testResult.error}`}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4, flexWrap: 'wrap' }}>
        <button
          className="btn btn--ghost btn--sm"
          onClick={handleTest}
          disabled={testing}
          style={{ marginRight: 'auto' }}
        >
          {testing ? 'Testing…' : 'Test connection'}
        </button>
        <button className="btn btn--ghost" onClick={onCancel}>Cancel</button>
        <button className="btn btn--primary"
          onClick={() => onSave({
            name: name.trim(),
            type,
            connectionConfig:  buildConnectionConfig(),
            connectionSource,
            bridgeInstanceId:  bridgeInstanceId || null,
          })}
          disabled={!name.trim()}>
          Save
        </button>
      </div>
    </div>
  );
}

// ── Encoder row ────────────────────────────────────────────────────────────

function EncoderRow({ encoder, bridges, onEdit, onDelete }) {
  const typeLabel  = ENCODER_TYPES.find(t => t.value === encoder.type)?.label ?? encoder.type;
  const cfg        = encoder.connectionConfig || {};
  const bridge     = bridges.find(b => b.id === encoder.bridgeInstanceId);

  const connLabel = encoder.connectionSource === 'frontend' ? 'Browser'
    : encoder.connectionSource === 'bridge' && bridge ? `Bridge: ${bridge.name}`
    : encoder.connectionSource === 'bridge' ? 'Bridge'
    : 'Backend';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
      border: '1px solid var(--color-border)', borderRadius: 4,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontWeight: 600 }}>{encoder.name}</span>
        {cfg.host && (
          <span style={{ marginLeft: 8, color: 'var(--color-text-muted)', fontSize: 12 }}>
            {cfg.host}
          </span>
        )}
        <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--color-text-muted)' }}>
          {connLabel}
        </span>
      </div>
      <span style={{
        fontSize: 11, padding: '2px 6px', borderRadius: 3,
        background: 'var(--color-surface-alt)', color: 'var(--color-text-muted)', whiteSpace: 'nowrap',
      }}>{typeLabel}</span>
      <button className="btn btn--sm btn--ghost" onClick={() => onEdit(encoder)}>Edit</button>
      <button className="btn btn--sm btn--ghost btn--danger" onClick={() => onDelete(encoder)}>Delete</button>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export function ProductionEncodersPage() {
  const session    = useContext(SessionContext);
  const params     = new URLSearchParams(window.location.search);
  const backendUrl = params.get('server') || session?.backendUrl || localStorage.getItem(KEYS.session.backendUrl) || '';
  const apiKey     = params.get('apikey') || '';

  const [encoders,      setEncoders]      = useState([]);
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
      const [encRes, bridgeRes] = await Promise.all([
        fetch(`${backendUrl}/production/encoders`,           { headers }),
        fetch(`${backendUrl}/production/bridge/instances`,   { headers }),
      ]);
      if (!encRes.ok)    throw new Error(`encoders: HTTP ${encRes.status}`);
      if (!bridgeRes.ok) throw new Error(`bridges: HTTP ${bridgeRes.status}`);
      setEncoders(await encRes.json());
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
      ? `${backendUrl}/production/encoders`
      : `${backendUrl}/production/encoders/${editing.id}`;
    try {
      const r = await fetch(url, { method: isNew ? 'POST' : 'PUT', headers, body: JSON.stringify(data) });
      if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error(b.error || `HTTP ${r.status}`); }
      setEditing(null);
      fetchAll();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDelete(encoder) {
    try {
      const r = await fetch(`${backendUrl}/production/encoders/${encoder.id}`, { method: 'DELETE', headers });
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
        <h2 style={{ margin: 0, fontSize: 18 }}>Encoders</h2>
        <button className="btn btn--primary btn--sm" onClick={() => setEditing('new')} disabled={!!editing}>
          + Add encoder
        </button>
      </div>

      {error && <div style={{ color: 'var(--color-error)', marginBottom: 12, fontSize: 13 }}>{error}</div>}

      {editing && (
        <div style={{
          border: '1px solid var(--color-border)', borderRadius: 6, padding: 16,
          marginBottom: 16, background: 'var(--color-surface-alt)',
        }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>
            {editing === 'new' ? 'Add encoder' : `Edit: ${editing.name}`}
          </h3>
          <EncoderForm
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
      ) : encoders.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)' }}>No encoders configured yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {encoders.map(enc => (
            <EncoderRow key={enc.id} encoder={enc} bridges={bridges}
              onEdit={e => setEditing(e)} onDelete={e => setConfirmDelete(e)} />
          ))}
        </div>
      )}

      {confirmDelete && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{ background: 'var(--color-surface)', borderRadius: 8, padding: 24, maxWidth: 360, width: '90%' }}>
            <p style={{ margin: '0 0 16px' }}>Delete encoder <strong>{confirmDelete.name}</strong>?</p>
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

// Export the ConnectionSourceSelect for reuse in cameras/mixers pages
export { ConnectionSourceSelect };
