/**
 * MediaMTX paths of egress outputs (plan_egress_outputs.md): which path a processing step reads and which it writes.
 *
 * An output's picture goes source -> DSK step -> crop. Each step that runs writes its own path:
 *   - crop: `{apiKey}-crop` for the project's default crop (legacy name), else `out-<id>-crop`
 *   - DSK:  `out-<id>-dsk`
 * The path an output reads is its feed, or the final path of the output it is built on (its crop, else its DSK step, else
 * that output's own input).
 */

export const MAX_CROP_SOURCE_DEPTH = 8;

const DSK_APP_DEFAULT = 'dsk';
const STREAM_NAME_DELIM = '__';

/** MediaMTX path an output's crop writes. */
export function outputCropPath(apiKey, outputId, isDefault) {
  return isDefault ? `${apiKey}-crop` : `out-${outputId}-crop`;
}

/** MediaMTX path an output's DSK step writes. */
export function outputDskPath(outputId) {
  return `out-${outputId}-dsk`;
}

function parseJson(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}

let defaultSettings = null;

/** Settings service every path helper falls back to when its caller passes none (set once from `initRtmpControl`). */
export function setOutputSettings(settings) { defaultSettings = settings ?? null; }

/**
 * `outputs.composite_in_step` (env OUTPUT_COMPOSITE_IN_STEP, default on): the composite DSK viewport (`dsk/<apiKey>`, the
 * legacy overlay of the program picture) is keyed by the DSK step of the output that lists it instead of by the relay's own
 * ffmpeg. Off = the legacy relay composite, steps skip composite viewports.
 */
export function compositeInStep(settings = null) {
  const s = settings ?? defaultSettings;
  const v = s ? s.get('outputs.composite_in_step') : process.env.OUTPUT_COMPOSITE_IN_STEP;
  return !(v === false || v === 0 || v === '0' || v === 'false');
}

/** `outputs.steps_active` (default on): are the processing steps running at all? Off = every output reads its feed or crop only. */
export function stepsActive(settings = null) {
  const s = settings ?? defaultSettings;
  const v = s ? s.get('outputs.steps_active') : process.env.OUTPUT_STEPS_ACTIVE;
  return !(v === false || v === 0 || v === '0' || v === 'false');
}

/**
 * The viewports a DSK step of an output composites: the names in `dsk` that exist. A composite viewport
 * (`stream.mode === 'composite'`) is the project's one overlay on the program picture; its stream is the bare
 * `dsk/<apiKey>` path (the others are `dsk/<apiKey>__<name>`). It is included while `compositeInStep()` is on and left to the
 * relay's own ffmpeg otherwise, so the picture is never keyed twice.
 * @param {object} db  Prisma client
 * @param {string} apiKey
 * @param {string[]} names  the output's `dsk` list
 * @param {{ get: (key: string) => any }|null} [settings]
 * @returns {Promise<Array<{ name: string, path: string, chromaKey: object|null, composite?: true }>>}  in the order of `names`
 */
export async function effectiveDskViewports(db, apiKey, names, settings = null) {
  if (!Array.isArray(names) || names.length === 0) return [];
  const cfg = settings ?? defaultSettings;
  const rows = await db.dsk_viewports.findMany({ where: { api_key: apiKey, name: { in: names } }, select: { name: true, display_settings_json: true } });
  const byName = new Map(rows.map(r => [r.name, parseJson(r.display_settings_json || 'null', null)]));
  const app = (cfg ? cfg.get('graphics.dsk_rtmp_app') : process.env.DSK_RTMP_APP) || DSK_APP_DEFAULT;
  const withComposite = compositeInStep(cfg);
  const out = [];
  for (const name of names) {
    if (!byName.has(name)) continue;
    const stream = byName.get(name)?.stream ?? null;
    if (stream?.mode === 'composite') {
      if (withComposite) out.push({ name, path: `${app}/${apiKey}`, chromaKey: stream?.chromaKey ?? null, composite: true });
      continue;
    }
    out.push({ name, path: `${app}/${apiKey}${STREAM_NAME_DELIM}${name}`, chromaKey: stream?.chromaKey ?? null });
  }
  return out;
}

/**
 * Does an enabled output of the project key the composite viewport in its DSK step? Then the relay's own ffmpeg must not
 * composite it as well (`RtmpRelayManager.setDskRtmpSource`).
 * @returns {Promise<boolean>}
 */
export async function compositeHandledBySteps(db, apiKey, settings = null) {
  if (!compositeInStep(settings)) return false;
  if (!stepsActive(settings)) return false;
  const rows = await db.outputs.findMany({ where: { owner_api_key: apiKey, enabled: 1 }, select: { dsk_json: true } });
  for (const row of rows) {
    const names = parseJson(row.dsk_json, []);
    if ((await effectiveDskViewports(db, apiKey, names, settings)).some(v => v.composite)) return true;
  }
  return false;
}

/** The output that stands for the project's program picture: the first enabled output reading the primary feed. */
export async function programOutputId(db, apiKey) {
  const primary = await db.api_keys.findUnique({ where: { key: apiKey }, select: { primary_feed_id: true } });
  if (!primary?.primary_feed_id) return null;
  const row = await db.outputs.findFirst({
    where: { owner_api_key: apiKey, enabled: 1, source_type: 'feed', source_id: primary.primary_feed_id },
    orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  return row?.id ?? null;
}

/**
 * The MediaMTX path an output reads: its feed, or, when it is built on an output, that output's final picture (its crop
 * when crop is enabled, else its DSK step when it has one, else whatever that output itself reads).
 * @returns {Promise<string|null>}
 */
export async function outputSourcePath(db, apiKey, outputId, defaultOutputId = null, settings = null) {
  let cursor = outputId;
  for (let i = 0; i < MAX_CROP_SOURCE_DEPTH; i++) {
    const out = await db.outputs.findFirst({ where: { id: cursor, owner_api_key: apiKey }, select: { id: true, source_type: true, source_id: true } });
    if (!out) return null;
    if (out.source_type === 'feed') {
      const feed = await db.prod_feeds.findFirst({ where: { id: out.source_id, owner_api_key: apiKey }, select: { feed_key: true } });
      return feed?.feed_key ?? null;
    }
    const parent = await db.outputs.findFirst({ where: { id: out.source_id, owner_api_key: apiKey }, select: { id: true, crop_enabled: true, dsk_json: true, enabled: true } });
    if (!parent) return null;
    if (parent.crop_enabled === 1) return outputCropPath(apiKey, parent.id, parent.id === defaultOutputId);
    if (parent.enabled !== 0 && stepsActive(settings) && (await effectiveDskViewports(db, apiKey, parseJson(parent.dsk_json, []), settings)).length) return outputDskPath(parent.id);
    cursor = parent.id;
  }
  return null;
}
