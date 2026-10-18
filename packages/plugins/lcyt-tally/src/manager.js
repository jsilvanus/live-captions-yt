/**
 * TallyManager — runs the lights that belong to this backend.
 *
 * Where a light runs (`runner`):
 *   backend  this process drives the lamp (UDP/HTTP from the server). Only allowed in
 *            local install mode, where the server sits on the same LAN as the lamp;
 *            on a hosted server a lamp is never reached directly.
 *   bridge   a bridge on the LAN drives the lamp. For a live signal the backend still
 *            polls YouTube and sends every reading to the bridge as `light_set`; the
 *            bridge holds the deadman. A camera light is run by the bridge itself.
 *   auto     backend in local mode, otherwise the bridge named on the light.
 *
 * Status-only outputs (`console`, `web`) run anywhere: they only feed the status API.
 */
import { createLight } from '../vendor/stream-light/core/light.js';
import { STATES, lookFor } from '../vendor/stream-light/core/states.js';
import { makeReading, effectiveState } from '../vendor/stream-light/core/reading.js';
import { createYoutubeSource } from '../vendor/stream-light/sources/youtube.js';
import { createPushSource } from '../vendor/stream-light/sources/push.js';
import { createTallyMaOutput } from '../vendor/stream-light/outputs/tally-ma.js';
import { createWebhookOutput } from '../vendor/stream-light/outputs/webhook.js';
import { rowToConfig, listAllLights, getLight } from './db.js';

const STATUS_ONLY = new Set(['console', 'web']);

/** A camera light that follows LCYT's own software mixer: the backend feeds it, like a live signal. */
export const isMixerLight = (cfg) => cfg.kind === 'camera' && cfg.source?.type === 'lcyt';
/** A camera light whose switcher state only a bridge on the LAN can read (ATEM, OBS). */
const isSwitcherLight = (cfg) => cfg.kind === 'camera' && !isMixerLight(cfg);
const TEST_TTL_MS = 10_000;

/** @returns {{ runner: 'backend'|'bridge'|'none', reason?: string }} */
export function resolveRunner(cfg, { localMode }) {
  if (STATUS_ONLY.has(cfg.output.type)) return { runner: 'backend' };
  let runner = cfg.runner ?? 'auto';
  if (runner === 'auto') {
    // A camera light needs the switcher's state, which only a bridge reads for now, so a named bridge wins.
    if (isSwitcherLight(cfg) && cfg.bridgeInstanceId) runner = 'bridge';
    else runner = localMode ? 'backend' : (cfg.bridgeInstanceId ? 'bridge' : 'none');
  }
  if (runner === 'none') return { runner: 'none', reason: 'Choose a bridge: this server cannot reach a lamp itself' };
  if (runner === 'backend' && !localMode) {
    return { runner: 'none', reason: 'The server only drives lamps itself in local install mode; use a bridge' };
  }
  if (runner === 'bridge' && !cfg.bridgeInstanceId) return { runner: 'none', reason: 'No bridge chosen' };
  return { runner };
}

export function createTallyManager({
  db, bridgeManager = null, getAccessToken = null, youtubeApiKey = '', getActiveSource = null,
  localMode = false, fetch: fetchImpl = globalThis.fetch, clock, log = () => {},
} = {}) {
  /** @type {Map<string, object>} id → entry */
  const entries = new Map();

  function setStatus(entry, patch) { Object.assign(entry.status, patch); }

  function buildSource(cfg, apiKey, entry) {
    if (cfg.kind === 'camera') {
      entry.push = createPushSource();
      return entry.push;
    }
    const useToken = getAccessToken && (cfg.source.mode === 'A' || !youtubeApiKey);
    return createYoutubeSource({
      mode: cfg.source.mode, videoId: cfg.source.videoId, fetch: fetchImpl,
      getAccessToken: useToken ? (opts) => getAccessToken(apiKey, cfg.source.credentialId, opts) : undefined,
      apiKey: useToken ? undefined : youtubeApiKey || undefined,
    });
  }

  function buildOutputs(cfg, runner, entry, onError) {
    const outputs = [{
      name: 'status',
      apply(reading) { entry.reading = reading; entry.receivedAt = (clock ?? Date).now(); },
    }];
    if (STATUS_ONLY.has(cfg.output.type)) return outputs;
    if (runner === 'bridge') {
      const instanceId = cfg.bridgeInstanceId;
      outputs.push({
        name: `bridge:${instanceId}`,
        async apply(reading, ctx) {
          // The bridge holds the deadman, so it needs every look (UNKNOWN included), not only the current one.
          const looks = Object.fromEntries(STATES[cfg.kind].map((s) => [s, ctx.lookFor(s)]));
          await bridgeManager.sendCommand(instanceId, {
            type: 'light_set', lightId: cfg.id, kind: cfg.kind, output: cfg.output, reading, looks,
          });
        },
      });
    } else if (cfg.output.type === 'tally-ma') {
      outputs.push(createTallyMaOutput({ host: cfg.output.host, port: cfg.output.port, onError: (e) => onError(e, { output: 'tally-ma' }), clock }));
    } else if (cfg.output.type === 'webhook') {
      outputs.push(createWebhookOutput({ url: cfg.output.url, lightId: cfg.id, name: cfg.name, fetch: fetchImpl, onError: (e) => onError(e, { output: 'webhook' }) }));
    }
    return outputs;
  }

  /** Show the mixer's current program input right away; without one the light stays UNKNOWN until the first switch. */
  function seedMixerLight(entry) {
    const { mixerId, input } = entry.cfg.source;
    let active = null;
    try { active = getActiveSource?.(mixerId) ?? null; } catch { /* mixer not connected */ }
    entry.push.push(mixerReading(active, input, entry.cfg, (clock ?? Date).now()));
  }

  async function startEntry(row) {
    const cfg = rowToConfig(row);
    const apiKey = row.api_key;
    const entry = {
      cfg, apiKey, light: null, outputs: [], push: null, reading: null, receivedAt: 0,
      status: { id: cfg.id, name: cfg.name, kind: cfg.kind, enabled: cfg.enabled, runner: 'none', error: null, note: null },
    };
    entries.set(cfg.id, entry);
    if (!cfg.enabled) { setStatus(entry, { note: 'Disabled' }); return entry; }

    const { runner, reason } = resolveRunner(cfg, { localMode });
    setStatus(entry, { runner });
    if (runner === 'none') { setStatus(entry, { note: reason }); return entry; }
    if (runner === 'bridge' && !bridgeManager) { setStatus(entry, { runner: 'none', note: 'Bridges are not available on this server' }); return entry; }
    if (runner === 'bridge' && isSwitcherLight(cfg)) {
      setStatus(entry, { note: 'Runs on the bridge' });
      return entry;
    }

    const onError = (err, info) => {
      setStatus(entry, { error: `${info?.output ? `${info.output}: ` : ''}${err.message}` });
      log(`[tally] ${cfg.name}: ${err.message}`);
    };
    try {
      const source = buildSource(cfg, apiKey, entry);
      entry.outputs = buildOutputs(cfg, runner, entry, onError);
      entry.light = createLight({
        kind: cfg.kind, source, outputs: entry.outputs, look: cfg.look, clock, onError,
        onChange: () => setStatus(entry, { error: null }),
      });
      entry.light.start();
      if (isMixerLight(cfg)) seedMixerLight(entry);
    } catch (err) {
      onError(err);
    }
    return entry;
  }

  function stopEntry(id) {
    const entry = entries.get(id);
    if (!entry) return;
    try { entry.light?.stop(); } catch { /* already stopped */ }
    for (const o of entry.outputs) { try { o.close?.(); } catch { /* ignore */ } }
    entries.delete(id);
  }

  /**
   * A light that ran on a bridge and no longer does (deleted, disabled, another lamp or bridge)
   * must not leave its lamp lit: tell the bridge to darken it. Bridges that gained or lost a
   * camera light are told to look at their light list again.
   */
  async function handOver(old, next) {
    if (!bridgeManager) return;
    const was = old && old.status.runner === 'bridge' ? old.cfg : null;
    const is = next && next.status.runner === 'bridge' ? next.cfg : null;
    const sameLamp = was && is && was.bridgeInstanceId === is.bridgeInstanceId
      && JSON.stringify(was.output) === JSON.stringify(is.output);
    if (was && !isSwitcherLight(was) && !sameLamp) {
      try {
        await bridgeManager.sendCommand(was.bridgeInstanceId, { type: 'light_set', lightId: was.id, kind: was.kind, output: was.output, release: true });
      } catch (err) { log(`[tally] could not release the lamp of "${was.name}": ${err.message}`); }
    }
    const notify = new Set([was?.bridgeInstanceId, is?.bridgeInstanceId].filter(Boolean));
    for (const id of notify) bridgeManager.broadcastTallyUpdated?.(id);
  }

  return {
    async start() {
      for (const row of await listAllLights(db)) await startEntry(row);
    },
    stop() { for (const id of [...entries.keys()]) stopEntry(id); },

    /** (Re)start one light after it was created or changed. */
    async sync(apiKey, id) {
      const old = entries.get(id);
      stopEntry(id);
      const row = await getLight(db, apiKey, id);
      const entry = row ? await startEntry(row) : null;
      await handOver(old, entry);
    },
    async remove(id) {
      const old = entries.get(id);
      stopEntry(id);
      await handOver(old, null);
    },

    /** Status of every light of a project. */
    status(apiKey) {
      const now = (clock ?? Date).now();
      return [...entries.values()].filter((e) => e.apiKey === apiKey).map((e) => ({
        ...e.status,
        state: e.reading ? effectiveState(e.reading, e.receivedAt, now) : (e.light ? 'UNKNOWN' : null),
        detail: e.reading?.detail ?? null,
        checkedAt: e.reading?.checkedAt ?? null,
      }));
    },

    /** Show a state on the lamp for a few seconds (the next real reading replaces it). */
    async test(apiKey, id, state) {
      const entry = entries.get(id);
      if (!entry || entry.apiKey !== apiKey) return { ok: false, error: 'not found' };
      if (!entry.outputs.length) return { ok: false, error: entry.status.note || 'This light is not running here' };
      const reading = makeReading({ state, ttlMs: TEST_TTL_MS, checkedAt: (clock ?? Date).now() });
      const ctx = { kind: entry.cfg.kind, now: () => (clock ?? Date).now(), lookFor: (s) => lookFor(entry.cfg.kind, s, entry.cfg.look) };
      for (const o of entry.outputs) await o.apply(reading, ctx);
      return { ok: true };
    },

    /**
     * LCYT's software mixer switched its program input: every mixer light of that mixer follows.
     * The mixer inputs are not project-scoped, so every project's light on this mixer reacts.
     */
    onProgramChanged({ mixerId, inputNumber }) {
      const now = (clock ?? Date).now();
      for (const entry of entries.values()) {
        if (!entry.push || !isMixerLight(entry.cfg) || entry.cfg.source.mixerId !== mixerId) continue;
        entry.push.push(mixerReading(inputNumber, entry.cfg.source.input, entry.cfg, now));
      }
    },

    /** Camera lights: the host feeds the switcher state in (backend runner only). */
    pushReading(id, reading) {
      const entry = entries.get(id);
      if (!entry?.push) return false;
      entry.push.push(reading);
      return true;
    },
  };
}

/** A mixer has only a program input: that one is PGM, the rest OFF, and nothing selected yet is UNKNOWN. */
function mixerReading(activeInput, input, cfg, now) {
  if (activeInput == null) return { state: 'UNKNOWN', detail: 'no program input selected yet' };
  return { state: activeInput === input ? 'PGM' : 'OFF', checkedAt: now };
}
