/**
 * CueActionDispatcher — runs a cue rule's executable action when the cue fires
 * (docs/plans/plan_backend_actions.md).
 *
 * A rule opts in with `action: { "run": "@intro | camera:pulpit.wide" }`
 * (optionally `cooldownMs`, `stopOnError`). Rules without `run` keep their
 * descriptive actions and nothing happens here. The dispatcher listens for
 * `cue.fired` on the bus, so lcyt-cues needs no production dependency and other
 * event sources can be wired the same way later.
 *
 * Safety rails:
 * - Armed switch: while the project is disarmed the run still happens but its
 *   device steps are reported as skipped (`reason: 'disarmed'`).
 * - Only rules from the cue_rules table run. `explicit` cues carry no rule and
 *   `inline` cues come from rundown files, which any editor can change, so
 *   neither can start an action.
 * - Per-rule cooldown (default 2 s; `cooldownMs: 0` disables).
 * - Loop guard: a camera or mixer move can raise an event cue that moves
 *   another. A cue that fires while an action run is executing (the bus calls
 *   this synchronously inside the run's async context, see `currentCausation`)
 *   is exactly one level deeper than that run. Feedback that arrives later from
 *   a device has no such context, so cues raised by events (event, composite,
 *   sound, track) that follow a run in the same project within
 *   `chainWindowMs` count one level deeper as a fallback. Either way the depth
 *   travels to the executor as `causation { rootId, depth }`; past `maxDepth`
 *   the run is refused. Text-matched cues with no ambient run start a new chain.
 * - Device cooldown: cue runs skip a device step when that camera/mixer was
 *   commanded less than the executor's `deviceCooldownMs` ago (`device_cooldown`).
 *
 * - Rate cap: at most `maxRuns` cue-started runs per project in any `windowMs`
 *   sliding window (default 20 per 60 s; `maxRuns: 0` disables). It bounds
 *   feedback loops that the cooldowns and the 3 s loop-guard window miss
 *   (slow device feedback, many rules each within its own cooldown).
 *
 * Refusals publish `action.skipped { reason: 'cooldown' | 'loop_guard' | 'rate_limit' }`.
 * Browser atoms of a cue-started run are published as `action.client_atoms` so
 * connected UIs can apply them.
 */
import crypto from 'crypto';
import { currentCausation } from './executor.js';

export const DEFAULT_COOLDOWN_MS = 2000;
export const DEFAULT_CHAIN_WINDOW_MS = 3000;
export const DEFAULT_MAX_DEPTH = 3;
export const DEFAULT_RATE_MAX_RUNS = 20;
export const DEFAULT_RATE_WINDOW_MS = 60_000;

/** cue.fired sources that come from a cue_rules row. */
const RULE_SOURCES = new Set(['auto', 'event_cue', 'composite', 'sound', 'track']);
/** Sources raised by events rather than caption text, so they can be caused by an action. */
const CHAINING_SOURCES = new Set(['event_cue', 'composite', 'sound', 'track']);

/**
 * @param {object} deps
 * @param {import('lcyt/event-bus').EventBus} deps.eventBus
 * @param {{ run: Function }} deps.executor
 * @param {(apiKey: string) => boolean} deps.isArmed
 * @param {number} [deps.cooldownMs]
 * @param {number} [deps.chainWindowMs]
 * @param {number} [deps.maxDepth]
 * @param {number|(() => number)} [deps.maxRuns]   per-project cap per window, 0 = off; a function is read on every cue
 * @param {number|(() => number)} [deps.windowMs]
 * @param {() => number} [deps.now]
 */
export function createCueActionDispatcher({
  eventBus, executor, isArmed,
  cooldownMs = DEFAULT_COOLDOWN_MS,
  chainWindowMs = DEFAULT_CHAIN_WINDOW_MS,
  maxDepth = DEFAULT_MAX_DEPTH,
  maxRuns = DEFAULT_RATE_MAX_RUNS,
  windowMs = DEFAULT_RATE_WINDOW_MS,
  now = Date.now,
}) {
  const runTimes = new Map();   // apiKey -> timestamps of recent runs
  const read = (v, fallback) => {
    const n = Number(typeof v === 'function' ? v() : v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };

  /** Record a run and report whether the project is still under its cap. */
  function underRateCap(apiKey, t) {
    const cap = read(maxRuns, DEFAULT_RATE_MAX_RUNS);
    if (cap === 0) return true;
    const window = read(windowMs, DEFAULT_RATE_WINDOW_MS);
    const recent = (runTimes.get(apiKey) ?? []).filter((ts) => t - ts < window);
    if (recent.length >= cap) { runTimes.set(apiKey, recent); return false; }
    recent.push(t);
    runTimes.set(apiKey, recent);
    return true;
  }

  const lastFired = new Map();  // `${apiKey}:${ruleId}` -> ts
  const chains = new Map();     // apiKey -> { rootId, depth, lastAt }
  let untap = null;

  function skipped(apiKey, data, run, reason) {
    try {
      eventBus.publish(apiKey, 'action.skipped', { action: run, source: 'cue', ruleId: data.ruleId, label: data.label, reason });
    } catch { /* telemetry */ }
  }

  /**
   * Handle one `cue.fired` envelope.
   * @param {{ projectId: string, topic: string, data: object }} envelope
   * @returns {Promise<object|null>} the run result, or null when nothing ran
   */
  async function handle(envelope) {
    const apiKey = envelope?.projectId;
    const data = envelope?.data;
    const run = typeof data?.action?.run === 'string' ? data.action.run.trim() : '';
    if (!apiKey || !run || !data.ruleId || !RULE_SOURCES.has(data.source)) return null;

    const t = now();
    const coolKey = `${apiKey}:${data.ruleId}`;
    const wait = Number.isFinite(Number(data.action.cooldownMs)) && Number(data.action.cooldownMs) >= 0
      ? Number(data.action.cooldownMs) : cooldownMs;
    if (t - (lastFired.get(coolKey) ?? -Infinity) < wait) {
      skipped(apiKey, data, run, 'cooldown');
      return null;
    }

    const ambient = currentCausation();
    const prev = chains.get(apiKey);
    const inChain = !ambient && CHAINING_SOURCES.has(data.source) && prev && t - prev.lastAt <= chainWindowMs;
    const parent = ambient ?? (inChain ? prev : null);
    const causation = parent
      ? { rootId: parent.rootId, depth: parent.depth + 1, ruleId: data.ruleId }
      : { rootId: crypto.randomUUID(), depth: 1, ruleId: data.ruleId };
    if (causation.depth > maxDepth) {
      chains.set(apiKey, { rootId: causation.rootId, depth: parent.depth, lastAt: t }); // keep the window open while the loop keeps trying
      skipped(apiKey, data, run, 'loop_guard');
      return null;
    }

    if (!underRateCap(apiKey, t)) {
      skipped(apiKey, data, run, 'rate_limit');
      return null;
    }

    lastFired.set(coolKey, t);
    chains.set(apiKey, { rootId: causation.rootId, depth: causation.depth, lastAt: t });

    let result;
    try {
      result = await executor.run(apiKey, { expr: run }, {
        source: 'cue',
        stopOnError: data.action.stopOnError === true,
        skipDevices: !isArmed(apiKey),
        deviceCooldown: true,
        causation,
      });
    } finally {
      chains.set(apiKey, { rootId: causation.rootId, depth: causation.depth, lastAt: now() });
    }
    if (result?.clientAtoms?.length) {
      try {
        eventBus.publish(apiKey, 'action.client_atoms', { runId: result.runId, action: run, source: 'cue', atoms: result.clientAtoms });
      } catch { /* telemetry */ }
    }
    return result;
  }

  function start() {
    if (untap) return;
    untap = eventBus.tap((envelope) => {
      if (envelope.topic !== 'cue.fired') return;
      handle(envelope).catch(() => { /* a failed action must never break the cue path */ });
    });
  }

  function stop() {
    untap?.();
    untap = null;
  }

  return { start, stop, handle };
}
