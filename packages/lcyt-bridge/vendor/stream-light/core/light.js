/**
 * The light controller: turns a source into readings and hands them to outputs.
 *
 * Pull source:  { poll(): Promise<{ state, detail? }> }   (YouTube)
 * Push source:  { subscribe(emit): () => void }            (switcher events)
 * Output:       { name, apply(reading, ctx), close?() }
 *
 * Liveness, two layers (see the project plan):
 *   1. here: a pull source that has not answered successfully for `staleFactor`
 *      poll intervals turns the reading into UNKNOWN;
 *   2. in every output: no reading within `ttlMs` shows the UNKNOWN look. To keep
 *      layer 2 quiet while all is well, the current reading is re-applied every
 *      `ttlMs / 3`.
 */
import { DEFAULT_TTL_MS, makeReading } from './reading.js';
import { isState, lookFor } from './states.js';

export const realClock = Object.freeze({
  now: () => Date.now(),
  setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; },
  clearTimeout: (t) => clearTimeout(t),
});

const ACTIVE_STATES = new Set(['LIVE', 'DEGRADED', 'STARTING', 'PGM', 'PRV', 'UNKNOWN']);

export function createLight({
  kind,
  source,
  outputs = [],
  look = {},
  ttlMs = DEFAULT_TTL_MS,
  activeMs = 20_000,
  idleMs = 60_000,
  debounce = 2,
  failuresToUnknown = 2,
  staleFactor = 3,
  clock = realClock,
  onChange = () => {},
  onError = () => {},
} = {}) {
  if (!source || (typeof source.poll !== 'function' && typeof source.subscribe !== 'function')) {
    throw new TypeError('source needs poll() or subscribe()');
  }

  let reading = null;
  let running = false;
  let pollTimer = null;
  let keepAliveTimer = null;
  let unsubscribe = null;
  let pending = null;           // { state, detail, count }
  let failures = 0;
  let lastSuccessAt = null;
  let lastIntervalMs = activeMs;
  let pollSeq = 0;

  const ctx = { kind, now: () => clock.now(), lookFor: (state) => lookFor(kind, state, look) };

  async function deliver(output, r) {
    try {
      await output.apply(r, ctx);
    } catch (err) {
      onError(err, { output: output.name });
    }
  }

  function deliverAll() {
    if (!reading) return Promise.resolve();
    const r = reading;
    return Promise.all(outputs.map((o) => deliver(o, r)));
  }

  function commit(state, detail) {
    const changed = !reading || reading.state !== state;
    reading = makeReading({ state, detail, checkedAt: clock.now(), ttlMs });
    pending = null;
    if (changed) {
      try { onChange(reading); } catch (err) { onError(err, { output: 'onChange' }); }
    }
    return deliverAll();
  }

  // The first reading, a recovery from UNKNOWN and a drop to DEGRADED/UNKNOWN show at once;
  // other changes must repeat `debounce` times in a row.
  function immediate(to) {
    if (!reading || reading.state === 'UNKNOWN') return true;
    return to === 'DEGRADED' || to === 'UNKNOWN';
  }

  function observe(state, detail) {
    if (!isState(kind, state)) {
      onError(new Error(`source returned state ${state}, not valid for kind ${kind}`), { output: 'source' });
      return handleFailure(new Error(`invalid state ${state}`));
    }
    failures = 0;
    lastSuccessAt = clock.now();
    if (reading && reading.state === state) {
      pending = null;
      reading = { ...reading, detail: detail ? String(detail) : undefined, checkedAt: clock.now() };
      if (!reading.detail) delete reading.detail;
      return deliverAll();
    }
    if (immediate(state)) return commit(state, detail);
    if (pending && pending.state === state) pending.count += 1;
    else pending = { state, detail, count: 1 };
    if (pending.count >= debounce) return commit(state, detail);
    // Not confirmed yet: keep the current reading alive.
    reading = { ...reading, checkedAt: clock.now() };
    return deliverAll();
  }

  function handleFailure(err) {
    failures += 1;
    onError(err, { output: 'source' });
    if (failures >= failuresToUnknown && (!reading || reading.state !== 'UNKNOWN')) {
      return commit('UNKNOWN', err?.message ? `source failed: ${err.message}` : 'source failed');
    }
    return Promise.resolve();
  }

  function nextDelay(err) {
    const base = reading && ACTIVE_STATES.has(reading.state) ? activeMs : idleMs;
    const backoff = Number(err?.backoffMs) || 0;
    return Math.max(base, backoff);
  }

  async function pollOnce() {
    const seq = ++pollSeq;
    let error = null;
    try {
      const result = await source.poll();
      if (running && seq === pollSeq) await observe(result?.state, result?.detail);
    } catch (err) {
      error = err;
      if (running && seq === pollSeq) await handleFailure(err);
    }
    if (!running) return;
    lastIntervalMs = nextDelay(error);
    pollTimer = clock.setTimeout(pollOnce, lastIntervalMs);
  }

  function keepAlive() {
    keepAliveTimer = clock.setTimeout(keepAlive, Math.max(1000, Math.floor(ttlMs / 3)));
    if (!reading) return;
    if (typeof source.poll === 'function' && lastSuccessAt != null
        && clock.now() - lastSuccessAt > staleFactor * lastIntervalMs && reading.state !== 'UNKNOWN') {
      commit('UNKNOWN', 'no answer from the source');
      return;
    }
    deliverAll();
  }

  return {
    start() {
      if (running) return;
      running = true;
      failures = 0;
      keepAliveTimer = clock.setTimeout(keepAlive, Math.max(1000, Math.floor(ttlMs / 3)));
      if (typeof source.subscribe === 'function') {
        unsubscribe = source.subscribe((r) => {
          if (!running) return;
          const state = r?.state;
          if (!isState(kind, state)) { onError(new Error(`source emitted invalid state ${state}`), { output: 'source' }); return; }
          commit(state, r.detail);
        });
        // Until the source reports, we do not know.
        commit('UNKNOWN', 'waiting for the source');
      } else {
        pollOnce();
      }
    },
    async stop({ closeOutputs = true } = {}) {
      running = false;
      if (pollTimer) clock.clearTimeout(pollTimer);
      if (keepAliveTimer) clock.clearTimeout(keepAliveTimer);
      pollTimer = keepAliveTimer = null;
      try { unsubscribe?.(); } catch { /* ignore */ }
      unsubscribe = null;
      if (closeOutputs) {
        await Promise.all(outputs.map(async (o) => { try { await o.close?.(); } catch (err) { onError(err, { output: o.name }); } }));
      }
    },
    snapshot() {
      return { kind, running, reading, failures, lastSuccessAt };
    },
  };
}
