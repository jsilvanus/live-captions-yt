import { useState } from 'react';
import { Link } from 'wouter';
import { useProjectRequired } from '../../hooks/useProjectRequired';
import { useToastContext } from '../../contexts/ToastContext';
import { Dialog } from '../Dialog.jsx';
import { useCropEditor } from './crop/useCropEditor.js';
import { CropPresetPanel } from './crop/CropPresetPanel.jsx';
import { CropCanvas } from './crop/CropCanvas.jsx';
import { CropSourcePanel } from './crop/CropSourcePanel.jsx';
import { C } from './workspace/theme.js';

const ASPECT_PRESETS = [['9:16', 9, 16], ['4:5', 4, 5], ['1:1', 1, 1], ['3:4', 3, 4]];

function ConfigDialog({ config, onClose, onSave }) {
  const [aspectW, setAspectW] = useState(config?.aspectW ?? 9);
  const [aspectH, setAspectH] = useState(config?.aspectH ?? 16);
  const [outW, setOutW] = useState(config?.outW ?? '');
  const [outH, setOutH] = useState(config?.outH ?? '');
  const [videoBitrate, setVideoBitrate] = useState(config?.videoBitrate ?? '');
  const [transitionMs, setTransitionMs] = useState(config?.transitionMs ?? 0);
  const [followProgram, setFollowProgram] = useState(config?.followProgram ?? true);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const ok = await onSave({
      aspectW: Number(aspectW), aspectH: Number(aspectH),
      outW: outW === '' ? null : Number(outW),
      outH: outH === '' ? null : Number(outH),
      videoBitrate: videoBitrate.trim() === '' ? null : videoBitrate.trim(),
      transitionMs: Number(transitionMs),
      followProgram,
    });
    setSaving(false);
    if (ok) onClose();
  }

  return (
    <Dialog title="Vertical crop settings" onClose={onClose} footer={
      <button className="btn btn--primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
    }>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={{ fontSize: '.72rem', fontWeight: 600, display: 'block', marginBottom: 5 }}>Crop aspect ratio</label>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            {ASPECT_PRESETS.map(([label, w, h]) => (
              <button key={label} type="button" className="btn btn--sm btn--ghost"
                onClick={() => { setAspectW(w); setAspectH(h); }}
                style={aspectW === w && aspectH === h ? { fontWeight: 700 } : undefined}>{label}</button>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input className="settings-field__input" type="number" min={1} value={aspectW} onChange={(e) => setAspectW(e.target.value)} style={{ width: 70 }} />
            <span>:</span>
            <input className="settings-field__input" type="number" min={1} value={aspectH} onChange={(e) => setAspectH(e.target.value)} style={{ width: 70 }} />
          </div>
        </div>
        <div>
          <label style={{ fontSize: '.72rem', fontWeight: 600, display: 'block', marginBottom: 5 }}>Delivery size (blank = default 1080×1920)</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input className="settings-field__input" type="number" min={2} placeholder="width" value={outW} onChange={(e) => setOutW(e.target.value)} style={{ width: 90 }} />
            <span>×</span>
            <input className="settings-field__input" type="number" min={2} placeholder="height" value={outH} onChange={(e) => setOutH(e.target.value)} style={{ width: 90 }} />
          </div>
        </div>
        <div>
          <label style={{ fontSize: '.72rem', fontWeight: 600, display: 'block', marginBottom: 5 }}>Video bitrate (e.g. 4500k, blank = codec default)</label>
          <input className="settings-field__input" value={videoBitrate} onChange={(e) => setVideoBitrate(e.target.value)} style={{ width: 140 }} />
        </div>
        <div>
          <label style={{ fontSize: '.72rem', fontWeight: 600, display: 'block', marginBottom: 5 }}>Default pan transition (ms, 0 = hard cut)</label>
          <input className="settings-field__input" type="number" min={0} max={10000} value={transitionMs} onChange={(e) => setTransitionMs(e.target.value)} style={{ width: 100 }} />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '.78rem' }}>
          <input type="checkbox" checked={followProgram} onChange={(e) => setFollowProgram(e.target.checked)} />
          Follow the program bus — auto-apply the bound preset on camera/mixer switches
        </label>
      </div>
    </Dialog>
  );
}

export function ProductionCropPage() {
  useProjectRequired();
  const hook = useCropEditor();
  const { showToast } = useToastContext();
  const [showConfig, setShowConfig] = useState(false);
  const { config, loaded, error } = hook;

  async function toggleEnabled() {
    const res = await hook.actions.saveConfig({ enabled: !config?.enabled });
    if (!res.ok) showToast(res.error, 'error');
  }

  async function saveConfig(patch) {
    const res = await hook.actions.saveConfig(patch);
    if (!res.ok) { showToast(res.error, 'error'); return false; }
    return true;
  }

  if (error === 'feature-disabled') {
    return (
      <div style={{ padding: 24, color: C.text, background: C.pageBg, flex: 1 }}>
        <p>Vertical crop isn't enabled for this project yet. Ask an admin to enable the "crop" feature.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden', background: C.pageBg, color: C.text }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px', background: C.panelBg, borderBottom: `1px solid ${C.headerBorder}`, flexShrink: 0, flexWrap: 'wrap' }}>
        <Link href="/production" style={{ fontSize: '.72rem', color: C.textMuted, textDecoration: 'none' }}>← Production</Link>
        <span style={{ fontSize: '.98rem', fontWeight: 700, letterSpacing: '-.01em' }}>Vertical Crop</span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '.7rem', color: '#ccc' }}>
          <input type="checkbox" checked={!!config?.enabled} onChange={toggleEnabled} />
          Enabled
        </label>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '.62rem', fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', padding: '3px 8px', borderRadius: 5, background: config?.running ? 'rgba(58,158,90,.16)' : C.chipBg, color: config?.running ? C.okBright : '#888' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: config?.running ? C.ok : '#5a5a5a' }} />
          {config?.running ? `running · ${config.repositionMode}` : 'stopped'}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => setShowConfig(true)} style={{ fontSize: '.68rem', fontWeight: 600, padding: '5px 11px', borderRadius: 6, background: C.btnBg, border: `1px solid ${C.panelBorder}`, color: '#ccc' }}>⚙ Settings</button>
        </div>
      </div>

      {!loaded ? (
        <div style={{ padding: 16, fontSize: '.8rem', color: C.textMuted }}>Loading…</div>
      ) : (
        <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
          <CropPresetPanel hook={hook} />
          <CropCanvas hook={hook} />
          <CropSourcePanel hook={hook} />
        </div>
      )}

      {showConfig && <ConfigDialog config={config} onClose={() => setShowConfig(false)} onSave={saveConfig} />}
    </div>
  );
}
