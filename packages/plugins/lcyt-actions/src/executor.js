/**
 * ActionExecutor — runs a named or inline composite action on the server.
 * See docs/plans/plan_backend_actions.md.
 *
 * The expression grammar is the one the web client already uses
 * (`lcyt/actions`): `|`-separated ordered items, each `@name` or
 * `metacode:value`. The executor is generic: it knows nothing about cameras or
 * mixers. The composition root injects one handler per server atom key
 * (`camera`, `mixer`, `crop`, `api`, …); `wait:<n>s|ms` is built in. Every other
 * atom (audio, section, variables, …) belongs to a browser and is returned in
 * `clientAtoms` for the caller to apply, never silently dropped.
 *
 * A handler is `async (apiKey, value, meta) => { ok, error?, code? }` or
 * `{ run, device: true, deviceKey?: (value) => string }`. `device: true` marks
 * steps that move hardware; a run started with `skipDevices` reports those as
 * `skipped` (the disarmed case). `deviceKey` names the physical device a step
 * moves (default: the atom key); a run started with `deviceCooldown` skips a
 * device step when the same device was commanded less than `deviceCooldownMs`
 * ago by anyone (`reason: 'device_cooldown'`). `meta.metacode` is the atom key
 * as written, so `graphics[vertical-left]:+logo` reaches the `graphics`
 * handler with its viewport.
 *
 * Lifecycle events on the project bus: `action.started`, `action.step`,
 * `action.completed` (every step ok or skipped) or `action.failed`.
 */
import crypto from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';
import { parseActionItems, expandActionItems } from 'lcyt/actions';
import { getActionDefBySlug } from './db.js';

export const MAX_WAIT_MS = 30_000;
const DEFAULT_STEP_TIMEOUT_MS = 15_000;
export const DEFAULT_DEVICE_COOLDOWN_MS = 1000;

/**
 * Causation of the action run currently executing, carried through every await
 * and synchronous callback it triggers. A cue that fires inside a run (the bus
 * delivers `cue.fired` to taps synchronously) therefore sees its parent run and
 * can count one level deeper: the real loop guard. Feedback that arrives later
 * from a device socket has no context; the dispatcher's time window covers it.
 * @type {AsyncLocalStorage<{ rootId: string, depth: number, runId: string }>}
 */
const causationStore = new AsyncLocalStorage();

/** @returns {{ rootId: string, depth: number, runId: string }|undefined} */
export function currentCausation() {
  return causationStore.getStore();
}

/** `graphics[vertical-left]` → `graphics` */
function baseKey(metacode) {
  return String(metacode).toLowerCase().replace(/\[[^\]]*\]$/, '');
}

/**
 * Parse `wait:` values: `500ms`, `2s`, `1.5s` (bare number = seconds).
 * @param {string} value
 * @returns {number|null} milliseconds, clamped to MAX_WAIT_MS; null if invalid
 */
export function parseWaitMs(value) {
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s)?$/i.exec(String(value ?? '').trim());
  if (!m) return null;
  const ms = m[2]?.toLowerCase() === 'ms' ? Number(m[1]) : Number(m[1]) * 1000;
  return Math.min(Math.round(ms), MAX_WAIT_MS);
}

/**
 * @param {object} deps
 * @param {import('better-sqlite3').Database} deps.db
 * @param {import('lcyt/event-bus').EventBus|null} [deps.eventBus]
 * @param {Record<string, Function | { run: Function, device?: boolean, toIds?: Function, toLabels?: Function }>} [deps.handlers]
 * @param {number} [deps.stepTimeoutMs]
 */
export function createActionExecutor({
  db, eventBus = null, handlers = {}, stepTimeoutMs = DEFAULT_STEP_TIMEOUT_MS,
  deviceCooldownMs = DEFAULT_DEVICE_COOLDOWN_MS, now = Date.now,
}) {
  const deviceLast = new Map(); // `${apiKey}:${deviceKey}` -> ts
  const table = new Map(Object.entries(handlers).map(([key, h]) => [
    key.toLowerCase(),
    typeof h === 'function' ? { run: h, device: false } : { device: false, ...h },
  ]));

  function publish(apiKey, topic, data) {
    if (!eventBus || !apiKey) return;
    try { eventBus.publish(apiKey, topic, data); } catch { /* telemetry must not break a run */ }
  }

  /** @param {string} metacode */
  function isServerAtom(metacode) {
    return metacode === 'wait' || table.has(baseKey(metacode));
  }

  /** @param {string} metacode */
  function isDeviceAtom(metacode) {
    return table.get(baseKey(metacode))?.device === true;
  }

  function withTimeout(promise, ms) {
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Step timed out after ${ms} ms`)), ms); });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  function deviceKeyOf(handler, metacode, value) {
    const key = typeof handler.deviceKey === 'function' ? handler.deviceKey(value) : '';
    return key || baseKey(metacode);
  }

  /** True when the device this step moves was commanded less than deviceCooldownMs ago. */
  function cooledDown(apiKey, metacode, value) {
    if (!(deviceCooldownMs > 0)) return false;
    const handler = table.get(baseKey(metacode));
    const last = deviceLast.get(`${apiKey}:${deviceKeyOf(handler, metacode, value)}`);
    return last !== undefined && now() - last < deviceCooldownMs;
  }

  /**
   * Expand a run request to a flat atom list.
   * @returns {{ ok: true, atoms: Array, warnings: string[] } | { ok: false, code: string, error: string }}
   */
  function resolve(apiKey, { ref, expr }) {
    const warnings = [];
    let items;
    if (ref) {
      const slug = String(ref).replace(/^@/, '').trim();
      const row = getActionDefBySlug(db, apiKey, slug);
      if (!row) return { ok: false, code: 'not_found', error: `Unknown named action '${slug}'` };
      items = [{ ref: slug }]; // expand through the same cycle guard as nested refs
    } else if (typeof expr === 'string' && expr.trim()) {
      items = parseActionItems(expr);
    } else {
      return { ok: false, code: 'bad_request', error: 'ref or expr is required' };
    }
    const resolveDef = (name) => {
      const row = getActionDefBySlug(db, apiKey, name);
      return row ? parseActionItems(row.definition) : null;
    };
    const atoms = expandActionItems(items, resolveDef, (msg) => warnings.push(msg));
    return { ok: true, atoms, warnings };
  }

  /**
   * Run an action.
   * @param {string} apiKey
   * @param {{ ref?: string, expr?: string }} target
   * @param {{ source?: string, stopOnError?: boolean, skipDevices?: boolean, deviceCooldown?: boolean, causation?: object }} [opts]
   */
  function run(apiKey, target, opts = {}) {
    const parent = causationStore.getStore();
    const causation = opts.causation ?? (parent ? { rootId: parent.rootId, depth: parent.depth + 1 } : undefined);
    const runId = crypto.randomUUID();
    const ctx = { rootId: causation?.rootId ?? runId, depth: causation?.depth ?? 1, runId };
    return causationStore.run(ctx, () => runInner(apiKey, target, { ...opts, causation }, runId));
  }

  async function runInner(apiKey, target, opts, runId) {
    const { source = 'api', stopOnError = false, skipDevices = false, deviceCooldown = false, causation } = opts;
    const started = Date.now();
    const label = target.ref ? `@${String(target.ref).replace(/^@/, '')}` : String(target.expr ?? '');

    const resolved = resolve(apiKey, target);
    if (!resolved.ok) {
      publish(apiKey, 'action.failed', { runId, action: label, source, error: resolved.error, code: resolved.code, ...(causation && { causation }) });
      return { ...resolved, runId };
    }

    const { atoms, warnings } = resolved;
    publish(apiKey, 'action.started', { runId, action: label, source, steps: atoms.length, ...(causation && { causation }) });

    const steps = [];
    const clientAtoms = [];
    let aborted = false;

    for (let index = 0; index < atoms.length; index++) {
      const { metacode, value } = atoms[index];
      const atom = `${metacode}:${value}`;
      const t0 = Date.now();
      let step;

      if (aborted) {
        step = { index, atom, where: 'server', status: 'skipped', reason: 'aborted' };
      } else if (!isServerAtom(metacode)) {
        clientAtoms.push({ metacode, value });
        step = { index, atom, where: 'client', status: 'client' };
      } else if (skipDevices && isDeviceAtom(metacode)) {
        step = { index, atom, where: 'server', status: 'skipped', reason: 'disarmed' };
      } else if (deviceCooldown && isDeviceAtom(metacode) && cooledDown(apiKey, metacode, value)) {
        step = { index, atom, where: 'server', status: 'skipped', reason: 'device_cooldown' };
      } else if (metacode === 'wait') {
        const ms = parseWaitMs(value);
        if (ms === null) {
          step = { index, atom, where: 'server', status: 'error', error: `wait needs a duration like 2s or 500ms, got '${value}'`, code: 'bad_request' };
        } else {
          await new Promise((r) => setTimeout(r, ms));
          step = { index, atom, where: 'server', status: 'ok' };
        }
      } else {
        try {
          const handler = table.get(baseKey(metacode));
          if (handler.device) deviceLast.set(`${apiKey}:${deviceKeyOf(handler, metacode, value)}`, now());
          const result = await withTimeout(Promise.resolve(handler.run(apiKey, value, { source, runId, metacode, ...(causation && { causation }) })), stepTimeoutMs);
          step = result?.ok === false
            ? { index, atom, where: 'server', status: 'error', error: result.error ?? 'failed', ...(result.code && { code: result.code }) }
            : { index, atom, where: 'server', status: 'ok', ...(result?.transport && { transport: result.transport }) };
        } catch (err) {
          step = { index, atom, where: 'server', status: 'error', error: err.message };
        }
      }

      step.durationMs = Date.now() - t0;
      steps.push(step);
      publish(apiKey, 'action.step', { runId, action: label, source, ...step });
      if (step.status === 'error' && stopOnError) aborted = true;
    }

    const failed = steps.filter((s) => s.status === 'error').length;
    const ok = failed === 0;
    const durationMs = Date.now() - started;
    publish(apiKey, ok ? 'action.completed' : 'action.failed', {
      runId, action: label, source, ok, steps: steps.length, failed, durationMs,
      ...(causation && { causation }),
    });
    return { ok, runId, steps, clientAtoms, warnings, durationMs };
  }

  /**
   * Rewrite the device references of an expression: 'ids' stores camera/mixer/
   * preset ids (what a save persists, so renaming a device cannot break it),
   * 'labels' shows the current label slugs again (what an editor loads).
   * Handlers opt in with `toIds(apiKey, value)` / `toLabels(apiKey, value)`
   * returning the new value, or null/undefined to leave the atom as written
   * (unknown or ambiguous references still fail at run time, as before).
   * `@name` refs, wait steps and atoms without a hook are kept verbatim.
   * @param {string} apiKey
   * @param {string} expr
   * @param {'ids'|'labels'} direction
   * @returns {string}
   */
  function rewriteDeviceRefs(apiKey, expr, direction) {
    if (typeof expr !== 'string' || !expr.trim()) return expr;
    const hook = direction === 'ids' ? 'toIds' : 'toLabels';
    let changed = false;
    const parts = expr.split('|').map((part) => {
      const p = part.trim();
      const colon = p.indexOf(':');
      if (!p || p.startsWith('@') || colon <= 0) return p;
      const key = p.slice(0, colon).trim();
      const handler = table.get(baseKey(key.toLowerCase()));
      if (typeof handler?.[hook] !== 'function') return p;
      const value = p.slice(colon + 1).trim();
      let next;
      try { next = handler[hook](apiKey, value); } catch { next = null; }
      if (typeof next !== 'string' || !next || next === value) return p;
      changed = true;
      return `${key}:${next}`;
    });
    return changed ? parts.filter(Boolean).join(' | ') : expr;
  }

  return { run, resolve, isServerAtom, isDeviceAtom, rewriteDeviceRefs };
}
