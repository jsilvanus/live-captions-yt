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
 *   another. Cues raised by events (event, composite, sound, track) that follow
 *   a run in the same project within `chainWindowMs` count one level deeper
 *   (carried to the executor as `causation { rootId, depth }`); past `maxDepth`
 *   the run is refused. Text-matched cues always start a new chain.
 *
 * Refusals publish `action.skipped { reason: 'cooldown' | 'loop_guard' }`.
 * Browser atoms of a cue-started run are published as `action.client_atoms` so
 * connected UIs can apply them.
 */
import crypto from 'crypto';

export const DEFAULT_COOLDOWN_MS = 2000;
export const DEFAULT_CHAIN_WINDOW_MS = 3000;
export const DEFAULT_MAX_DEPTH = 3;

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
 * @param {() => number} [deps.now]
 */
export function createCueActionDispatcher({
  eventBus, executor, isArmed,
  cooldownMs = DEFAULT_COOLDOWN_MS,
  chainWindowMs = DEFAULT_CHAIN_WINDOW_MS,
  maxDepth = DEFAULT_MAX_DEPTH,
  now = Date.now,
}) {
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

    const prev = chains.get(apiKey);
    const inChain = CHAINING_SOURCES.has(data.source) && prev && t - prev.lastAt <= chainWindowMs;
    const causation = inChain
      ? { rootId: prev.rootId, depth: prev.depth + 1, ruleId: data.ruleId }
      : { rootId: crypto.randomUUID(), depth: 1, ruleId: data.ruleId };
    if (causation.depth > maxDepth) {
      chains.set(apiKey, { ...prev, lastAt: t }); // keep the window open while the loop keeps trying
      skipped(apiKey, data, run, 'loop_guard');
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
