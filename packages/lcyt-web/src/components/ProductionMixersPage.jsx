import { useState, useEffect, useCallback } from 'react';

const MIXER_TYPES = [
  { value: 'roland', label: 'Roland V-series' },
];

function ConnectionDot({ connected }) {
  return (
    <span
      title={connected ? 'Connected' : 'Disconnected'}
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: connected ? 'var(--color-success)' : 'var(--color-text-muted)',
        boxShadow: connected ? '0 0 5px var(--color-success)' : 'none',
        flexShrink: 0,
      }}
    />
  );
}

function MixerForm({ initial, onSave, onCancel, backendUrl, headers }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState(initial?.type ?? 'roland');
  const [host, setHost] = useState(initial?.connectionConfig?.host ?? '');
  const [port, setPort] = useState(initial?.connectionConfig?.port ?? 8023);
  const [testResult, setTestResult] = useState(null);   // null | { ok, error?, host, port }
  const [testing, setTesting] = useState(false);

  function buildConnectionConfig() {
    return { host, port: Number(port) };
  }

  async function handleTest() {
    if (!initial?.id) {
      setTestResult({ ok: false, error: 'Save the mixer first to test its connection.' });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const r = await fetch(`${backendUrl}/production/mixers/${initial.id}/test`, {
        method: 'POST',
        headers,
      });
      setTestResult(await r.json());
    } catch (e) {
      setTestResult({ ok: false, error: e.message });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="settings-field">
        <label className="settings-field__label">Mixer name *</label>
        <input
          className="settings-field__input"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Main switcher"
          autoFocus
        />
      </div>

      <div className="settings-field">
        <label className="settings-field__label">Type</label>
        <select
          className="settings-field__input"
          value={type}
          onChange={e => setType(e.target.value)}
        >
          {MIXER_TYPES.map(mt => (
            <option key={mt.value} value={mt.value}>{mt.label}</option>
          ))}
        </select>
      </div>

      {type === 'roland' && (
        <div style={{ display: 'flex', gap: 12 }}>
          <div className="settings-field" style={{ flex: 2 }}>
            <label className="settings-field__label">Host (IP)</label>
            <input
              className="settings-field__input"
              value={host}
              onChange={e => setHost(e.target.value)}
              placeholder="192.168.2.100"
            />
          </div>
          <div className="settings-field" style={{ flex: 1 }}>
            <label className="settings-field__label">TCP port</label>
            <input
              className="settings-field__input"
              type="number"
              value={port}
              onChange={e => setPort(e.target.value)}
              placeholder="8023"
            />
          </div>
        </div>
      )}

      {testResult && (
        <div style={{
          padding: '6px 10px',
          borderRadius: 4,
          fontSize: 12,
          background: testResult.ok ? 'var(--color-success-bg, #d1fae5)' : 'var(--color-error-bg, #fee2e2)',
          color: testResult.ok ? 'var(--color-success-text, #065f46)' : 'var(--color-error)',
        }}>
          {testResult.ok
            ? `✓ Connected to ${testResult.host}:${testResult.port}`
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
        <button
          className="btn btn--primary"
          onClick={() => onSave({ name: name.trim(), type, connectionConfig: buildConnectionConfig() })}
          disabled={!name.trim()}
        >Save</button>
      </div>
    </div>
  );
}

function MixerRow({ mixer, onEdit, onDelete }) {
  const typeLabel = MIXER_TYPES.find(t => t.value === mixer.type)?.label ?? mixer.type;
  const cfg = mixer.connectionConfig || {};

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '8px 10px',
      border: '1px solid var(--color-border)',
      borderRadius: 4,
    }}>
      <ConnectionDot connected={mixer.connected} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontWeight: 600 }}>{mixer.name}</span>
        {cfg.host && (
          <span style={{ marginLeft: 8, color: 'var(--color-text-muted)', fontSize: 12 }}>
            {cfg.host}:{cfg.port ?? 8023}
          </span>
        )}
      </div>
      <span style={{
        fontSize: 11,
        padding: '2px 6px',
        borderRadius: 3,
        background: 'var(--color-surface-alt)',
        color: 'var(--color-text-muted)',
        whiteSpace: 'nowrap',
      }}>{typeLabel}</span>
      {mixer.activeSource != null && (
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
          PGM: {mixer.activeSource}
        </span>
      )}
      <button className="btn btn--sm btn--ghost" onClick={() => onEdit(mixer)}>Edit</button>
      <button className="btn btn--sm btn--ghost btn--danger" onClick={() => onDelete(mixer)}>Delete</button>
    </div>
  );
}

export function ProductionMixersPage() {
  const params = new URLSearchParams(window.location.search);
  const backendUrl = params.get('server') || localStorage.getItem('lcyt-backend-url') || '';
  const apiKey = params.get('apikey') || '';

  const [mixers, setMixers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const headers = { 'Content-Type': 'application/json', ...(apiKey ? { 'X-Admin-Key': apiKey } : {}) };

  const fetchMixers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${backendUrl}/production/mixers`, { headers });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setMixers(await r.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [backendUrl, apiKey]);

  useEffect(() => { fetchMixers(); }, [fetchMixers]);

  async function handleSave(data) {
    const isNew = editing === 'new';
    const url = isNew
      ? `${backendUrl}/production/mixers`
      : `${backendUrl}/production/mixers/${editing.id}`;
    try {
      const r = await fetch(url, {
        method: isNew ? 'POST' : 'PUT',
        headers,
        body: JSON.stringify(data),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${r.status}`);
      }
      setEditing(null);
      fetchMixers();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDelete(mixer) {
    try {
      const r = await fetch(`${backendUrl}/production/mixers/${mixer.id}`, {
        method: 'DELETE',
        headers,
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setConfirmDelete(null);
      fetchMixers();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div style={{ padding: 20, maxWidth: 700, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16, gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Mixers</h2>
        <button
          className="btn btn--primary btn--sm"
          onClick={() => setEditing('new')}
          disabled={!!editing}
        >+ Add mixer</button>
      </div>

      {error && (
        <div style={{ color: 'var(--color-error)', marginBottom: 12, fontSize: 13 }}>{error}</div>
      )}

      {editing && (
        <div style={{
          border: '1px solid var(--color-border)',
          borderRadius: 6,
          padding: 16,
          marginBottom: 16,
          background: 'var(--color-surface-alt)',
        }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>
            {editing === 'new' ? 'Add mixer' : `Edit: ${editing.name}`}
          </h3>
          <MixerForm
            initial={editing === 'new' ? null : editing}
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
            <MixerRow
              key={m.id}
              mixer={m}
              onEdit={mx => setEditing(mx)}
              onDelete={mx => setConfirmDelete(mx)}
            />
          ))}
        </div>
      )}

      {confirmDelete && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{
            background: 'var(--color-surface)', borderRadius: 8, padding: 24,
            maxWidth: 360, width: '90%',
          }}>
            <p style={{ margin: '0 0 16px' }}>
              Delete mixer <strong>{confirmDelete.name}</strong>?
            </p>
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
