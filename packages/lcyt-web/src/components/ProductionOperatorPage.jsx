import { useState, useEffect, useCallback } from 'react';

const PRESET_STATE = {
  idle:    'idle',
  pending: 'pending',
  ok:      'ok',
  error:   'error',
};

function PresetButton({ preset, state, onClick }) {
  const colors = {
    [PRESET_STATE.idle]:    { bg: 'var(--color-surface-alt)', border: 'var(--color-border)', text: 'var(--color-text)' },
    [PRESET_STATE.pending]: { bg: 'var(--color-surface-alt)', border: 'var(--color-border)', text: 'var(--color-text-muted)' },
    [PRESET_STATE.ok]:      { bg: 'var(--color-success)',     border: 'var(--color-success)', text: '#fff' },
    [PRESET_STATE.error]:   { bg: 'var(--color-error)',       border: 'var(--color-error)',   text: '#fff' },
  };
  const c = colors[state] ?? colors[PRESET_STATE.idle];

  return (
    <button
      disabled={state === PRESET_STATE.pending}
      onClick={onClick}
      style={{
        padding: '10px 14px',
        borderRadius: 6,
        border: `2px solid ${c.border}`,
        background: c.bg,
        color: c.text,
        fontSize: 14,
        fontWeight: 500,
        cursor: state === PRESET_STATE.pending ? 'wait' : 'pointer',
        transition: 'background 0.2s, border-color 0.2s',
        minWidth: 80,
      }}
    >
      {state === PRESET_STATE.pending ? '…' : preset.name}
    </button>
  );
}

function CameraCard({ camera, backendUrl, headers }) {
  // Map of presetId → PRESET_STATE
  const [presetStates, setPresetStates] = useState({});

  const presets = camera.controlConfig?.presets ?? [];
  const hasPresets = camera.controlType !== 'none' && presets.length > 0;

  async function triggerPreset(presetId) {
    setPresetStates(prev => ({ ...prev, [presetId]: PRESET_STATE.pending }));
    try {
      const r = await fetch(
        `${backendUrl}/production/cameras/${camera.id}/preset/${encodeURIComponent(presetId)}`,
        { method: 'POST', headers }
      );
      const nextState = r.ok ? PRESET_STATE.ok : PRESET_STATE.error;
      setPresetStates(prev => ({ ...prev, [presetId]: nextState }));
      // Reset to idle after brief feedback
      setTimeout(() => {
        setPresetStates(prev => ({ ...prev, [presetId]: PRESET_STATE.idle }));
      }, 1500);
    } catch {
      setPresetStates(prev => ({ ...prev, [presetId]: PRESET_STATE.error }));
      setTimeout(() => {
        setPresetStates(prev => ({ ...prev, [presetId]: PRESET_STATE.idle }));
      }, 2000);
    }
  }

  return (
    <div style={{
      border: '1px solid var(--color-border)',
      borderRadius: 8,
      padding: 16,
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      background: 'var(--color-surface)',
      minWidth: 180,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 15 }}>{camera.name}</span>
        {camera.mixerInput != null && (
          <span style={{
            fontSize: 11,
            padding: '2px 6px',
            borderRadius: 3,
            background: 'var(--color-surface-alt)',
            color: 'var(--color-text-muted)',
          }}>
            In {camera.mixerInput}
          </span>
        )}
      </div>

      {hasPresets ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {presets.map(preset => (
            <PresetButton
              key={preset.id}
              preset={preset}
              state={presetStates[preset.id] ?? PRESET_STATE.idle}
              onClick={() => triggerPreset(preset.id)}
            />
          ))}
        </div>
      ) : (
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
          {camera.controlType === 'none' ? 'Mixer input only' : 'No presets configured'}
        </span>
      )}
    </div>
  );
}

export function ProductionOperatorPage() {
  const params = new URLSearchParams(window.location.search);
  const backendUrl = params.get('server') || localStorage.getItem('lcyt-backend-url') || '';
  const apiKey = params.get('apikey') || '';
  const token = params.get('token') || localStorage.getItem('lcyt-token') || '';

  const [cameras, setCameras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const headers = {
    'Content-Type': 'application/json',
    ...(token    ? { Authorization: `Bearer ${token}` } : {}),
    ...(apiKey   ? { 'X-Admin-Key': apiKey } : {}),
  };

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
  }, [backendUrl, apiKey, token]);

  useEffect(() => { fetchCameras(); }, [fetchCameras]);

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>Production Control</h2>
        <button className="btn btn--ghost btn--sm" onClick={fetchCameras} title="Refresh">↺</button>
      </div>

      {error && (
        <div style={{ color: 'var(--color-error)', marginBottom: 12, fontSize: 13 }}>{error}</div>
      )}

      {loading ? (
        <p style={{ color: 'var(--color-text-muted)' }}>Loading cameras…</p>
      ) : cameras.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)' }}>
          No cameras configured. Add cameras in the camera configuration page.
        </p>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 12,
        }}>
          {cameras.map(cam => (
            <CameraCard
              key={cam.id}
              camera={cam}
              backendUrl={backendUrl}
              headers={headers}
            />
          ))}
        </div>
      )}
    </div>
  );
}
