/**
 * Light configuration: one schema shared by the standalone program and by
 * every host that embeds the package.
 *
 *   {
 *     id, name, kind: 'live-signal' | 'camera', enabled?,
 *     runner?: 'auto' | 'backend' | 'bridge', bridgeInstanceId?,
 *     output: { type: 'tally-ma', host, port? } | { type: 'webhook', url } | { type: 'console' } | { type: 'web' },
 *     source: live-signal: { type: 'youtube', mode?: 'A' | 'B', videoId?, credentialId? }
 *             camera:      { type: 'atem', host?, meIndex?, input } | { type: 'obs', sceneName }
 *                          | { type: 'lcyt', mixerId, input }   (the host's own software mixer pushes the program input)
 *     look?:  { [STATE]: '#rrggbb' | 'blink:#rrggbb' | { rgb, blink } },
 *     ttlMs?, activeMs?, idleMs?
 *   }
 */
import { KINDS, STATES, parseHexColor } from './states.js';

export const OUTPUT_TYPES = Object.freeze(['tally-ma', 'webhook', 'console', 'web']);
export const SOURCE_TYPES = Object.freeze({
  'live-signal': Object.freeze(['youtube']),
  camera: Object.freeze(['atem', 'obs', 'lcyt']),
});
export const RUNNERS = Object.freeze(['auto', 'backend', 'bridge']);
export const TALLY_MA_DEFAULT_PORT = 21324;

const HOST_RE = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?)$/;

function isHost(value) {
  if (typeof value !== 'string' || !HOST_RE.test(value)) return false;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return value.split('.').every((p) => Number(p) <= 255);
  return true;
}

function isPort(value) {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

function validateOutput(output, errors) {
  if (!output || typeof output !== 'object') { errors.push('output is required'); return null; }
  if (!OUTPUT_TYPES.includes(output.type)) { errors.push(`output.type must be one of ${OUTPUT_TYPES.join(', ')}`); return null; }
  if (output.type === 'tally-ma') {
    if (!isHost(output.host)) errors.push('output.host must be an IP address or host name');
    const port = output.port ?? TALLY_MA_DEFAULT_PORT;
    if (!isPort(port)) errors.push('output.port must be 1-65535');
    return { type: 'tally-ma', host: output.host, port };
  }
  if (output.type === 'webhook') {
    let ok = false;
    try { const u = new URL(output.url); ok = u.protocol === 'http:' || u.protocol === 'https:'; } catch { /* invalid */ }
    if (!ok) errors.push('output.url must be an http(s) URL');
    return { type: 'webhook', url: output.url };
  }
  return { type: output.type };
}

function validateSource(kind, source, errors) {
  if (!source || typeof source !== 'object') { errors.push('source is required'); return null; }
  const allowed = SOURCE_TYPES[kind] ?? [];
  if (!allowed.includes(source.type)) { errors.push(`source.type must be one of ${allowed.join(', ')} for kind ${kind}`); return null; }
  if (source.type === 'youtube') {
    const mode = source.mode ?? 'A';
    if (mode !== 'A' && mode !== 'B') errors.push("source.mode must be 'A' or 'B'");
    if (mode === 'B' && !/^[A-Za-z0-9_-]{6,20}$/.test(source.videoId ?? '')) errors.push('source.videoId is required for mode B');
    const out = { type: 'youtube', mode };
    if (source.videoId) out.videoId = source.videoId;
    if (source.credentialId) out.credentialId = String(source.credentialId);
    return out;
  }
  if (source.type === 'atem') {
    if (!Number.isInteger(source.input) || source.input < 1 || source.input > 99) errors.push('source.input must be an input number 1-99');
    if (source.host != null && !isHost(source.host)) errors.push('source.host must be an IP address or host name');
    const meIndex = source.meIndex ?? 0;
    if (!Number.isInteger(meIndex) || meIndex < 0 || meIndex > 3) errors.push('source.meIndex must be 0-3');
    const out = { type: 'atem', input: source.input, meIndex };
    if (source.host) out.host = source.host;
    if (source.mixerId) out.mixerId = String(source.mixerId);
    return out;
  }
  if (source.type === 'obs') {
    if (typeof source.sceneName !== 'string' || !source.sceneName.trim()) errors.push('source.sceneName is required');
    const out = { type: 'obs', sceneName: String(source.sceneName ?? '') };
    if (source.host) out.host = source.host;
    if (source.mixerId) out.mixerId = String(source.mixerId);
    return out;
  }
  if (source.type === 'lcyt') {
    if (typeof source.mixerId !== 'string' || !source.mixerId.trim()) errors.push('source.mixerId is required');
    if (!Number.isInteger(source.input) || source.input < 1 || source.input > 99) errors.push('source.input must be an input number 1-99');
    return { type: 'lcyt', mixerId: String(source.mixerId ?? ''), input: source.input };
  }
  return null;
}

function validateLook(kind, look, errors) {
  if (look == null) return undefined;
  if (typeof look !== 'object' || Array.isArray(look)) { errors.push('look must be an object'); return undefined; }
  const out = {};
  for (const [state, spec] of Object.entries(look)) {
    if (!STATES[kind]?.includes(state)) { errors.push(`look.${state} is not a state of kind ${kind}`); continue; }
    if (typeof spec === 'string') {
      const hex = spec.startsWith('blink:') ? spec.slice(6) : spec;
      if (!parseHexColor(hex)) errors.push(`look.${state} must be #rrggbb or blink:#rrggbb`);
      else out[state] = spec;
    } else if (spec && Array.isArray(spec.rgb) && spec.rgb.length === 3 && spec.rgb.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
      out[state] = { rgb: spec.rgb, blink: Boolean(spec.blink) };
    } else {
      errors.push(`look.${state} must be a colour string or { rgb: [r,g,b], blink }`);
    }
  }
  return out;
}

function optionalMs(value, name, min, max, errors) {
  if (value == null) return undefined;
  if (!Number.isInteger(value) || value < min || value > max) { errors.push(`${name} must be an integer between ${min} and ${max}`); return undefined; }
  return value;
}

/** @returns {{ ok: true, value: object } | { ok: false, errors: string[] }} */
export function validateLightConfig(input) {
  const errors = [];
  if (!input || typeof input !== 'object') return { ok: false, errors: ['light must be an object'] };
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 80) errors.push('name is required (max 80 characters)');
  if (!KINDS.includes(input.kind)) errors.push(`kind must be one of ${KINDS.join(', ')}`);
  const kind = KINDS.includes(input.kind) ? input.kind : 'live-signal';
  const runner = input.runner ?? 'auto';
  if (!RUNNERS.includes(runner)) errors.push(`runner must be one of ${RUNNERS.join(', ')}`);
  if (runner === 'bridge' && !input.bridgeInstanceId) errors.push('bridgeInstanceId is required when runner is bridge');

  const output = validateOutput(input.output, errors);
  const source = validateSource(kind, input.source, errors);
  const look = validateLook(kind, input.look, errors);
  const ttlMs = optionalMs(input.ttlMs, 'ttlMs', 1000, 3_600_000, errors);
  const activeMs = optionalMs(input.activeMs, 'activeMs', 2000, 3_600_000, errors);
  const idleMs = optionalMs(input.idleMs, 'idleMs', 2000, 3_600_000, errors);

  if (errors.length) return { ok: false, errors };
  const value = {
    name: input.name.trim(), kind, enabled: input.enabled !== false, runner, output, source,
  };
  if (input.id) value.id = String(input.id);
  if (input.bridgeInstanceId) value.bridgeInstanceId = String(input.bridgeInstanceId);
  if (look && Object.keys(look).length) value.look = look;
  if (ttlMs) value.ttlMs = ttlMs;
  if (activeMs) value.activeMs = activeMs;
  if (idleMs) value.idleMs = idleMs;
  return { ok: true, value };
}

/** A lamp (host:port) must not be driven by two enabled lights. Returns the clashing pair's names or null. */
export function findOutputClash(lights) {
  const seen = new Map();
  for (const light of lights) {
    if (light.enabled === false || light.output?.type !== 'tally-ma') continue;
    const key = `${light.output.host}:${light.output.port ?? TALLY_MA_DEFAULT_PORT}`;
    if (seen.has(key)) return [seen.get(key), light.name];
    seen.set(key, light.name);
  }
  return null;
}
