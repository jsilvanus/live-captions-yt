import { useRef, useEffect, useState, useId } from 'react';
import { C, HATCH } from '../theme.js';
import { Tile, Empty, camThumb, presetColors } from './parts.jsx';
import { Dialog } from '../../../Dialog.jsx';
import { useCaptionContext } from '../../../../contexts/CaptionContext';
import { useConnectionContext } from '../../../../contexts/ConnectionContext';

const ACC = '#3b6fb0'; // workspace accent (matches the design mockup)

const MMODE = { pvwpgm: 'PVW + PGM', pgm: 'PGM only', multi: 'Multi-feed' };

// ═══════════════════════════════════════════════════════════════════════════
// Small reusable bits
// ═══════════════════════════════════════════════════════════════════════════

function GhostBtn({ onClick, children, style, title, href }) {
  const s = {
    padding: '8px', borderRadius: 6, background: C.btnBg, border: `1px solid ${C.panelBorder}`,
    color: '#dcdcdc', fontSize: '.72rem', fontWeight: 600, textAlign: 'center', display: 'block', ...style,
  };
  if (href) return <a href={href} target="_blank" rel="noopener noreferrer" style={{ ...s, textDecoration: 'none' }}>{children}</a>;
  return <button onClick={onClick} title={title} style={s}>{children}</button>;
}

/** Preset button with tap-to-recall / hold-to-capture-thumbnail behaviour. */
function PresetButton({ camera, presetId, code, D }) {
  const held = useRef(false);
  const timer = useRef(null);
  const state = D.ui.presetState[`${camera.id}:${presetId}`];
  const active = D.ui.lastPreset === `${camera.id}:${presetId}`;
  const captured = !!camera.thumbnailUrl;
  const col = presetColors(state, active, ACC);

  const down = () => {
    held.current = false;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { held.current = true; D.actions.captureThumbnail(camera); }, 600);
  };
  const up = () => {
    clearTimeout(timer.current);
    if (!held.current) { D.patch({ lastPreset: `${camera.id}:${presetId}` }); D.actions.recallPreset(camera, presetId); }
    held.current = false;
  };
  const leave = () => { clearTimeout(timer.current); held.current = false; };

  return (
    <button onPointerDown={down} onPointerUp={up} onPointerLeave={leave} title="Tap to recall · hold to grab thumbnail"
      style={{ position: 'relative', minWidth: 34, padding: '5px 7px', borderRadius: 5, background: col.bg,
        border: `1px solid ${col.border}`, color: col.color, fontFamily: C.mono, fontSize: '.68rem', fontWeight: 500 }}>
      {state === 'pending' ? '…' : code}
      {captured && <span style={{ position: 'absolute', top: -3, right: -3, width: 7, height: 7, borderRadius: '50%', background: C.preview, border: `1px solid ${C.panelBg}` }} />}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CAMERAS
// ═══════════════════════════════════════════════════════════════════════════

function CamerasPane({ D }) {
  const { cameras } = D;
  if (cameras.length === 0) return <Empty>No cameras configured. Add cameras in Setup → Cameras.</Empty>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: 8 }}>
      {cameras.map((cam, i) => {
        const isPgm = cam.mixerInput != null && cam.mixerInput === D.activeInput;
        const isPvw = D.ui.previewId === cam.id;
        const presets = cam.controlConfig?.presets || [];
        const isBrowser = cam.controlType === 'webcam' || cam.controlType === 'mobile';
        return (
          <div key={cam.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 7px', background: C.tileBg, border: `1px solid ${C.tileBorder}`, borderRadius: 7 }}>
            <button onClick={() => D.actions.setPreview(cam.id)} title="Stage to preview"
              style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, minWidth: 52, justifyContent: 'center', padding: '7px 6px', borderRadius: 6,
                background: isPgm ? '#3a1618' : isPvw ? '#16281c' : C.btnBg, border: `1px solid ${isPgm ? C.live : isPvw ? ACC : C.btnBorder}`, color: C.text }}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 5C2 4.4 2.4 4 3 4H8.5C9.1 4 9.5 4.4 9.5 5V11C9.5 11.6 9.1 12 8.5 12H3C2.4 12 2 11.6 2 11V5Z" stroke="currentColor" strokeWidth="1.3" /><path d="M9.5 6.5L14 4.5V11.5L9.5 9.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>
              <span style={{ fontWeight: 700, fontSize: '.78rem' }}>{cam.mixerInput ?? i + 1}</span>
            </button>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: '.72rem', color: '#c8c8c8', width: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cam.name}</span>
              {presets.length > 0
                ? presets.map((p) => <PresetButton key={p.id} camera={cam} presetId={p.id} code={p.name || p.id} D={D} />)
                : <PresetButton camera={cam} presetId="__thumb" code={isBrowser ? 'GRAB' : '—'} D={D} />}
            </div>
            {D.ui.showThumbs && (
              <Tile src={camThumb(cam, D.thumbTick)} label={cam.name} style={{ width: 78, aspectRatio: '16/9', flexShrink: 0 }} />
            )}
          </div>
        );
      })}
      <p style={{ fontSize: '.6rem', color: C.textFaint, padding: '3px 4px 0', lineHeight: 1.5 }}>
        Tap a preset to recall it · <strong style={{ color: C.textMuted, fontWeight: 600 }}>hold</strong> to grab a thumbnail from the live feed.
      </p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// THUMBNAILS
// ═══════════════════════════════════════════════════════════════════════════

function ThumbnailsPane({ D }) {
  const { cameras } = D;
  if (cameras.length === 0) return <Empty>No cameras to preview yet.</Empty>;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(110px,1fr))', gap: 6, padding: 8, alignContent: 'start' }}>
      {cameras.map((cam) => (
        <Tile key={cam.id} src={camThumb(cam, D.thumbTick)} label={cam.thumbnailUrl ? '' : 'empty'} code={cam.name}
          border={cam.thumbnailUrl ? C.preview : C.tileBorder} />
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MONITORS
// ═══════════════════════════════════════════════════════════════════════════

function MonitorsPane({ D }) {
  const { cameras } = D;
  if (cameras.length === 0) return <Empty>No sources to monitor.</Empty>;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(128px,1fr))', gap: 7, padding: 8, alignContent: 'start' }}>
      {cameras.map((cam) => {
        const isPgm = cam.mixerInput != null && cam.mixerInput === D.activeInput;
        return (
          <Tile key={cam.id} src={camThumb(cam, D.thumbTick)} label={cam.name} code={cam.name}
            dot={isPgm ? C.live : cam.thumbnailUrl ? C.previewLine : '#5a5a5a'}
            border={isPgm ? C.live : C.tileBorder} tally={isPgm} />
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MIXER + MIXER BUTTONS + PROGRAM
// ═══════════════════════════════════════════════════════════════════════════

function mixerSources(D) {
  return D.cameras.filter((c) => c.mixerInput != null).sort((a, b) => a.mixerInput - b.mixerInput);
}

function SourceButtons({ D, big }) {
  const sources = mixerSources(D);
  if (sources.length === 0) return <Empty>No cameras mapped to mixer inputs.</Empty>;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit,minmax(${big ? 60 : 58}px,1fr))`, gap: 5, flex: big ? undefined : 1 }}>
      {sources.map((cam) => {
        const isPgm = cam.mixerInput === D.activeInput;
        const isPvw = D.ui.previewId === cam.id;
        return (
          <button key={cam.id} onClick={() => D.actions.setPreview(cam.id)}
            style={{ padding: big ? '9px 6px' : '8px 6px', borderRadius: 6,
              background: isPgm ? C.live : isPvw ? '#16281c' : C.btnBg,
              border: `1px solid ${isPgm ? C.liveBright : isPvw ? ACC : C.btnBorder}`,
              color: isPgm ? '#fff' : '#dcdcdc', fontSize: big ? '.68rem' : '.66rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {cam.name}
          </button>
        );
      })}
    </div>
  );
}

function MixerPane({ D }) {
  const mode = D.ui.mixerMode;
  const pvw = { tag: 'PVW', tagColor: C.previewLine, border: '#245536', cam: D.previewCam, label: 'PREVIEW' };
  const pgm = { tag: 'PGM', tagColor: D.ui.onAir ? C.liveBright : C.textMuted, border: D.ui.onAir ? C.live : C.panelBorder, cam: D.programCam, label: 'PROGRAM' };
  const feed2 = { tag: 'PGM 2', tagColor: '#8a8a8a', border: C.panelBorder, label: 'FEED 2', bottom: '1080p · clean' };
  const feed3 = { tag: 'PGM 3', tagColor: '#8a8a8a', border: C.panelBorder, label: 'FEED 3', bottom: '720p · ISO' };
  const monitors = mode === 'pgm' ? [pgm] : mode === 'multi' ? [pgm, feed2, feed3] : [pvw, pgm];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9, padding: 9, height: '100%' }}>
      <div style={{ display: 'flex', gap: 9, flex: 1, minHeight: 0 }}>
        {monitors.map((m, i) => (
          <div key={i} style={{ position: 'relative', flex: 1, minWidth: 0, borderRadius: 6, border: `2px solid ${m.border}`,
            background: m.cam && camThumb(m.cam, D.thumbTick) ? '#000' : HATCH, overflow: 'hidden',
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {m.cam && camThumb(m.cam, D.thumbTick)
              ? <img src={camThumb(m.cam, D.thumbTick)} alt={m.label} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
              : <span style={{ fontFamily: C.mono, color: '#3a3a3a', fontSize: '.7rem' }}>{m.label}</span>}
            <span style={{ position: 'absolute', top: 6, left: 7, fontSize: '.55rem', fontWeight: 700, letterSpacing: '.06em', color: m.tagColor }}>{m.tag}</span>
            <span style={{ position: 'absolute', bottom: 6, left: 7, fontFamily: C.mono, fontSize: '.6rem', color: '#c8c8c8', background: 'rgba(0,0,0,.5)', padding: '1px 5px', borderRadius: 3 }}>
              {m.bottom || m.cam?.name || '—'}
            </span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 7, alignItems: 'stretch' }}>
        <SourceButtons D={D} />
        <button onClick={D.actions.cut} style={{ width: 74, borderRadius: 6, background: C.live, border: `1px solid ${C.liveBright}`, color: '#fff', fontSize: '.82rem', fontWeight: 700, letterSpacing: '.04em' }}>CUT</button>
      </div>
    </div>
  );
}

function MixerBtnsPane({ D }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 9 }}>
      <div style={{ fontSize: '.6rem', color: C.textMuted, fontFamily: C.mono }}>PGM {D.programCam?.name || '—'}</div>
      <SourceButtons D={D} big />
      <button onClick={D.actions.cut} style={{ padding: 9, borderRadius: 6, background: C.live, border: `1px solid ${C.liveBright}`, color: '#fff', fontSize: '.78rem', fontWeight: 700, letterSpacing: '.05em' }}>CUT TO PROGRAM</button>
    </div>
  );
}

function ProgramPane({ D }) {
  const src = camThumb(D.programCam, D.thumbTick);
  const tally = D.ui.onAir;
  return (
    <div style={{ padding: 8, height: '100%' }}>
      <div style={{ position: 'relative', height: '100%', minHeight: 120, borderRadius: 6, border: `2px solid ${tally ? C.live : C.panelBorder}`,
        background: src ? '#000' : HATCH, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {src
          ? <img src={src} alt="Program" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          : <span style={{ fontFamily: C.mono, color: '#3a3a3a', fontSize: '.78rem' }}>PROGRAM FEED</span>}
        <span style={{ position: 'absolute', top: 9, left: 9, fontSize: '.6rem', fontWeight: 700, letterSpacing: '.07em', padding: '3px 9px', borderRadius: 4, background: tally ? C.live : '#333', color: '#fff' }}>
          {tally ? 'ON AIR' : 'OFF AIR'}
        </span>
        <span style={{ position: 'absolute', bottom: 9, left: 9, fontFamily: C.mono, fontSize: '.66rem', color: '#c8c8c8', background: 'rgba(0,0,0,.5)', padding: '1px 5px', borderRadius: 3 }}>{D.programCam?.name || '—'}</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// YOUTUBE control + video
// ═══════════════════════════════════════════════════════════════════════════

function YoutubePane({ D }) {
  const [busy, setBusy] = useState(false);
  const r = D.relay || {};
  const slot = Array.isArray(r.slots) ? r.slots[0] : (Array.isArray(r) ? r[0] : null);
  const connected = !!(slot || r.active || D.ui.onAir);
  const streamKey = D.creds.streamKey ? `••••-••••-${String(D.creds.streamKey).slice(-4)}` : '—';
  const stats = [
    ['Bitrate', D.ui.onAir ? (slot?.videoBitrate ? `${slot.videoBitrate} kbps` : 'live') : '—'],
    ['Dropped frames', '0'],
    ['Resolution', slot?.scale || '1080p'],
    ['Health', D.ui.onAir ? 'Streaming' : connected ? 'Ready' : 'Standby'],
  ];
  async function goLive() {
    setBusy(true);
    try {
      await D.youtube.setRelayActive?.(!D.ui.onAir);
      D.patch({ onAir: !D.ui.onAir });
    } catch { /* ignore */ } finally { setBusy(false); }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 11, padding: 11 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: connected ? C.ok : '#8a8a8a', boxShadow: connected ? `0 0 6px ${C.ok}` : 'none' }} />
        <span style={{ fontSize: '.8rem', fontWeight: 600 }}>{connected ? (D.ui.onAir ? 'Connected · streaming' : 'Connected · ready') : 'Not connected'}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: C.inputBg, border: `1px solid ${C.tileBorder}`, borderRadius: 7, overflow: 'hidden' }}>
        {stats.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px' }}>
            <span style={{ fontSize: '.68rem', color: C.textMuted }}>{k}</span>
            <span style={{ fontSize: '.68rem', fontFamily: C.mono, color: '#bbb' }}>{v}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.62rem', color: C.textMuted }}>
        <span>Stream key</span><span style={{ fontFamily: C.mono, color: '#999' }}>{streamKey}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <GhostBtn onClick={D.refresh}>Check connection</GhostBtn>
        <button onClick={goLive} disabled={busy} style={{ padding: 10, borderRadius: 6, color: '#fff', fontSize: '.8rem', fontWeight: 700, letterSpacing: '.03em',
          background: D.ui.onAir ? C.live : '#1a7f4b', border: `1px solid ${D.ui.onAir ? C.liveBright : '#25995c'}` }}>
          {busy ? '…' : D.ui.onAir ? 'End Stream' : 'Go Live'}
        </button>
        <GhostBtn href="https://studio.youtube.com">Open YouTube Studio ↗</GhostBtn>
      </div>
    </div>
  );
}

function YtVideoPane({ D, variant }) {
  const src = camThumb(D.programCam, D.thumbTick);
  const label = variant === 'ytmonitor' ? 'YOUTUBE LIVE MONITOR' : 'YOUTUBE PREVIEW';
  return (
    <div style={{ padding: 8, height: '100%' }}>
      <div style={{ position: 'relative', height: '100%', minHeight: 120, borderRadius: 6, border: `1px solid ${C.tileBorder}`,
        background: src ? '#000' : HATCH, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {src
          ? <img src={src} alt={label} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          : <span style={{ fontFamily: C.mono, color: '#3a3a3a', fontSize: '.72rem' }}>{label}</span>}
        <span style={{ position: 'absolute', top: 8, left: 8, display: 'flex', alignItems: 'center', gap: 5, fontSize: '.56rem', fontWeight: 700, letterSpacing: '.06em', padding: '3px 8px', borderRadius: 4, background: D.ui.onAir ? C.live : '#333', color: '#fff' }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#fff' }} />{D.ui.onAir ? 'LIVE' : 'IDLE'}
        </span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SENT CAPTIONS
// ═══════════════════════════════════════════════════════════════════════════

function fmtTime(ts) {
  try { return new Date(ts).toLocaleTimeString([], { hour12: false }); } catch { return ''; }
}

function SentPane({ D }) {
  const entries = D.sentEntries.filter((e) => !e.error);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '7px 10px', borderBottom: `1px solid #232323`, fontSize: '.62rem', color: C.textMuted, flexShrink: 0 }}>
        {entries.length} delivered · {D.connected ? 'live' : 'offline'}
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {entries.length === 0 && <Empty>No captions sent yet.</Empty>}
        {entries.map((e, i) => (
          <div key={e.requestId || i} style={{ padding: '7px 9px', borderRadius: 6, background: i === 0 ? '#16221a' : C.tileBg, border: `1px solid ${i === 0 ? '#255238' : C.tileBorder}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <span style={{ fontFamily: C.mono, fontSize: '.56rem', color: e.pending ? C.gold : C.previewLine }}>{e.pending ? 'pending' : `#${e.sequence ?? ''}`}</span>
              <span style={{ fontFamily: C.mono, fontSize: '.56rem', color: C.textMuted }}>{fmtTime(e.timestamp)}</span>
            </div>
            <div style={{ fontSize: '.72rem', color: '#d0d0d0', lineHeight: 1.45 }}>{e.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// RUNDOWN / CUES
// ═══════════════════════════════════════════════════════════════════════════

function RundownPane({ D }) {
  const [q, setQ] = useState('');
  const rules = D.cueRules.filter((r) => !q || (r.name || '').toLowerCase().includes(q.toLowerCase()) || (r.pattern || '').toLowerCase().includes(q.toLowerCase()));
  function addCue() {
    const name = window.prompt('New cue name / phrase to match:');
    if (name) D.actions.addCueRule({ name, pattern: name });
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 9px', borderBottom: `1px solid #232323`, flexShrink: 0 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search cues…"
          style={{ flex: 1, background: C.inputBg, border: `1px solid ${C.inputBorder}`, borderRadius: 6, padding: '5px 9px', fontSize: '.7rem', color: '#ddd' }} />
        <button onClick={addCue} style={{ fontSize: '.66rem', fontWeight: 600, color: '#bbb', background: C.btnBg, border: `1px solid ${C.panelBorder}`, borderRadius: 6, padding: '5px 10px' }}>+ Cue</button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {!D.connected && <Empty>Connect a session to load cue rules.</Empty>}
        {D.connected && rules.length === 0 && <Empty>No cue rules{q ? ' match your search' : ' yet'}.</Empty>}
        {rules.map((r) => (
          <div key={r.id} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '7px 9px', borderRadius: 6, background: r.enabled ? '#1a2438' : 'transparent', borderLeft: `2px solid ${r.enabled ? ACC : 'transparent'}` }}>
            <span style={{ fontFamily: C.mono, fontSize: '.58rem', color: '#a8c6f0', flexShrink: 0, width: 54, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.match_type || 'phrase'}</span>
            <span style={{ fontSize: '.76rem', color: '#eef2f8', lineHeight: 1.45 }}>
              <strong style={{ fontWeight: 600 }}>{r.name}</strong>
              {r.pattern ? <span style={{ color: C.textMuted }}> · {r.pattern}</span> : null}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// AI PRODUCTION ASSISTANT
// ═══════════════════════════════════════════════════════════════════════════

function ChatPane({ D }) {
  const [draft, setDraft] = useState('');
  const listRef = useRef(null);
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [D.ui.chat]);
  function send() { const t = draft.trim(); if (!t) return; setDraft(''); D.actions.sendChat(t); }
  const quick = [
    ['Draft an opener', 'Draft an opening caption to welcome the online congregation.'],
    ['Summarize segment', 'Summarize the current worship segment for the rundown.'],
    ['Flag pacing', 'Are we on time against the rundown?'],
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div ref={listRef} style={{ flex: 1, overflow: 'auto', padding: 9, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {D.ui.chat.map((m) => (
          <div key={m.id} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{ maxWidth: '86%', padding: '8px 11px', borderRadius: 11, background: m.role === 'user' ? ACC : '#202124', color: m.role === 'user' ? '#fff' : '#dcdcdc', fontSize: '.74rem', lineHeight: 1.5 }}>{m.text}</div>
          </div>
        ))}
        {D.ui.chatBusy && <div style={{ fontSize: '.7rem', color: C.textMuted, padding: '0 2px' }}>…thinking</div>}
      </div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', padding: '0 9px 7px', flexShrink: 0 }}>
        {quick.map(([label, text]) => (
          <button key={label} onClick={() => setDraft(text)} style={{ fontSize: '.62rem', color: '#bbb', background: C.tileBg, border: `1px solid ${C.btnBorder}`, borderRadius: 12, padding: '4px 10px' }}>{label}</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, padding: '8px 9px', borderTop: `1px solid #232323`, flexShrink: 0 }}>
        <textarea rows={1} value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Ask the production assistant…"
          style={{ flex: 1, resize: 'none', background: C.inputBg, border: `1px solid ${C.inputBorder}`, borderRadius: 7, padding: '7px 9px', fontSize: '.72rem', color: '#ddd', lineHeight: 1.4 }} />
        <button onClick={send} style={{ alignSelf: 'stretch', padding: '0 14px', borderRadius: 7, background: ACC, color: '#fff', fontSize: '.72rem', fontWeight: 600 }}>Send</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CAPTION INPUT (mini) — plan_ui.md v2 §4a's "Production: operator surface +
// caption input" row. A direct, no-frills line-send (CaptionContext.send()) —
// deliberately not InputBar's full file/metacode/batch/translation pipeline,
// same "small, single-purpose widget" scope as ChatPane/ControlsPane above.
// ═══════════════════════════════════════════════════════════════════════════

function CaptionInputPane() {
  const { send } = useCaptionContext();
  const { connected } = useConnectionContext();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    const text = draft.trim();
    if (!text || sending || !connected) return;
    setSending(true);
    setError('');
    try {
      await send(text, Date.now());
      setDraft('');
    } catch (err) {
      setError(err?.message || 'Send failed');
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 9, height: '100%', justifyContent: 'flex-end' }}>
      {!connected && <div style={{ fontSize: '.68rem', color: C.textMuted }}>Not connected.</div>}
      {error && <div style={{ fontSize: '.68rem', color: C.live }}>{error}</div>}
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          type="text"
          value={draft}
          disabled={!connected}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
          placeholder="Send a caption…"
          style={{ flex: 1, background: C.inputBg, border: `1px solid ${C.inputBorder}`, borderRadius: 7, padding: '7px 9px', fontSize: '.72rem', color: '#ddd' }}
        />
        <button onClick={submit} disabled={!connected || sending || !draft.trim()} style={{ padding: '0 14px', borderRadius: 7, background: ACC, color: '#fff', fontSize: '.72rem', fontWeight: 600, opacity: (!connected || sending || !draft.trim()) ? 0.5 : 1 }}>
          {sending ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTROLS
// ═══════════════════════════════════════════════════════════════════════════

function ControlsPane({ D }) {
  const u = D.ui;
  const btns = [
    { label: u.captioning ? 'Stop Captioning' : 'Start Captioning', on: u.captioning, onColor: C.ok, col: '1 / -1', onClick: D.actions.toggleCaptioning },
    { label: u.recording ? 'Stop Recording' : 'Record', on: u.recording, onColor: C.live, onClick: () => D.patch({ recording: !u.recording }) },
    { label: 'DSK', on: u.dsk, onColor: ACC, onClick: () => D.patch({ dsk: !u.dsk }) },
    { label: 'Lower Third', on: false, onClick: () => {} },
    { label: 'Bumper', on: false, onClick: () => {} },
    { label: 'Cut to Black', on: false, onClick: () => { const blk = D.cameras.find((c) => /black/i.test(c.name)); if (blk?.mixerInput != null) D.actions.switchTo(blk.mixerInput); else D.actions.setPreview(null); } },
    { label: u.mute ? 'Unmute Audio' : 'Mute Audio', on: u.mute, onColor: C.gold, onClick: () => D.patch({ mute: !u.mute }) },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, padding: 9, alignContent: 'start' }}>
      {btns.map((b, i) => (
        <button key={i} onClick={b.onClick} style={{ gridColumn: b.col || 'auto', padding: '11px 8px', borderRadius: 7,
          background: b.on ? b.onColor : C.btnBg, border: `1px solid ${b.on ? b.onColor : C.btnBorder}`, color: b.on ? '#fff' : '#dcdcdc', fontSize: '.72rem', fontWeight: 600, textAlign: 'center' }}>
          {b.label}
        </button>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// LOWER THIRDS / GRAPHICS
// ═══════════════════════════════════════════════════════════════════════════

function LowerThirdsPane({ D }) {
  const templates = D.templates;
  const textLayers = (t) => (t.templateJson?.layers || []).filter((l) => l.type === 'text');
  const stagedName = templates.find((t) => t.id === D.ui.gfxStaged)?.name || '—';
  const liveName = templates.find((t) => t.id === D.ui.gfxLive)?.name || '—';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 9 }}>
      {templates.length === 0 && <Empty>No DSK templates. Create some in Graphics → Editor.</Empty>}
      {templates.map((t) => {
        const staged = D.ui.gfxStaged === t.id;
        const live = D.ui.gfxLive === t.id;
        const layers = textLayers(t);
        return (
          <div key={t.id} onClick={() => D.actions.stageGraphic(t.id)} style={{ border: `1px solid ${live ? C.live : staged ? ACC : C.tileBorder}`, borderRadius: 8, overflow: 'hidden', background: live ? 'rgba(204,51,68,.10)' : staged ? 'rgba(59,111,176,.12)' : C.tileBg, cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 9px' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: live ? C.liveBright : staged ? '#6ea8e8' : '#5a5a5a', flexShrink: 0 }} />
              <span style={{ fontSize: '.74rem', fontWeight: 600, color: '#e2e2e2' }}>{t.name}</span>
              {(live || staged) && <span style={{ fontSize: '.5rem', fontWeight: 700, letterSpacing: '.07em', color: live ? C.liveBright : '#8fbef0' }}>{live ? 'ON AIR' : 'STAGED'}</span>}
              <span style={{ marginLeft: 'auto', fontFamily: C.mono, fontSize: '.54rem', color: C.textMuted }}>{layers.length ? `${layers.length} text` : 'graphic'}</span>
            </div>
            {staged && layers.length > 0 && (
              <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '0 9px 9px' }}>
                {layers.map((l) => (
                  <div key={l.id} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <label style={{ fontSize: '.55rem', textTransform: 'uppercase', letterSpacing: '.06em', color: C.textMuted }}>{l.name || l.id}</label>
                    <input value={D.ui.gfxFields[t.id]?.[l.id] ?? l.text ?? ''} onChange={(e) => D.actions.setGraphicField(t.id, l.id, e.target.value)}
                      style={{ background: C.inputBg, border: `1px solid ${C.inputBorder}`, borderRadius: 6, padding: '6px 9px', fontSize: '.72rem', color: '#ddd' }} />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <div style={{ display: 'flex', gap: 7, alignItems: 'stretch', marginTop: 2 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          {[['PVW', '#8fbef0', stagedName], ['PGM', D.ui.gfxLive ? C.liveBright : C.textMuted, liveName]].map(([tag, color, name]) => (
            <div key={tag} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 9px', borderRadius: 6, background: C.inputBg, border: `1px solid ${C.tileBorder}` }}>
              <span style={{ fontSize: '.5rem', fontWeight: 700, letterSpacing: '.06em', color, width: 26, flexShrink: 0 }}>{tag}</span>
              <span style={{ fontSize: '.68rem', color: '#c8c8c8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
            </div>
          ))}
        </div>
        <button onClick={D.actions.cutGraphicLive} disabled={!D.ui.gfxStaged}
          style={{ width: 64, flexShrink: 0, borderRadius: 6, background: D.ui.gfxStaged ? '#1a7f4b' : '#181818', border: `1px solid ${D.ui.gfxStaged ? '#25995c' : C.panelBorder}`, color: D.ui.gfxStaged ? '#fff' : C.textFaint, fontSize: '.74rem', fontWeight: 700, letterSpacing: '.03em' }}>CUT</button>
      </div>
      {D.ui.gfxLive && (
        <button onClick={D.actions.clearGraphicLive} style={{ padding: 7, borderRadius: 6, background: '#2a1418', border: '1px solid #3a1c22', color: '#e08a92', fontSize: '.66rem', fontWeight: 600 }}>Clear from air</button>
      )}
      <p style={{ fontSize: '.6rem', color: C.textFaint, padding: '2px 4px', lineHeight: 1.5 }}>
        Click a template to stage it (edit fields), then <strong style={{ color: C.textMuted, fontWeight: 600 }}>CUT</strong> to take it on air.
      </p>
    </div>
  );
}

/**
 * Shared per-instance watchlist state: an array of string keys stored under
 * one field of a pane's settings, with add/remove that preserve the rest of
 * settings and dedupe on add. Used by VariablesPane (watched variable names)
 * and ConnectorPollsPane (watched connector-request ids) — same add/remove/
 * dedupe shape; each pane still owns its own "pick what to add" UI and list
 * rendering, which differ enough (inline datalist vs. dialog+select) not to
 * share a single component.
 */
function useWatchlist(settings, onSettingsChange, field) {
  const watched = settings?.[field] || [];
  function add(item) {
    if (!item || watched.includes(item)) return;
    onSettingsChange?.({ ...settings, [field]: [...watched, item] });
  }
  function remove(item) {
    onSettingsChange?.({ ...settings, [field]: watched.filter((k) => k !== item) });
  }
  return { watched, add, remove };
}

// ═══════════════════════════════════════════════════════════════════════════
// VARIABLES — live {{ }} watchlist widget
// ═══════════════════════════════════════════════════════════════════════════

function VariablesPane({ D, settings, onSettingsChange }) {
  const [draft, setDraft] = useState('');
  const datalistId = useId();
  const { watched, add, remove } = useWatchlist(settings, onSettingsChange, 'keys');
  const known = Object.keys(D.variables || {}).filter((n) => !watched.includes(n));

  function addKey(name) {
    const key = (name || '').trim();
    if (!key || watched.includes(key)) return;
    add(key);
    setDraft('');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: 6, padding: '7px 9px', borderBottom: `1px solid #232323`, flexShrink: 0 }}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addKey(draft); }}
          list={datalistId} placeholder="variable name…"
          style={{ flex: 1, background: C.inputBg, border: `1px solid ${C.inputBorder}`, borderRadius: 6, padding: '5px 9px', fontSize: '.7rem', color: '#ddd' }} />
        <datalist id={datalistId}>
          {known.map((n) => <option key={n} value={n} />)}
        </datalist>
        <button onClick={() => addKey(draft)} style={{ fontSize: '.66rem', fontWeight: 600, color: '#bbb', background: C.btnBg, border: `1px solid ${C.panelBorder}`, borderRadius: 6, padding: '5px 10px' }}>+ Watch</button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {watched.length === 0 && <Empty>No variables watched yet. Add a name above (e.g. viewers, now_playing).</Empty>}
        {watched.map((name) => {
          const entry = D.variables?.[name];
          const value = entry?.value ?? entry?.defaultValue ?? '';
          const resolved = entry != null;
          return (
            <div key={name} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, alignItems: 'center', padding: '7px 9px', borderRadius: 6, background: C.tileBg, border: `1px solid ${C.tileBorder}` }}>
              <span style={{ fontFamily: C.mono, fontSize: '.7rem', color: '#a8c6f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={name}>{name}</span>
              <span style={{ fontSize: '.76rem', color: resolved ? '#eef2f8' : C.textMuted, fontStyle: resolved ? 'normal' : 'italic', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={String(value)}>
                {resolved ? String(value) : 'unresolved'}
              </span>
              <button onClick={() => remove(name)} title="Stop watching" style={{ width: 20, height: 20, borderRadius: 5, background: '#222', border: `1px solid ${C.panelBorder}`, color: '#aaa', fontSize: '.8rem', lineHeight: 1 }}>×</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CONNECTOR POLLS — live start/stop of constant poll (production decision,
// deliberately kept out of Setup Hub — see plan_live_variables.md §2)
// ═══════════════════════════════════════════════════════════════════════════

function connectorRequestKey(r) { return `${r.connectorSlug}.${r.requestSlug}`; }

/**
 * Resolve a watched entry against the live connector-request list. New
 * entries are keyed by the request's stable `requestId`, so a connector or
 * request slug rename never orphans them. Older entries persisted before
 * this fix used the "connectorSlug.requestSlug" composite string, which
 * DOES break on rename — still resolved here for backward compat with
 * already-saved workspace layouts, but never written by addCall() below.
 */
function resolveWatchedEntry(known, key) {
  return known.find((r) => r.requestId === key) || known.find((r) => connectorRequestKey(r) === key);
}

function ConnectorPollsPane({ D, settings, onSettingsChange }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pickedId, setPickedId] = useState('');
  const { watched, add, remove } = useWatchlist(settings, onSettingsChange, 'calls');
  const known = D.connectorRequests || [];
  const watchedIds = new Set(watched.map((key) => resolveWatchedEntry(known, key)?.requestId).filter(Boolean));
  const available = known.filter((r) => !watchedIds.has(r.requestId));

  function addCall() {
    if (!pickedId) return;
    add(pickedId);
    setPickedId('');
    setDialogOpen(false);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: 9, display: 'flex', flexWrap: 'wrap', gap: 10, alignContent: 'start', flex: 1, overflow: 'auto' }}>
        {watched.length === 0 && <Empty>No API calls watched yet. "+ Add API call" to start toggling constant poll.</Empty>}
        {watched.map((key) => {
          const req = resolveWatchedEntry(known, key);
          const on = !!req?.constantPollEnabled;
          const label = req ? (req.requestName || req.requestSlug) : key;
          return (
            <div key={key} style={{ position: 'relative' }}>
              <button
                onClick={() => req && D.actions.togglePoll(req.connectorSlug, req.requestSlug, !on)}
                disabled={!req}
                title={req ? `${connectorRequestKey(req)} — every ${req.prefetchIntervalMs}ms, independent of the caption pointer` : `${key} — request no longer exists`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 7,
                  padding: '9px 16px', borderRadius: 8, fontSize: '.74rem', fontWeight: 600,
                  background: on ? '#1a7f4b' : C.btnBg, border: `1px solid ${on ? '#25995c' : C.panelBorder}`,
                  color: on ? '#fff' : req ? '#dcdcdc' : C.textFaint,
                }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: on ? '#fff' : '#5a5a5a', flexShrink: 0 }} />
                {label}
              </button>
              <button onClick={() => remove(key)} title="Stop watching here (does not stop the poll)"
                style={{ position: 'absolute', top: -6, right: -6, width: 17, height: 17, borderRadius: '50%', background: '#222', border: `1px solid ${C.panelBorder}`, color: '#aaa', fontSize: '.6rem', lineHeight: 1 }}>×</button>
            </div>
          );
        })}
      </div>
      <div style={{ padding: '7px 9px', borderTop: `1px solid #232323`, flexShrink: 0 }}>
        <button onClick={() => setDialogOpen(true)} style={{ width: '100%', fontSize: '.68rem', fontWeight: 600, color: '#bbb', background: C.btnBg, border: `1px solid ${C.panelBorder}`, borderRadius: 6, padding: '7px 10px' }}>+ Add API call</button>
      </div>
      {dialogOpen && (
        <Dialog title="Add an API call to watch" onClose={() => setDialogOpen(false)}
          footer={
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn--secondary btn--sm" onClick={() => setDialogOpen(false)}>Cancel</button>
              <button className="btn btn--primary btn--sm" onClick={addCall} disabled={!pickedId}>Add</button>
            </div>
          }>
          {available.length === 0 ? (
            <p style={{ fontSize: '.85em', opacity: 0.7 }}>
              No requests to add — configure connectors and requests in Setup → Connectors first, or every request is already watched here.
            </p>
          ) : (
            <select value={pickedId} onChange={(e) => setPickedId(e.target.value)}
              style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border, #ccc)' }}>
              <option value="">Select a connector request…</option>
              {available.map((r) => (
                <option key={r.requestId} value={r.requestId}>
                  {r.connectorName} → {r.requestName} ({connectorRequestKey(r)})
                </option>
              ))}
            </select>
          )}
        </Dialog>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Dispatch
// ═══════════════════════════════════════════════════════════════════════════

export function PaneBody({ type, D, settings, onSettingsChange }) {
  switch (type) {
    case 'cameras':     return <CamerasPane D={D} />;
    case 'thumbnails':  return <ThumbnailsPane D={D} />;
    case 'monitors':    return <MonitorsPane D={D} />;
    case 'mixer':       return <MixerPane D={D} />;
    case 'mixerbtns':   return <MixerBtnsPane D={D} />;
    case 'program':     return <ProgramPane D={D} />;
    case 'youtube':     return <YoutubePane D={D} />;
    case 'ytpreview':   return <YtVideoPane D={D} variant="ytpreview" />;
    case 'ytmonitor':   return <YtVideoPane D={D} variant="ytmonitor" />;
    case 'sent':        return <SentPane D={D} />;
    case 'rundown':     return <RundownPane D={D} />;
    case 'chat':        return <ChatPane D={D} />;
    case 'general':     return <ControlsPane D={D} />;
    case 'lowerthirds': return <LowerThirdsPane D={D} />;
    case 'variables':   return <VariablesPane D={D} settings={settings} onSettingsChange={onSettingsChange} />;
    case 'connectorPolls': return <ConnectorPollsPane D={D} settings={settings} onSettingsChange={onSettingsChange} />;
    case 'captionInput': return <CaptionInputPane />;
    default:            return <Empty>Unknown panel type: {type}</Empty>;
  }
}

/** Header-right actions specific to a pane type (thumbs toggle, mixer mode). */
export function PaneHeaderActions({ type, D }) {
  if (type === 'cameras') {
    return (
      <button onClick={() => D.patch({ showThumbs: !D.ui.showThumbs })}
        style={{ fontSize: '.56rem', fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', padding: '3px 7px', borderRadius: 5,
          background: D.ui.showThumbs ? ACC : C.btnBg, border: `1px solid ${C.panelBorder}`, color: D.ui.showThumbs ? '#fff' : '#888' }}>Thumbs</button>
    );
  }
  if (type === 'mixer') {
    const next = { pvwpgm: 'pgm', pgm: 'multi', multi: 'pvwpgm' };
    return (
      <button onClick={() => D.patch({ mixerMode: next[D.ui.mixerMode] })} title="Switch mixer output mode"
        style={{ fontSize: '.56rem', fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', padding: '3px 8px', borderRadius: 5, background: C.btnBg, border: `1px solid ${C.panelBorder}`, color: '#bbb' }}>
        {MMODE[D.ui.mixerMode]}
      </button>
    );
  }
  return null;
}
