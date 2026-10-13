/**
 * Handoff manifest v1: what LCYT gives to an editor (Saarnavideo) after a broadcast.
 *
 * Stored with `ref`s that are plain file names inside the handoff; `resolveManifestRefs` turns them
 * into download URLs when the manifest is served. All times are milliseconds on the clean feed's
 * timeline (t = 0 is the first frame of the clean recording). The manifest never carries API
 * keys, stream keys or push URLs.
 */
export const MANIFEST_VERSION = 1;
export const MANIFEST_ROLES = ['clean', 'program', 'dsk'];

/**
 * @param {object} p
 * @returns {object}
 */
export function buildManifest({ origin, title, startedAt, endedAt, feeds, captions = [], dskEvents = null, markers = [], variables = {}, timeAlignment = 'recorded' }) {
  return {
    version: MANIFEST_VERSION,
    origin,
    title,
    startedAt,
    endedAt,
    timeAlignment,
    feeds,
    captions,
    dskEvents,
    markers,
    variables,
  };
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isRef = (v) => typeof v === 'string' && v.length > 0 && !v.startsWith('/') && !v.includes('..') && !/^[a-z]+:/i.test(v);

/**
 * Structural check. Returns a list of problems (empty = valid). `forbidden` are strings that must
 * not appear anywhere in the manifest (the API key, stream keys).
 */
export function validateManifest(m, { forbidden = [] } = {}) {
  const errors = [];
  if (!m || typeof m !== 'object') return ['manifest must be an object'];
  if (m.version !== MANIFEST_VERSION) errors.push(`version must be ${MANIFEST_VERSION}`);
  if (!m.origin || m.origin.system !== 'lcyt') errors.push('origin.system must be "lcyt"');
  if (typeof m.title !== 'string') errors.push('title must be a string');
  if (!Array.isArray(m.feeds) || m.feeds.length === 0) {
    errors.push('feeds must be a non-empty array');
  } else {
    const roles = new Set();
    for (const [i, f] of m.feeds.entries()) {
      if (!MANIFEST_ROLES.includes(f?.role)) errors.push(`feeds[${i}].role invalid`);
      else if (roles.has(f.role)) errors.push(`feeds[${i}].role duplicated`);
      else roles.add(f.role);
      if (f?.aliasOf != null) {
        if (!MANIFEST_ROLES.includes(f.aliasOf)) errors.push(`feeds[${i}].aliasOf invalid`);
        continue;
      }
      if (!Array.isArray(f?.parts) || f.parts.length === 0) { errors.push(`feeds[${i}].parts must be a non-empty array`); continue; }
      for (const [j, part] of f.parts.entries()) {
        if (!isRef(part?.ref)) errors.push(`feeds[${i}].parts[${j}].ref must be a relative file name`);
        if (!isNum(part?.startMs)) errors.push(`feeds[${i}].parts[${j}].startMs must be a number`);
        if (!isNum(part?.durationMs)) errors.push(`feeds[${i}].parts[${j}].durationMs must be a number`);
      }
    }
    if (!roles.has('clean')) errors.push('a clean feed is required');
  }
  for (const [i, c] of (m.captions ?? []).entries()) {
    if (typeof c?.language !== 'string' || !c.language) errors.push(`captions[${i}].language required`);
    if (!isRef(c?.ref)) errors.push(`captions[${i}].ref must be a relative file name`);
  }
  if (m.dskEvents != null && !isRef(m.dskEvents.ref)) errors.push('dskEvents.ref must be a relative file name');
  const text = JSON.stringify(m);
  for (const secret of forbidden.filter(Boolean)) {
    if (text.includes(secret)) errors.push('manifest contains a value that must stay private');
  }
  return errors;
}

/** Copy of the manifest with every `ref` replaced by `urlFor(ref)`. */
export function resolveManifestRefs(m, urlFor) {
  const out = structuredClone(m);
  for (const f of out.feeds) for (const p of f.parts ?? []) p.ref = urlFor(p.ref);
  for (const c of out.captions ?? []) c.ref = urlFor(c.ref);
  if (out.dskEvents) out.dskEvents.ref = urlFor(out.dskEvents.ref);
  return out;
}
