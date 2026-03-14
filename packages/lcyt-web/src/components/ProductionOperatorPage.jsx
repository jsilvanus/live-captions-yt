import { useState, useEffect, useCallback, useRef } from 'react';

const PRESET_STATE = {
  idle:    'idle',
  pending: 'pending',
  ok:      'ok',
  error:   'error',
};

// ---------------------------------------------------------------------------
// Preset button
// ---------------------------------------------------------------------------

function PresetButton({ preset, state, onClick }) {
  const styles = {
    [PRESET_STATE.idle]:    { bg: 'var(--color-surface-alt)', border: 'var(--color-border)',    text: 'var(--color-text)' },
    [PRESET_STATE.pending]: { bg: 'var(--color-surface-alt)', border: 'var(--color-border)',    text: 'var(--color-text-muted)' },
    [PRESET_STATE.ok]:      { bg: 'var(--color-success)',     border: 'var(--color-success)',   text: '#fff' },
    [PRESET_STATE.error]:   { bg: 'var(--color-error)',       border: 'var(--color-error)',     text: '#fff' },
  };
  const s = styles[state] ?? styles[PRESET_STATE.idle];

  return (
    <button
      disabled={state === PRESET_STATE.pending}
      onClick={onClick}
      style={{
        padding: '10px 14px',
        borderRadius: 6,
        border: `2px solid ${s.border}`,
        background: s.bg,
        color: s.text,
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

// ---------------------------------------------------------------------------
// Camera card
// ---------------------------------------------------------------------------

function CameraCard({ camera, isLive, quickCutEnabled, backendUrl, headers, onCutToCamera }) {
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
      const next = r.ok ? PRESET_STATE.ok : PRESET_STATE.error;
      setPresetStates(prev => ({ ...prev, [presetId]: next }));
      setTimeout(() => setPresetStates(prev => ({ ...prev, [presetId]: PRESET_STATE.idle })), 1500);
    } catch {
      setPresetStates(prev => ({ ...prev, [presetId]: PRESET_STATE.error }));
      setTimeout(() => setPresetStates(prev => ({ ...prev, [presetId]: PRESET_STATE.idle })), 2000);
    }
  }

  function handleCardClick() {
    if (quickCutEnabled && camera.mixerInput != null) {
      onCutToCamera(camera);
    }
  }

  return (
    <div
      onClick={quickCutEnabled && camera.mixerInput != null ? handleCardClick : undefined}
      style={{
        border: `2px solid ${isLive ? 'var(--color-error)' : 'var(--color-border)'}`,
        borderRadius: 8,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        background: isLive ? 'var(--color-error-bg, rgba(239,68,68,0.08))' : 'var(--color-surface)',
        cursor: quickCutEnabled && camera.mixerInput != null ? 'pointer' : 'default',
        transition: 'border-color 0.15s, background 0.15s',
        minWidth: 180,
        position: 'relative',
      }}
    >
      {/* Header row: name + LIVE badge + mixer input */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, fontSize: 15, flex: 1 }}>{camera.name}</span>
        {isLive && (
          <span style={{
            fontSize: 11,
            fontWeight: 700,
            padding: '2px 7px',
            borderRadius: 3,
            background: 'var(--color-error)',
            color: '#fff',
            letterSpacing: '0.05em',
          }}>LIVE</span>
        )}
        {camera.mixerInput != null && !isLive && (
          <span style={{
            fontSize: 11,
            padding: '2px 6px',
            borderRadius: 3,
            background: 'var(--color-surface-alt)',
            color: 'var(--color-text-muted)',
          }}>In {camera.mixerInput}</span>
        )}
      </div>

      {hasPresets ? (
        <div
          onClick={e => e.stopPropagation()}  // prevent card click when clicking preset buttons
          style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}
        >
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

      {/* Quick-cut hint */}
      {quickCutEnabled && camera.mixerInput != null && !isLive && (
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: -4 }}>
          Tap card to cut
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mixer status bar
// ---------------------------------------------------------------------------

function MixerStatusBar({ mixers, onManualSwitch }) {
  if (mixers.length === 0) return null;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      padding: '8px 12px',
      borderRadius: 6,
      border: '1px solid var(--color-border)',
      background: 'var(--color-surface)',
      flexWrap: 'wrap',
      marginBottom: 16,
    }}>
      {mixers.map(m => (
        <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
              background: m.connected ? 'var(--color-success)' : 'var(--color-text-muted)',
              boxShadow: m.connected ? '0 0 5px var(--color-success)' : 'none',
            }}
          />
          <span style={{ fontSize: 13 }}>
            {mixers.length > 1 ? `${m.name}: ` : ''}
            {m.connected
              ? m.activeSource != null
                ? <><strong>PGM {m.activeSource}</strong></>
                : 'Connected'
              : <span style={{ color: 'var(--color-text-muted)' }}>Disconnected</span>
            }
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function ProductionOperatorPage() {
  const params = new URLSearchParams(window.location.search);
  const backendUrl = params.get('server') || localStorage.getItem('lcyt-backend-url') || '';
  const apiKey = params.get('apikey') || '';
  const token = params.get('token') || localStorage.getItem('lcyt-token') || '';

  const [cameras, setCameras] = useState([]);
  const [mixers, setMixers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [quickCut, setQuickCut] = useState(false);
  const [switching, setSwitching] = useState(false);

  // Poll mixer active source every 5 s so the LIVE badge stays accurate
  const pollRef = useRef(null);

  const headers = {
    'Content-Type': 'application/json',
    ...(token  ? { Authorization: `Bearer ${token}` } : {}),
    ...(apiKey ? { 'X-Admin-Key': apiKey } : {}),
  };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [camRes, mixRes] = await Promise.all([
        fetch(`${backendUrl}/production/cameras`, { headers }),
        fetch(`${backendUrl}/production/mixers`,  { headers }),
      ]);
      if (!camRes.ok) throw new Error(`cameras: HTTP ${camRes.status}`);
      if (!mixRes.ok) throw new Error(`mixers: HTTP ${mixRes.status}`);
      setCameras(await camRes.json());
      setMixers(await mixRes.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [backendUrl, apiKey, token]);

  async function pollMixers() {
    if (!backendUrl) return;
    try {
      const r = await fetch(`${backendUrl}/production/mixers`, { headers });
      if (r.ok) setMixers(await r.json());
    } catch { /* silent */ }
  }

  useEffect(() => {
    fetchAll();
    pollRef.current = setInterval(pollMixers, 5_000);
    return () => clearInterval(pollRef.current);
  }, [fetchAll]);

  // Compute: which mixer input is live? (use first mixer that has an activeSource)
  const activeMixerInput = mixers.find(m => m.activeSource != null)?.activeSource ?? null;

  async function handleCutToCamera(camera) {
    if (!camera.mixerInput || switching) return;
    const mixer = mixers[0]; // For Phase 2, assume one primary mixer
    if (!mixer) return;
    setSwitching(true);
    try {
      const r = await fetch(
        `${backendUrl}/production/mixers/${mixer.id}/switch/${camera.mixerInput}`,
        { method: 'POST', headers }
      );
      if (r.ok) {
        const { activeSource } = await r.json();
        setMixers(prev => prev.map(m =>
          m.id === mixer.id ? { ...m, activeSource } : m
        ));
      }
    } catch { /* ignore */ } finally {
      setSwitching(false);
    }
  }

  return (
    <div style={{ padding: 20 }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        marginBottom: 16,
        flexWrap: 'wrap',
      }}>
        <h2 style={{ margin: 0, fontSize: 20, flex: 1 }}>Production Control</h2>

        {/* Quick-cut toggle */}
        {mixers.length > 0 && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={quickCut}
              onChange={e => setQuickCut(e.target.checked)}
              style={{ accentColor: 'var(--color-error)' }}
            />
            Quick cut
          </label>
        )}

        <button className="btn btn--ghost btn--sm" onClick={fetchAll} title="Refresh">↺</button>
      </div>

      {error && (
        <div style={{ color: 'var(--color-error)', marginBottom: 12, fontSize: 13 }}>{error}</div>
      )}

      {/* Mixer status bar */}
      <MixerStatusBar mixers={mixers} />

      {loading ? (
        <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p>
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
              isLive={cam.mixerInput != null && cam.mixerInput === activeMixerInput}
              quickCutEnabled={quickCut}
              backendUrl={backendUrl}
              headers={headers}
              onCutToCamera={handleCutToCamera}
            />
          ))}
        </div>
      )}

      {switching && (
        <div style={{
          position: 'fixed',
          bottom: 16,
          right: 16,
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 6,
          padding: '6px 12px',
          fontSize: 13,
          color: 'var(--color-text-muted)',
        }}>
          Switching…
        </div>
      )}
    </div>
  );
}
