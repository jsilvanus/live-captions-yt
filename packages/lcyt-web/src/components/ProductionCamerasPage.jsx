import { useState, useEffect, useCallback } from 'react';

const CONTROL_TYPES = [
  { value: 'none', label: 'None (mixer only)' },
  { value: 'amx',  label: 'AMX NetLinx' },
];

const EMPTY_PRESET = () => ({ id: crypto.randomUUID(), name: '', command: '' });

function PresetRow({ preset, onChange, onRemove }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
      <input
        className="settings-field__input"
        placeholder="Preset name (e.g. Wide)"
        value={preset.name}
        onChange={e => onChange({ ...preset, name: e.target.value })}
        style={{ width: 140 }}
      />
      <input
        className="settings-field__input"
        placeholder="AMX command (e.g. SEND_COMMAND dvCam,'PRESET-1')"
        value={preset.command}
        onChange={e => onChange({ ...preset, command: e.target.value })}
        style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }}
      />
      <button
        className="btn btn--sm btn--ghost"
        onClick={onRemove}
        title="Remove preset"
        style={{ flexShrink: 0 }}
      >✕</button>
    </div>
  );
}

function CameraForm({ initial, onSave, onCancel }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [mixerInput, setMixerInput] = useState(initial?.mixerInput ?? '');
  const [controlType, setControlType] = useState(initial?.controlType ?? 'none');
  const [host, setHost] = useState(initial?.controlConfig?.host ?? '');
  const [port, setPort] = useState(initial?.controlConfig?.port ?? 1319);
  const [presets, setPresets] = useState(
    initial?.controlConfig?.presets?.map(p => ({ ...p, id: p.id || crypto.randomUUID() })) ?? []
  );
  const [sortOrder, setSortOrder] = useState(initial?.sortOrder ?? 0);

  function buildControlConfig() {
    if (controlType === 'amx') {
      return { host, port: Number(port), presets: presets.map(({ id, name, command }) => ({ id, name, command })) };
    }
    return {};
  }

  function handleSave() {
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      mixerInput: mixerInput !== '' ? Number(mixerInput) : null,
      controlType,
      controlConfig: buildControlConfig(),
      sortOrder: Number(sortOrder),
    });
  }

  function updatePreset(idx, updated) {
    setPresets(prev => prev.map((p, i) => i === idx ? updated : p));
  }
  function removePreset(idx) {
    setPresets(prev => prev.filter((_, i) => i !== idx));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="settings-field">
        <label className="settings-field__label">Camera name *</label>
        <input
          className="settings-field__input"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Altar"
          autoFocus
        />
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <div className="settings-field" style={{ flex: 1 }}>
          <label className="settings-field__label">Mixer input #</label>
          <input
            className="settings-field__input"
            type="number"
            min={1}
            value={mixerInput}
            onChange={e => setMixerInput(e.target.value)}
            placeholder="e.g. 1"
          />
        </div>
        <div className="settings-field" style={{ flex: 1 }}>
          <label className="settings-field__label">Sort order</label>
          <input
            className="settings-field__input"
            type="number"
            value={sortOrder}
            onChange={e => setSortOrder(e.target.value)}
          />
        </div>
      </div>

      <div className="settings-field">
        <label className="settings-field__label">Control type</label>
        <select
          className="settings-field__input"
          value={controlType}
          onChange={e => setControlType(e.target.value)}
        >
          {CONTROL_TYPES.map(ct => (
            <option key={ct.value} value={ct.value}>{ct.label}</option>
          ))}
        </select>
      </div>

      {controlType === 'amx' && (
        <>
          <div style={{ display: 'flex', gap: 12 }}>
            <div className="settings-field" style={{ flex: 2 }}>
              <label className="settings-field__label">AMX host (IP)</label>
              <input
                className="settings-field__input"
                value={host}
                onChange={e => setHost(e.target.value)}
                placeholder="192.168.2.50"
              />
            </div>
            <div className="settings-field" style={{ flex: 1 }}>
              <label className="settings-field__label">TCP port</label>
              <input
                className="settings-field__input"
                type="number"
                value={port}
                onChange={e => setPort(e.target.value)}
                placeholder="1319"
              />
            </div>
          </div>

          <div className="settings-field">
            <label className="settings-field__label">
              Presets
              <button
                className="btn btn--sm btn--ghost"
                style={{ marginLeft: 8 }}
                onClick={() => setPresets(prev => [...prev, EMPTY_PRESET()])}
              >+ Add preset</button>
            </label>
            {presets.length === 0 && (
              <p style={{ color: 'var(--color-text-muted)', fontSize: 12, margin: '4px 0' }}>
                No presets. Click "Add preset" to add one.
              </p>
            )}
            {presets.map((p, i) => (
              <PresetRow
                key={p.id}
                preset={p}
                onChange={updated => updatePreset(i, updated)}
                onRemove={() => removePreset(i)}
              />
            ))}
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
        <button className="btn btn--ghost" onClick={onCancel}>Cancel</button>
        <button
          className="btn btn--primary"
          onClick={handleSave}
          disabled={!name.trim()}
        >Save</button>
      </div>
    </div>
  );
}

function CameraRow({ camera, onEdit, onDelete }) {
  const presetCount = camera.controlConfig?.presets?.length ?? 0;
  const typeBadge = CONTROL_TYPES.find(ct => ct.value === camera.controlType)?.label ?? camera.controlType;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '8px 10px',
      border: '1px solid var(--color-border)',
      borderRadius: 4,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontWeight: 600 }}>{camera.name}</span>
        {camera.mixerInput != null && (
          <span style={{ marginLeft: 8, color: 'var(--color-text-muted)', fontSize: 12 }}>
            Input {camera.mixerInput}
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
      }}>{typeBadge}</span>
      {camera.controlType !== 'none' && (
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
          {presetCount} preset{presetCount !== 1 ? 's' : ''}
        </span>
      )}
      <button className="btn btn--sm btn--ghost" onClick={() => onEdit(camera)}>Edit</button>
      <button className="btn btn--sm btn--ghost btn--danger" onClick={() => onDelete(camera)}>Delete</button>
    </div>
  );
}

export function ProductionCamerasPage() {
  const params = new URLSearchParams(window.location.search);
  const backendUrl = params.get('server') || localStorage.getItem('lcyt-backend-url') || '';
  const apiKey = params.get('apikey') || '';

  const [cameras, setCameras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);   // null | 'new' | camera object
  const [confirmDelete, setConfirmDelete] = useState(null);

  const headers = { 'Content-Type': 'application/json', ...(apiKey ? { 'X-Admin-Key': apiKey } : {}) };

  const fetchCameras = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${backendUrl}/production/cameras`, { headers });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setCameras(await r.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [backendUrl, apiKey]);

  useEffect(() => { fetchCameras(); }, [fetchCameras]);

  async function handleSave(data) {
    const isNew = editing === 'new';
    const url = isNew
      ? `${backendUrl}/production/cameras`
      : `${backendUrl}/production/cameras/${editing.id}`;
    try {
      const r = await fetch(url, {
        method: isNew ? 'POST' : 'PUT',
        headers,
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setEditing(null);
      fetchCameras();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDelete(camera) {
    try {
      const r = await fetch(`${backendUrl}/production/cameras/${camera.id}`, {
        method: 'DELETE',
        headers,
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setConfirmDelete(null);
      fetchCameras();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div style={{ padding: 20, maxWidth: 700, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16, gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Cameras</h2>
        <button
          className="btn btn--primary btn--sm"
          onClick={() => setEditing('new')}
          disabled={!!editing}
        >+ Add camera</button>
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
            {editing === 'new' ? 'Add camera' : `Edit: ${editing.name}`}
          </h3>
          <CameraForm
            initial={editing === 'new' ? null : editing}
            onSave={handleSave}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}

      {loading ? (
        <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p>
      ) : cameras.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)' }}>No cameras configured yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {cameras.map(cam => (
            <CameraRow
              key={cam.id}
              camera={cam}
              onEdit={c => setEditing(c)}
              onDelete={c => setConfirmDelete(c)}
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
              Delete camera <strong>{confirmDelete.name}</strong>?
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
