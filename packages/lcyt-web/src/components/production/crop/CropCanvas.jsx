import { useCallback, useEffect, useRef, useState } from 'react';
import { C, HATCH } from '../workspace/theme.js';
import { computeCropBox, boxFrac, fracToNorm } from '../../../lib/cropGeometry.js';

const ACC = '#3b6fb0';

/** Draggable 9:16 rectangle staged over the incoming landscape preview, plus
 *  a small vertical monitor tile playing the actual `{key}-crop` output so
 *  the operator can confirm what's really being sent (plan_vertical_crop.md
 *  §5 "Preset editor" + "Vertical monitor"). */
export function CropCanvas({ hook }) {
  const { config, previewUrl, monitorUrl, draftPos, editingPreset, selectedSource, actions } = hook;
  const containerRef = useRef(null);
  const dragState = useRef(null);
  const [imgSize, setImgSize] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [saveName, setSaveName] = useState('');

  const aspectW = config?.aspectW ?? 9;
  const aspectH = config?.aspectH ?? 16;
  const inW = config?.running ? config.inW : imgSize?.w;
  const inH = config?.running ? config.inH : imgSize?.h;
  const box = inW && inH ? computeCropBox({ inW, inH, aspectW, aspectH }) : null;
  const geo = box ? { inW, inH, ...box } : null;
  const frac = geo ? boxFrac(draftPos, geo) : null;

  const onImgLoad = useCallback((e) => {
    setImgSize({ w: e.target.naturalWidth, h: e.target.naturalHeight });
  }, []);

  const onPointerDown = useCallback((e) => {
    if (!frac) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = containerRef.current.getBoundingClientRect();
    dragState.current = { startX: e.clientX, startY: e.clientY, startLeft: frac.leftFrac, startTop: frac.topFrac, rectW: rect.width, rectH: rect.height };
    setDragging(true);
  }, [frac]);

  const onPointerMove = useCallback((e) => {
    const ds = dragState.current;
    if (!ds || !frac) return;
    const leftFrac = ds.startLeft + (e.clientX - ds.startX) / ds.rectW;
    const topFrac = ds.startTop + (e.clientY - ds.startY) / ds.rectH;
    const { xNorm, yNorm } = fracToNorm(leftFrac, topFrac, frac);
    actions.setPositionLive(xNorm, yNorm);
  }, [frac, actions]);

  const onPointerUp = useCallback(() => { dragState.current = null; setDragging(false); }, []);

  const dirty = editingPreset && (editingPreset.xNorm !== draftPos.xNorm || editingPreset.yNorm !== draftPos.yNorm);

  async function saveToPreset() {
    if (editingPreset) { await actions.updatePreset(editingPreset.id, { xNorm: draftPos.xNorm, yNorm: draftPos.yNorm }); return; }
    const name = saveName.trim();
    if (!name) return;
    const res = await actions.createPreset(name, draftPos);
    if (res.ok) setSaveName('');
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, padding: 14, overflow: 'auto', minWidth: 0 }}>
      <div ref={containerRef} style={{
        position: 'relative', width: '100%', maxWidth: 720, margin: '0 auto',
        aspectRatio: inW && inH ? `${inW} / ${inH}` : '16 / 9',
        borderRadius: 8, overflow: 'hidden', background: HATCH, border: `1px solid ${C.panelBorder}`,
      }}>
        {previewUrl && (
          <img src={previewUrl} alt="Incoming feed" onLoad={onImgLoad}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
        {!previewUrl && (
          <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: C.mono, color: C.textFaint, fontSize: '.72rem' }}>
            no incoming preview yet
          </span>
        )}
        {frac && (
          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            title="Drag to reposition the vertical crop"
            style={{
              position: 'absolute',
              left: `${frac.leftFrac * 100}%`, top: `${frac.topFrac * 100}%`,
              width: `${frac.widthFrac * 100}%`, height: `${frac.heightFrac * 100}%`,
              border: `2px solid ${dragging ? '#fff' : ACC}`, background: 'rgba(59,111,176,.14)',
              boxShadow: '0 0 0 1000px rgba(0,0,0,.42)', cursor: dragging ? 'grabbing' : 'grab',
              touchAction: 'none',
            }}
          >
            <span style={{ position: 'absolute', top: 4, left: 5, fontSize: '.58rem', fontWeight: 700, letterSpacing: '.04em', color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,.6)' }}>
              {editingPreset?.name || 'unsaved position'}
            </span>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        <span style={{ fontSize: '.66rem', fontFamily: C.mono, color: C.textMuted }}>
          x {(draftPos.xNorm * 100).toFixed(0)}% · y {(draftPos.yNorm * 100).toFixed(0)}%
          {selectedSource ? ` · for ${selectedSource.label}` : ''}
        </span>
        {editingPreset ? (
          <button onClick={saveToPreset} disabled={!dirty} style={{
            fontSize: '.68rem', fontWeight: 600, padding: '5px 12px', borderRadius: 6,
            background: dirty ? ACC : C.btnBg, border: `1px solid ${dirty ? ACC : C.btnBorder}`, color: dirty ? '#fff' : C.textFaint,
          }}>{dirty ? 'Save position to preset' : 'Preset up to date'}</button>
        ) : (
          <>
            <input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="New preset name"
              style={{ fontSize: '.7rem', background: C.inputBg, border: `1px solid ${C.inputBorder}`, borderRadius: 6, padding: '5px 9px', color: '#ddd', width: 150 }} />
            <button onClick={saveToPreset} disabled={!saveName.trim()} style={{
              fontSize: '.68rem', fontWeight: 600, padding: '5px 12px', borderRadius: 6,
              background: saveName.trim() ? ACC : C.btnBg, border: `1px solid ${saveName.trim() ? ACC : C.btnBorder}`, color: saveName.trim() ? '#fff' : C.textFaint,
            }}>Save as preset</button>
          </>
        )}
      </div>

      <VerticalMonitor url={monitorUrl} running={!!config?.running} />
    </div>
  );
}

function VerticalMonitor({ url, running }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);

  useEffect(() => {
    if (!running || !url) {
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
      return;
    }
    let cancelled = false;
    (async () => {
      const videoEl = videoRef.current;
      if (!videoEl) return;
      if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
        videoEl.src = url;
        videoEl.play().catch(() => {});
        return;
      }
      const { default: Hls } = await import('hls.js');
      if (cancelled) return;
      if (Hls.isSupported()) {
        const hls = new Hls({ lowLatencyMode: true });
        hls.loadSource(url);
        hls.attachMedia(videoEl);
        hls.on(Hls.Events.MANIFEST_PARSED, () => videoEl.play().catch(() => {}));
        hlsRef.current = hls;
      }
    })();
    return () => {
      cancelled = true;
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    };
  }, [url, running]);

  return (
    <div style={{ alignSelf: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <div style={{
        position: 'relative', width: 128, aspectRatio: '9 / 16', borderRadius: 8, overflow: 'hidden',
        background: HATCH, border: `1px solid ${running ? C.ok : C.panelBorder}`,
      }}>
        {running
          ? <video ref={videoRef} muted playsInline style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          : <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: C.mono, fontSize: '.6rem', color: C.textFaint, textAlign: 'center', padding: 6 }}>renderer stopped</span>}
        <span style={{ position: 'absolute', top: 5, left: 5, fontSize: '.5rem', fontWeight: 700, letterSpacing: '.05em', padding: '2px 6px', borderRadius: 4, background: running ? C.ok : '#333', color: '#fff' }}>
          {running ? 'LIVE' : 'OFF'}
        </span>
      </div>
      <span style={{ fontSize: '.6rem', color: C.textMuted }}>Vertical output monitor</span>
    </div>
  );
}
