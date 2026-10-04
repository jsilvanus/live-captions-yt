// Helpers for writing server-run action steps (docs/plans/plan_backend_actions.md).
// Device steps name a camera or mixer by the slug of its label, which is what
// lcyt-production's ProductionCommands resolves on the server (an id also works).
// Keep slugifyLabel identical to packages/plugins/lcyt-production/src/commands.js.

export const DEVICE_ATOM_KEYS = ['camera', 'mixer', 'obs', 'crop'];

export function slugifyLabel(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Slug a camera is addressed by in an atom: its label, else its name. */
export function cameraRef(camera) {
  return slugifyLabel(camera?.label || camera?.name) || String(camera?.id ?? '');
}

/** Slug a preset is addressed by: its label/name, else its preset number, else its id. */
export function presetRef(preset) {
  return slugifyLabel(preset?.label || preset?.name)
    || (preset?.presetNumber != null ? String(preset.presetNumber) : String(preset?.id ?? ''));
}

/** `camera:<camera>.<preset>` */
export function cameraAtom(camera, preset) {
  return `camera:${cameraRef(camera)}.${presetRef(preset)}`;
}

export function mixerRef(mixer) {
  return slugifyLabel(mixer?.name) || String(mixer?.id ?? '');
}

/** The inputs a mixer can be switched to: its configured inputs, each as { value, label }. */
export function mixerInputs(mixer) {
  const inputs = Array.isArray(mixer?.connectionConfig?.inputs) ? mixer.connectionConfig.inputs : [];
  return inputs
    .filter((i) => Number.isInteger(i?.number))
    .map((i) => {
      const name = i.sceneName || i.label || i.name;
      return { value: String(i.number), label: name ? `${i.number} · ${name}` : String(i.number) };
    });
}

/** `mixer:<mixer>.<input number>` */
export function mixerAtom(mixer, inputNumber) {
  return `mixer:${mixerRef(mixer)}.${inputNumber}`;
}

/** Refs that more than one device resolves to: those atoms are rejected as ambiguous by the server. */
export function duplicateRefs(devices, refFn) {
  const seen = new Map();
  for (const d of devices || []) seen.set(refFn(d), (seen.get(refFn(d)) || 0) + 1);
  return new Set([...seen].filter(([, n]) => n > 1).map(([ref]) => ref));
}

/** Append one step to a `|`-separated expression. */
export function appendStep(expr, step) {
  const base = String(expr ?? '').trim();
  const add = String(step ?? '').trim();
  if (!add) return base;
  return base ? `${base} | ${add}` : add;
}

/** True when any atom of the expression moves hardware (so saving it needs the Setup tier). */
export function runUsesDevices(expr) {
  return String(expr ?? '').split('|').some((part) => {
    const p = part.trim();
    if (!p || p.startsWith('@')) return false;
    const key = p.split(':')[0].trim().toLowerCase().replace(/\[.*\]$/, '');
    return DEVICE_ATOM_KEYS.includes(key);
  });
}

/**
 * Merge the cue-rule form fields into the rule's `action` object, keeping any
 * keys this form does not edit (so editing a rule never drops its other settings).
 * @param {object|undefined} existing
 * @param {{ label?: string, run?: string }} fields
 */
export function buildRuleAction(existing, { label = '', run = '' } = {}) {
  const next = { ...(existing || {}) };
  delete next.label; delete next.run;
  if (label) { next.type = next.type || 'event'; next.label = label; }
  else if (next.type === 'event') delete next.type;
  if (run.trim()) next.run = run.trim();
  return next;
}

const STEP_STATUS = { ok: 'done', error: 'failed', skipped: 'skipped', client: 'browser' };

/**
 * Fold one `action.*` bus envelope into a list of run summaries (newest first).
 * @param {Array} runs
 * @param {{ topic: string, ts?: number, data?: object }} env
 * @param {number} [max]
 */
export function foldActionEvent(runs, env, max = 30) {
  const d = env?.data || {};
  const topic = env?.topic;
  if (!topic || !topic.startsWith('action.')) return runs;
  const id = d.runId || `${topic}:${env.ts}`;
  const list = runs.slice();
  let i = list.findIndex((r) => r.runId === id);
  if (i === -1) {
    list.unshift({ runId: id, action: d.action || '', source: d.source || '', ts: env.ts || Date.now(), status: 'running', steps: [] });
    i = 0;
  }
  const run = { ...list[i], steps: list[i].steps.slice() };
  list[i] = run;
  if (d.action) run.action = d.action;
  if (d.source) run.source = d.source;
  switch (topic) {
    case 'action.started': run.status = 'running'; break;
    case 'action.step':
      run.steps.push({ index: d.index, atom: d.atom, status: STEP_STATUS[d.status] || d.status, reason: d.reason, error: d.error });
      break;
    case 'action.completed': run.status = 'done'; break;
    case 'action.failed': run.status = 'failed'; if (d.error) run.error = d.error; break;
    case 'action.skipped': run.status = 'skipped'; run.reason = d.reason; break;
    default: return runs;
  }
  return list.slice(0, max);
}
