/**
 * States, light kinds and the default look of every state.
 *
 * A reading's `state` comes from one of two vocabularies, chosen by the light's
 * `kind`:
 *   live-signal  LIVE, DEGRADED, STARTING, OFF, UNKNOWN   ("is the stream on?")
 *   camera       PGM, PRV, OFF, UNKNOWN                   (camera tally)
 */

export const KINDS = Object.freeze(['live-signal', 'camera']);

export const STATES = Object.freeze({
  'live-signal': Object.freeze(['LIVE', 'DEGRADED', 'STARTING', 'OFF', 'UNKNOWN']),
  camera: Object.freeze(['PGM', 'PRV', 'OFF', 'UNKNOWN']),
});

/** A look is a colour and whether it blinks. `rgb: [0,0,0]` is dark. */
const RED = [255, 0, 0];
const GREEN = [0, 255, 0];
const BLUE = [0, 0, 255];
const AMBER = [255, 160, 0];
const DARK = [0, 0, 0];

export const DEFAULT_LOOKS = Object.freeze({
  'live-signal': Object.freeze({
    LIVE: { rgb: RED, blink: false },
    DEGRADED: { rgb: AMBER, blink: false },
    STARTING: { rgb: BLUE, blink: false },
    OFF: { rgb: DARK, blink: false },
    UNKNOWN: { rgb: RED, blink: true },
  }),
  camera: Object.freeze({
    PGM: { rgb: RED, blink: false },
    PRV: { rgb: GREEN, blink: false },
    OFF: { rgb: DARK, blink: false },
    UNKNOWN: { rgb: AMBER, blink: true },
  }),
});

export function isKind(kind) {
  return KINDS.includes(kind);
}

export function isState(kind, state) {
  return isKind(kind) && STATES[kind].includes(state);
}

/** Parse `#rrggbb` into `[r, g, b]`; null when it is not a six digit hex colour. */
export function parseHexColor(text) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(text ?? '').trim());
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}

/**
 * Resolve the look of a state: the light's own override (`look[state]`, a
 * `#rrggbb` string or `{ rgb, blink }`, optionally written `blink:#rrggbb`),
 * else the kind's default.
 */
export function lookFor(kind, state, overrides = {}) {
  const base = DEFAULT_LOOKS[kind]?.[state] ?? DEFAULT_LOOKS['live-signal'].UNKNOWN;
  const raw = overrides?.[state];
  if (raw == null) return base;
  if (typeof raw === 'object' && Array.isArray(raw.rgb)) {
    return { rgb: raw.rgb.map((n) => clampByte(n)), blink: Boolean(raw.blink) };
  }
  if (typeof raw === 'string') {
    const blink = raw.startsWith('blink:');
    const rgb = parseHexColor(blink ? raw.slice(6) : raw);
    if (rgb) return { rgb, blink };
  }
  return base;
}

function clampByte(n) {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(255, Math.max(0, v)) : 0;
}
