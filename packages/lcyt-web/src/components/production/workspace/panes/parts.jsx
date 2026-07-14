import { C, HATCH } from '../theme.js';

// Small shared primitives used across panes.

/** A framed 16:9 tile with an optional captured-thumbnail image and diagonal
 *  hatch fallback. `code`/`label` render in the corner. */
export function Tile({ src, label, code, border = C.tileBorder, tally, dot, children, style }) {
  return (
    <div style={{
      position: 'relative', aspectRatio: '16 / 9', borderRadius: 6, overflow: 'hidden',
      border: `${tally ? 2 : 1}px solid ${border}`, background: HATCH,
      display: 'flex', alignItems: 'center', justifyContent: 'center', ...style,
    }}>
      {src
        ? <img src={src} alt={label || code || ''} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        : <span style={{ fontFamily: C.mono, fontSize: '.52rem', color: C.textFaint }}>{label || 'no signal'}</span>}
      {dot != null && (
        <span style={{ position: 'absolute', top: 6, right: 6, width: 7, height: 7, borderRadius: '50%', background: dot }} />
      )}
      {code != null && (
        <span style={{
          position: 'absolute', bottom: 4, left: 5, fontFamily: C.mono, fontSize: '.6rem', fontWeight: 500,
          color: '#cfcfcf', background: 'rgba(0,0,0,.5)', padding: '1px 5px', borderRadius: 3,
        }}>{code}</span>
      )}
      {children}
    </div>
  );
}

/** Empty-state message shown inside a pane body. */
export function Empty({ children }) {
  return (
    <div style={{ padding: 14, fontSize: '.72rem', color: C.textMuted, lineHeight: 1.5 }}>
      {children}
    </div>
  );
}

/** Build the cache-busted absolute URL for a camera's captured thumbnail. */
export function camThumb(camera, tick) {
  if (!camera?.thumbnailUrl) return null;
  return `${camera.thumbnailUrl}${camera.thumbnailUrl.includes('?') ? '&' : '?'}t=${tick}`;
}

/** Colour for a preset button given its transient action state. */
export function presetColors(state, active, accent) {
  if (state === 'pending') return { bg: C.btnBg, border: C.btnBorder, color: C.textMuted };
  if (state === 'ok')      return { bg: C.ok, border: C.ok, color: '#fff' };
  if (state === 'error')   return { bg: C.live, border: C.liveBright, color: '#fff' };
  if (active)              return { bg: accent, border: accent, color: '#fff' };
  return { bg: C.btnBg, border: C.btnBorder, color: '#cfcfcf' };
}
