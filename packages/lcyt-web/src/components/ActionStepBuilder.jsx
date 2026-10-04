import { useEffect, useState } from 'react';
import {
  cameraAtom, mixerAtom, mixerInputs, mixerRef, cameraRef, duplicateRefs, appendStep, runUsesDevices,
} from '../lib/action-atoms.js';

// Editor for a cue rule's server-run action (`action.run`, plan_backend_actions.md):
// a `|`-separated list of steps, with pickers that write correct camera / mixer
// atoms so nobody has to remember the syntax. Loads the project's cameras,
// mixers and named actions itself (best effort: the field still works as plain
// text when a list cannot be loaded).

const KINDS = [
  { value: 'camera', label: 'Camera preset' },
  { value: 'mixer', label: 'Mixer input' },
  { value: 'wait', label: 'Wait' },
  { value: 'action', label: 'Named action' },
];

async function loadList(authedFetch, path, pick) {
  try {
    const r = await authedFetch(path);
    if (!r.ok) return [];
    const data = await r.json();
    const list = pick(data);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/**
 * @param {{ value: string, onChange: (next: string) => void, authedFetch: Function }} props
 */
export function ActionStepBuilder({ value, onChange, authedFetch }) {
  const [cameras, setCameras] = useState([]);
  const [mixers, setMixers] = useState([]);
  const [actions, setActions] = useState([]);
  const [kind, setKind] = useState('camera');
  const [deviceId, setDeviceId] = useState('');
  const [choice, setChoice] = useState('');
  const [seconds, setSeconds] = useState('2');

  useEffect(() => {
    let live = true;
    (async () => {
      const [c, m, a] = await Promise.all([
        loadList(authedFetch, '/production/cameras', (d) => d),
        loadList(authedFetch, '/production/mixers', (d) => d),
        loadList(authedFetch, '/actions', (d) => d?.actions),
      ]);
      if (!live) return;
      setCameras(c); setMixers(m); setActions(a);
    })();
    return () => { live = false; };
  }, [authedFetch]);

  const camera = cameras.find((c) => c.id === deviceId);
  const mixer = mixers.find((m) => m.id === deviceId);
  const presets = camera?.controlConfig?.presets || [];
  const inputs = mixer ? mixerInputs(mixer) : [];

  const dupCams = duplicateRefs(cameras, cameraRef);
  const dupMixers = duplicateRefs(mixers, mixerRef);
  const ambiguous = [
    ...cameras.filter((c) => dupCams.has(cameraRef(c))).map((c) => c.name),
    ...mixers.filter((m) => dupMixers.has(mixerRef(m))).map((m) => m.name),
  ];

  function stepToAdd() {
    if (kind === 'camera' && camera) {
      const preset = presets.find((p) => p.id === choice);
      return preset ? cameraAtom(camera, preset) : '';
    }
    if (kind === 'mixer' && mixer) {
      const n = inputs.length ? choice : String(choice).trim();
      return /^\d+$/.test(n) ? mixerAtom(mixer, n) : '';
    }
    if (kind === 'wait') {
      const s = Number(seconds);
      return Number.isFinite(s) && s > 0 ? `wait:${s}s` : '';
    }
    if (kind === 'action') return choice ? `@${choice}` : '';
    return '';
  }

  const step = stepToAdd();

  function changeKind(next) { setKind(next); setDeviceId(''); setChoice(''); }
  function changeDevice(id) { setDeviceId(id); setChoice(''); }

  return (
    <div className="settings-field">
      <label className="settings-field__label" htmlFor="action-run-expr">Run action when this cue fires (optional)</label>
      <input
        id="action-run-expr"
        className="settings-field__input"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="camera:pulpit.wide | wait:2s | @intro"
        spellCheck={false}
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6, alignItems: 'center' }} role="group" aria-label="Add a step">
        <select className="settings-field__input" style={{ width: 'auto' }} aria-label="Step type" value={kind} onChange={(e) => changeKind(e.target.value)}>
          {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>

        {kind === 'camera' && (
          <>
            <select className="settings-field__input" style={{ width: 'auto' }} aria-label="Camera" value={deviceId} onChange={(e) => changeDevice(e.target.value)}>
              <option value="">Camera…</option>
              {cameras.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select className="settings-field__input" style={{ width: 'auto' }} aria-label="Preset" value={choice} onChange={(e) => setChoice(e.target.value)} disabled={!camera}>
              <option value="">Preset…</option>
              {presets.map((p) => <option key={p.id} value={p.id}>{p.name || p.id}</option>)}
            </select>
          </>
        )}

        {kind === 'mixer' && (
          <>
            <select className="settings-field__input" style={{ width: 'auto' }} aria-label="Mixer" value={deviceId} onChange={(e) => changeDevice(e.target.value)}>
              <option value="">Mixer…</option>
              {mixers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            {inputs.length > 0 ? (
              <select className="settings-field__input" style={{ width: 'auto' }} aria-label="Input" value={choice} onChange={(e) => setChoice(e.target.value)}>
                <option value="">Input…</option>
                {inputs.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
              </select>
            ) : (
              <input className="settings-field__input" style={{ width: 80 }} type="number" min="0" aria-label="Input number" placeholder="Input #" value={choice} onChange={(e) => setChoice(e.target.value)} disabled={!mixer} />
            )}
          </>
        )}

        {kind === 'wait' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input className="settings-field__input" style={{ width: 70 }} type="number" min="0.1" step="0.5" aria-label="Seconds" value={seconds} onChange={(e) => setSeconds(e.target.value)} />
            s
          </label>
        )}

        {kind === 'action' && (
          <select className="settings-field__input" style={{ width: 'auto' }} aria-label="Named action" value={choice} onChange={(e) => setChoice(e.target.value)}>
            <option value="">Action…</option>
            {actions.map((a) => <option key={a.slug} value={a.slug}>{a.name}</option>)}
          </select>
        )}

        <button type="button" className="btn btn--ghost" disabled={!step} onClick={() => { onChange(appendStep(value, step)); setChoice(''); }}>
          Add step
        </button>
      </div>

      <span className="settings-field__hint">
        Steps run in order, separated by <code>|</code>. Camera and mixer steps only move hardware while the project is ARMED (it arms when the broadcast goes live); otherwise they are logged as skipped.
      </span>
      {ambiguous.length > 0 && (
        <span className="settings-field__hint" role="alert">
          Two devices share a label ({[...new Set(ambiguous)].join(', ')}), so steps naming them are rejected. Rename one.
        </span>
      )}
      {runUsesDevices(value) && (
        <span className="settings-field__hint">Saving a rule that controls devices needs project admin access.</span>
      )}
    </div>
  );
}
