import { useCallback, useEffect, useMemo, useState } from 'react';
import { useUserAuth } from '../hooks/useUserAuth';
import { adminFetch } from '../lib/admin.js';
import { AdminKeyGate } from './AdminKeyGate.jsx';
import { AdminTabShell } from './AdminTabShell.jsx';
import { ConfirmDialog } from './ConfirmDialog.jsx';

const CATEGORY_LABELS = {
  bootstrap: 'Bootstrap (env-only)',
  application: 'Application',
  contact: 'Contact',
  retention: 'Sessions & Retention',
  media: 'Media Pipeline',
  mediamtx: 'MediaMTX',
  compute: 'Compute',
  storage: 'Storage',
  graphics: 'Graphics / DSK',
  stt: 'Speech-to-Text',
  ai: 'AI / Embeddings',
  music: 'Music Detection',
  metrics: 'Metrics',
  production: 'Production Control',
};

const APPLY_LABELS = {
  hot: 'Takes effect immediately',
  timer: 'Takes effect on next timer tick',
  manager: 'May require a manager restart',
  restart: 'Requires a server restart',
};

/**
 * AdminServerSettingsPage — `/admin/server-settings` (plan_env_to_ui_settings.md).
 * Env → DB-backed admin settings: every Tier B entry from the backend's
 * settings registry, editable here; Tier A (bootstrap/secrets/executed
 * values) shown read-only at the bottom so an admin can see the *entire*
 * effective configuration in one place, even the part it can't change.
 */
export function AdminServerSettingsPage() {
  const { user, backendUrl } = useUserAuth();

  return (
    <AdminKeyGate backendUrl={backendUrl} userIsAdmin={!!user?.isAdmin}>
      <AdminTabShell active="server-settings">
        <AdminServerSettingsContent backendUrl={backendUrl} />
      </AdminTabShell>
    </AdminKeyGate>
  );
}

function AdminServerSettingsContent({ backendUrl }) {
  const [categories, setCategories] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pendingConfirm, setPendingConfirm] = useState(null); // { entry, value }

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await adminFetch(backendUrl, '/admin/server-settings');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCategories(data.categories || {});
    } catch {
      setError('Server settings are not available on this backend yet.');
    } finally {
      setLoading(false);
    }
  }, [backendUrl]);

  useEffect(() => { load(); }, [load]);

  const restartPendingKeys = useMemo(() => {
    const keys = [];
    for (const entries of Object.values(categories)) {
      for (const e of entries) if (e.pendingRestart) keys.push(e.key);
    }
    return keys;
  }, [categories]);

  async function saveOne(key, value) {
    const res = await adminFetch(backendUrl, '/admin/server-settings', {
      method: 'PUT',
      body: JSON.stringify({ values: { [key]: value } }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    setCategories(prev => {
      const next = { ...prev };
      for (const cat of Object.keys(next)) {
        next[cat] = next[cat].map(e => body.snapshot.find(s => s.key === e.key) || e);
      }
      return next;
    });
  }

  async function clearOne(key) {
    const res = await adminFetch(backendUrl, `/admin/server-settings/${key}`, { method: 'DELETE' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    setCategories(prev => {
      const next = { ...prev };
      for (const cat of Object.keys(next)) {
        next[cat] = next[cat].map(e => (e.key === key ? { ...e, ...body } : e));
      }
      return next;
    });
  }

  function handleChange(entry, value) {
    if (entry.confirm && entry.type === 'bool' && value === false) {
      setPendingConfirm({ entry, value });
      return;
    }
    saveOne(entry.key, value).catch(err => setError(err.message));
  }

  const uiCategories = Object.keys(categories).filter(c => c !== 'bootstrap');
  const bootstrapEntries = categories.bootstrap || [];

  return (
    <div style={{ padding: '20px 28px' }}>
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 16 }}>
        Server-level configuration, editable here instead of the environment.
        A setting set via the environment always wins and shows as
        <strong> env-locked</strong> — unset it in the deployment's env to take UI control.
      </p>

      {error && <div style={{ color: 'var(--color-error)', fontSize: 13, marginBottom: 16 }}>{error}</div>}

      {restartPendingKeys.length > 0 && (
        <div style={{
          background: 'var(--color-warning-bg, #4a3a1a)', color: 'var(--color-warning-text, #ffd27a)',
          padding: '10px 14px', borderRadius: 6, fontSize: 13, marginBottom: 20,
        }}>
          Restart required for: {restartPendingKeys.join(', ')} — these values won't take
          effect until the server process restarts.
        </div>
      )}

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Loading…</div>
      ) : (
        <>
          {uiCategories.map(cat => (
            <CategorySection
              key={cat}
              title={CATEGORY_LABELS[cat] || cat}
              entries={categories[cat]}
              onChange={handleChange}
              onClear={key => clearOne(key).catch(err => setError(err.message))}
            />
          ))}

          {bootstrapEntries.length > 0 && (
            <CategorySection
              title={CATEGORY_LABELS.bootstrap}
              entries={bootstrapEntries}
              readOnly
            />
          )}
        </>
      )}

      <ConfirmDialog
        open={!!pendingConfirm}
        title="Disable user logins?"
        message={pendingConfirm ? `${pendingConfirm.entry.description} Continue?` : ''}
        confirmLabel="Disable"
        danger
        onConfirm={() => {
          const { entry, value } = pendingConfirm;
          setPendingConfirm(null);
          saveOne(entry.key, value).catch(err => setError(err.message));
        }}
        onCancel={() => setPendingConfirm(null)}
      />
    </div>
  );
}

function CategorySection({ title, entries, onChange, onClear, readOnly = false }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h3 style={{ fontSize: 14, marginBottom: 10 }}>{title}</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {entries.map(entry => (
          <SettingRow
            key={entry.key}
            entry={entry}
            readOnly={readOnly}
            onChange={value => onChange?.(entry, value)}
            onClear={() => onClear?.(entry.key)}
          />
        ))}
      </div>
    </section>
  );
}

function SourceBadge({ entry }) {
  const label = entry.source === 'env' ? `Env-locked (${entry.env})`
    : entry.source === 'db' ? 'Saved'
    : 'Default';
  const color = entry.source === 'env' ? 'var(--color-text-muted)'
    : entry.source === 'db' ? 'var(--color-accent, #6aa9ff)'
    : 'var(--color-text-muted)';
  return <span style={{ fontSize: 11, color, marginLeft: 8 }}>{label}</span>;
}

function SettingRow({ entry, readOnly, onChange, onClear }) {
  const [draft, setDraft] = useState(() => (entry.type === 'csv' ? (entry.value || []).join(', ') : entry.value));
  const [editingSecret, setEditingSecret] = useState(false);
  const locked = readOnly || entry.source === 'env';

  useEffect(() => {
    setDraft(entry.type === 'csv' ? (entry.value || []).join(', ') : entry.value);
  }, [entry.value, entry.type]);

  const label = entry.key.split('.').slice(1).join('.') || entry.key;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 4,
      padding: '10px 12px', borderRadius: 6, background: 'var(--color-surface-2, rgba(255,255,255,0.03))',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <strong style={{ fontSize: 13 }}>{label}</strong>
          <SourceBadge entry={entry} />
          {!readOnly && entry.apply && entry.apply !== 'hot' && (
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginLeft: 8 }}>
              ({APPLY_LABELS[entry.apply]})
            </span>
          )}
        </div>
        {!readOnly && entry.source === 'db' && (
          <button className="btn-link" onClick={onClear} style={{ fontSize: 11 }}>Revert to default</button>
        )}
      </div>
      {entry.description && (
        <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>{entry.description}</div>
      )}

      {entry.secret ? (
        <SecretField
          entry={entry}
          locked={locked}
          editing={editingSecret}
          onStartEdit={() => setEditingSecret(true)}
          onCancel={() => setEditingSecret(false)}
          onSave={(v) => { setEditingSecret(false); onChange(v); }}
          onClear={onClear}
        />
      ) : locked ? (
        <div style={{ fontSize: 13, opacity: 0.7 }}>{formatReadOnlyValue(entry)}</div>
      ) : entry.type === 'bool' ? (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={!!entry.value}
            onChange={e => onChange(e.target.checked)}
          />
          {entry.value ? 'Enabled' : 'Disabled'}
        </label>
      ) : entry.type === 'enum' ? (
        <select value={entry.value ?? ''} onChange={e => onChange(e.target.value)} style={{ fontSize: 13 }}>
          {(entry.enum || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      ) : entry.type === 'int' ? (
        <input
          type="number"
          value={draft ?? ''}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => { const n = Number(draft); if (Number.isFinite(n) && n !== entry.value) onChange(n); }}
          style={{ fontSize: 13, width: 160 }}
        />
      ) : entry.type === 'csv' ? (
        <input
          type="text"
          value={draft ?? ''}
          placeholder="comma,separated,values"
          onChange={e => setDraft(e.target.value)}
          onBlur={() => {
            const arr = draft === '' ? [] : draft.split(',').map(s => s.trim()).filter(Boolean);
            onChange(arr);
          }}
          style={{ fontSize: 13, width: '100%' }}
        />
      ) : (
        <input
          type="text"
          value={draft ?? ''}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => { if (draft !== entry.value) onChange(draft); }}
          style={{ fontSize: 13, width: '100%' }}
        />
      )}
    </div>
  );
}

function formatReadOnlyValue(entry) {
  if (entry.secret) return entry.value ? 'set' : 'not set';
  if (Array.isArray(entry.value)) return entry.value.join(', ') || '(empty)';
  if (entry.value === '' || entry.value == null) return '(unset)';
  return String(entry.value);
}

function SecretField({ entry, locked, editing, onStartEdit, onCancel, onSave, onClear }) {
  const [draft, setDraft] = useState('');
  const isSet = entry.value === '***';

  if (locked) {
    return <div style={{ fontSize: 13, opacity: 0.7 }}>{isSet ? 'set' : 'not set'}</div>;
  }

  if (!editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 13, opacity: 0.7 }}>{isSet ? 'set' : 'not set'}</span>
        <button className="btn-link" style={{ fontSize: 12 }} onClick={onStartEdit}>Replace</button>
        {entry.source === 'db' && (
          <button className="btn-link" style={{ fontSize: 12 }} onClick={onClear}>Clear</button>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <input
        type="password"
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        placeholder="new value"
        style={{ fontSize: 13, width: '100%' }}
      />
      <button className="btn-link" style={{ fontSize: 12 }} onClick={() => onSave(draft)} disabled={!draft}>Save</button>
      <button className="btn-link" style={{ fontSize: 12 }} onClick={() => { setDraft(''); onCancel(); }}>Cancel</button>
    </div>
  );
}
