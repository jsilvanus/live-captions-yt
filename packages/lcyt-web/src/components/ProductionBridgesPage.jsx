import { KEYS } from '../lib/storageKeys.js';
import { useState, useEffect, useCallback } from 'react';

function ConnectionDot({ connected }) {
  return (
    <span
      title={connected ? 'Connected' : 'Disconnected'}
      style={{
        display: 'inline-block',
        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
        background: connected ? 'var(--color-success)' : 'var(--color-text-muted)',
        boxShadow: connected ? '0 0 5px var(--color-success)' : 'none',
      }}
    />
  );
}

function AddBridgeForm({ onCreated, onCancel, backendUrl, headers }) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleCreate() {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`${backendUrl}/production/bridge/instances`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      onCreated(data); // { id, name, envContent }
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="settings-field">
        <label className="settings-field__label">Bridge name *</label>
        <input
          className="settings-field__input"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Main church"
          autoFocus
          onKeyDown={e => e.key === 'Enter' && handleCreate()}
        />
      </div>
      {error && <div style={{ color: 'var(--color-error)', fontSize: 13 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn btn--ghost" onClick={onCancel}>Cancel</button>
        <button
          className="btn btn--primary"
          onClick={handleCreate}
          disabled={!name.trim() || saving}
        >{saving ? 'Creating…' : 'Create'}</button>
      </div>
    </div>
  );
}

const BRIDGE_DOWNLOADS = [
  { label: 'Windows (.exe)', file: 'lcyt-bridge.exe' },
  { label: 'macOS',          file: 'lcyt-bridge-mac' },
  { label: 'Linux',          file: 'lcyt-bridge-linux' },
];

function bridgeDownloadUrl(file) {
  return `${window.location.origin}/bridge-downloads/${file}`;
}

/** Shown immediately after creation — displays exe + .env download buttons */
function EnvDownloadBanner({ bridge, onDismiss }) {
  function downloadEnv() {
    const blob = new Blob([bridge.envContent], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `lcyt-bridge-${bridge.name.replace(/\s+/g, '-')}.env`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{
      border: '1px solid var(--color-success)',
      borderRadius: 6,
      padding: 16,
      background: 'var(--color-success-bg, rgba(16,185,129,0.08))',
      marginBottom: 16,
    }}>
      <p style={{ margin: '0 0 10px', fontSize: 14 }}>
        <strong>{bridge.name}</strong> created. Download the app and its configuration file,
        place them in the same folder, then launch the app.
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {BRIDGE_DOWNLOADS.map(({ label, file }) => (
          <a key={file} className="btn btn--ghost btn--sm" href={bridgeDownloadUrl(file)} download={file}>
            ↓ {label}
          </a>
        ))}
        <button className="btn btn--primary btn--sm" onClick={downloadEnv}>
          ↓ Config (.env)
        </button>
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)', marginLeft: 4 }}>
          Keep .env private — it contains your bridge token.
        </span>
        <button className="btn btn--ghost btn--sm" style={{ marginLeft: 'auto' }} onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

function BridgeRow({ bridge, showName, onDelete, onRedownload }) {
  const lastSeen = bridge.lastSeen
    ? new Date(bridge.lastSeen + 'Z').toLocaleString()
    : 'Never';

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '8px 10px',
      border: '1px solid var(--color-border)',
      borderRadius: 4,
    }}>
      <ConnectionDot connected={bridge.status === 'connected'} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {showName && <span style={{ fontWeight: 600, marginRight: 8 }}>{bridge.name}</span>}
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
          {bridge.status === 'connected' ? 'Connected' : `Last seen: ${lastSeen}`}
        </span>
      </div>
      <button
        className="btn btn--sm btn--ghost"
        onClick={() => onRedownload(bridge)}
        title="Re-download .env"
      >↓ .env</button>
      <button
        className="btn btn--sm btn--ghost btn--danger"
        onClick={() => onDelete(bridge)}
      >Delete</button>
    </div>
  );
}

function DeleteConfirmModal({ bridge, cameras, mixers, onConfirm, onCancel }) {
  const hasAssignments = cameras > 0 || mixers > 0;
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{
        background: 'var(--color-surface)', borderRadius: 8, padding: 24,
        maxWidth: 400, width: '90%',
      }}>
        <p style={{ margin: '0 0 8px', fontWeight: 600 }}>
          Delete bridge{bridge.name ? ` "${bridge.name}"` : ''}?
        </p>
        {hasAssignments && (
          <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--color-text-muted)' }}>
            {cameras > 0 && <>{cameras} camera{cameras !== 1 ? 's' : ''}</>}
            {cameras > 0 && mixers > 0 && ' and '}
            {mixers  > 0 && <>{mixers} mixer{mixers !== 1 ? 's' : ''}</>}
            {' '}will lose their bridge assignment.
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn--ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn--danger" onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </div>
  );
}

export function ProductionBridgesPage() {
  const params = new URLSearchParams(window.location.search);
  const backendUrl = params.get('server') || localStorage.getItem(KEYS.session.backendUrl) || '';
  const apiKey     = params.get('apikey') || '';

  const [bridges, setBridges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [newBridge, setNewBridge] = useState(null);     // { id, name, envContent } shown after create
  const [confirmDelete, setConfirmDelete] = useState(null); // { bridge, cameras, mixers }

  const headers = { 'Content-Type': 'application/json', ...(apiKey ? { 'X-Admin-Key': apiKey } : {}) };

  const fetchBridges = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${backendUrl}/production/bridge/instances`, { headers });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setBridges(await r.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [backendUrl, apiKey]);

  useEffect(() => { fetchBridges(); }, [fetchBridges]);

  async function handleCreated(data) {
    setAdding(false);
    setNewBridge(data);
    fetchBridges();
  }

  async function confirmDeleteBridge(bridge) {
    // Count assigned cameras/mixers
    try {
      const r = await fetch(
        `${backendUrl}/production/bridge/instances/${bridge.id}`,
        { method: 'DELETE', headers }
      );
      if (r.status === 409) {
        const body = await r.json();
        setConfirmDelete({ bridge, cameras: body.cameras, mixers: body.mixers });
        return;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      fetchBridges();
    } catch (e) {
      setError(e.message);
    }
  }

  async function forceDelete(bridge) {
    try {
      const r = await fetch(
        `${backendUrl}/production/bridge/instances/${bridge.id}?force=1`,
        { method: 'DELETE', headers }
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setConfirmDelete(null);
      fetchBridges();
    } catch (e) {
      setError(e.message);
    }
  }

  function handleRedownload(bridge) {
    window.open(`${backendUrl}/production/bridge/instances/${bridge.id}/env`, '_blank');
  }

  const showNames = bridges.length >= 2;

  return (
    <div style={{ padding: 20, maxWidth: 700, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16, gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Bridges</h2>
        {!adding && (
          <button className="btn btn--primary btn--sm" onClick={() => setAdding(true)}>
            + Add bridge
          </button>
        )}
      </div>

      {error && (
        <div style={{ color: 'var(--color-error)', marginBottom: 12, fontSize: 13 }}>{error}</div>
      )}

      {newBridge && (
        <EnvDownloadBanner bridge={newBridge} onDismiss={() => setNewBridge(null)} />
      )}

      {adding && (
        <div style={{
          border: '1px solid var(--color-border)', borderRadius: 6,
          padding: 16, marginBottom: 16, background: 'var(--color-surface-alt)',
        }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>Add bridge</h3>
          <AddBridgeForm
            onCreated={handleCreated}
            onCancel={() => setAdding(false)}
            backendUrl={backendUrl}
            headers={headers}
          />
        </div>
      )}

      {loading ? (
        <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p>
      ) : bridges.length === 0 ? (
        <div style={{ fontSize: 14 }}>
          <p style={{ color: 'var(--color-text-muted)' }}>No bridges configured.</p>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
            A bridge is a small program that runs on your streaming computer and relays
            commands to AMX and Roland hardware on the local AV network.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
            {BRIDGE_DOWNLOADS.map(({ label, file }) => (
              <a key={file} className="btn btn--ghost btn--sm" href={bridgeDownloadUrl(file)} download={file}>
                ↓ {label}
              </a>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {bridges.map(b => (
            <BridgeRow
              key={b.id}
              bridge={b}
              showName={showNames}
              onDelete={confirmDeleteBridge}
              onRedownload={handleRedownload}
            />
          ))}
        </div>
      )}

      {confirmDelete && (
        <DeleteConfirmModal
          bridge={confirmDelete.bridge}
          cameras={confirmDelete.cameras}
          mixers={confirmDelete.mixers}
          onConfirm={() => forceDelete(confirmDelete.bridge)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
