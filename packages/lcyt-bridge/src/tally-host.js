/**
 * TallyHost — runs tally lamps on the bridge's LAN (stream-light, vendored).
 *
 * Two ways a lamp gets its colour here:
 *   - `light_set` commands: the backend polls YouTube (live signal) and sends every
 *     reading. This host only holds the lamp output; the output itself is the deadman
 *     (no reading within the reading's ttl → the UNKNOWN look), so a dead backend or a
 *     cut link can never leave a lamp saying "live".
 *   - camera lights configured for this bridge (GET /api/v1/tally/bridge/lights): the
 *     bridge reads program/preview from the ATEM itself and drives the lamp.
 *
 * Every lamp address and ATEM host is checked with `check(type, command)` (the bridge's
 * security layers) before anything is opened.
 */
import { createLight } from '../vendor/stream-light/core/light.js';
import { KINDS, STATES, lookFor } from '../vendor/stream-light/core/states.js';
import { parseReading, makeReading } from '../vendor/stream-light/core/reading.js';
import { createTallyMaOutput } from '../vendor/stream-light/outputs/tally-ma.js';
import { createWebhookOutput } from '../vendor/stream-light/outputs/webhook.js';
import { createPushSource, atemTallyState } from '../vendor/stream-light/sources/push.js';
import { TALLY_MA_DEFAULT_PORT, validateLightConfig } from '../vendor/stream-light/core/config.js';

const DARK = Object.freeze({ rgb: [0, 0, 0], blink: false });

const isLook = (l) => l && Array.isArray(l.rgb) && l.rgb.length === 3 && l.rgb.every((n) => Number.isInteger(n) && n >= 0 && n <= 255);

/** Same shape the backend sends: { STATE: { rgb, blink } }. Anything malformed falls back to the defaults. */
function ctxFor(kind, looks, clock) {
  return {
    kind,
    now: () => clock.now(),
    lookFor: (state) => (isLook(looks?.[state]) ? { rgb: looks[state].rgb, blink: Boolean(looks[state].blink) } : lookFor(kind, state)),
  };
}

function outputKey(output) {
  return output.type === 'tally-ma' ? `tally-ma:${output.host}:${output.port ?? TALLY_MA_DEFAULT_PORT}` : `webhook:${output.url}`;
}

export class TallyHost {
  /**
   * @param {object} opts
   * @param {import('./atem-pool.js').AtemPool} opts.atemPool
   * @param {(type: string, cmd: object) => string|null} opts.check  block reason or null (the bridge's _checkSecurity)
   * @param {(err: Error) => void} [opts.onError]
   * @param {typeof fetch} [opts.fetch]
   * @param {{ now: () => number }} [opts.clock]
   * @param {(opts: object) => object} [opts.createLampOutput] test seam
   */
  constructor({ atemPool, check, onError = () => {}, fetch: fetchImpl = globalThis.fetch, clock = { now: () => Date.now() }, createLampOutput } = {}) {
    this._atemPool = atemPool;
    this._check = check;
    this._onError = onError;
    this._fetch = fetchImpl;
    this._clock = clock;
    this._createLampOutput = createLampOutput;
    /** @type {Map<string, { key: string, output: object, kind: string }>} lights driven by light_set */
    this._remote = new Map();
    /** @type {Map<string, { signature: string, light: object, output: object, off: Function }>} */
    this._camera = new Map();
    this._destroyed = false;
    this._onAtemState = (host, state) => this._atemState(host, state);
    this._onAtemDown = (host) => this._atemDown(host);
    atemPool?.on('atem:state', this._onAtemState);
    atemPool?.on('atem:disconnected', this._onAtemDown);
    /** @type {Map<string, Set<{ input: number, meIndex: number, push: Function }>>} */
    this._atemWatchers = new Map();
  }

  _makeOutput(output) {
    if (this._createLampOutput) return this._createLampOutput(output);
    if (output.type === 'tally-ma') {
      return createTallyMaOutput({ host: output.host, port: output.port ?? TALLY_MA_DEFAULT_PORT, onError: this._onError });
    }
    if (output.type === 'webhook') {
      return createWebhookOutput({ url: output.url, lightId: output.lightId, name: output.name, fetch: this._fetch, onError: this._onError });
    }
    throw new Error(`unsupported output type ${output.type}`);
  }

  // ---- light_set ---------------------------------------------------------

  /**
   * Handle a `light_set` command. Returns { ok, error? }.
   * `release: true` darkens the lamp and forgets the light (it was deleted or disabled).
   */
  async lightSet(cmd) {
    if (this._destroyed) return { ok: false, error: 'tally host stopped' };
    if (typeof cmd.lightId !== 'string' || !cmd.lightId) return { ok: false, error: 'lightId is required' };
    if (!KINDS.includes(cmd.kind)) return { ok: false, error: 'invalid kind' };
    const output = cmd.output;
    if (!output || (output.type !== 'tally-ma' && output.type !== 'webhook')) return { ok: false, error: 'output must be tally-ma or webhook' };
    const key = outputKey(output);

    if (cmd.release) {
      const entry = this._remote.get(cmd.lightId);
      if (entry) await this._release(cmd.lightId, entry, cmd.kind);
      return { ok: true };
    }

    const parsed = parseReading(cmd.kind, cmd.reading);
    if (!parsed.ok) return { ok: false, error: parsed.error };

    let entry = this._remote.get(cmd.lightId);
    if (entry && entry.key !== key) {
      await this._release(cmd.lightId, entry, cmd.kind);
      entry = undefined;
    }
    if (!entry) {
      entry = { key, kind: cmd.kind, output: this._makeOutput({ ...output, lightId: cmd.lightId, name: cmd.name ?? cmd.lightId }) };
      this._remote.set(cmd.lightId, entry);
    }
    await entry.output.apply(parsed.reading, ctxFor(cmd.kind, cmd.looks, this._clock));
    return { ok: true };
  }

  async _release(lightId, entry, kind) {
    this._remote.delete(lightId);
    try {
      await entry.output.apply(makeReading({ state: 'OFF', ttlMs: 3_600_000, checkedAt: this._clock.now() }), { kind, now: () => this._clock.now(), lookFor: () => DARK });
      await entry.output.close?.();
    } catch (err) { this._onError(err); }
  }

  // ---- camera lights run here ---------------------------------------------

  /**
   * Make the running camera lights match the list the backend sent.
   * @param {Array<object>} lights  light configs (validated again here)
   */
  async syncCameraLights(lights) {
    if (this._destroyed) return;
    const wanted = new Map();
    for (const raw of lights ?? []) {
      const res = validateLightConfig(raw);
      if (!res.ok) { this._onError(new Error(`tally light ${raw?.id ?? '?'}: ${res.errors.join('; ')}`)); continue; }
      const cfg = { ...res.value, id: String(raw.id ?? '') };
      if (!cfg.id || !cfg.enabled || cfg.kind !== 'camera' || cfg.source.type !== 'atem' || !cfg.source.host) continue;
      wanted.set(cfg.id, cfg);
    }
    for (const [id, running] of [...this._camera]) {
      const cfg = wanted.get(id);
      if (!cfg || running.signature !== JSON.stringify(cfg)) await this._stopCamera(id, !cfg);
    }
    for (const [id, cfg] of wanted) {
      if (this._camera.has(id)) continue;
      const blocked = this._check('light_set', { output: cfg.output }) || this._check('atem_switch', { host: cfg.source.host });
      if (blocked) { this._onError(new Error(`tally light "${cfg.name}": ${blocked}`)); continue; }
      this._startCamera(cfg);
    }
  }

  _startCamera(cfg) {
    const source = createPushSource();
    const output = this._makeOutput({ ...cfg.output, lightId: cfg.id, name: cfg.name });
    const light = createLight({ kind: 'camera', source, outputs: [output], look: cfg.look, onError: this._onError });
    const watcher = { input: cfg.source.input, meIndex: cfg.source.meIndex ?? 0, push: (r) => source.push(r) };
    const set = this._atemWatchers.get(cfg.source.host) ?? new Set();
    set.add(watcher);
    this._atemWatchers.set(cfg.source.host, set);
    this._camera.set(cfg.id, { signature: JSON.stringify(cfg), light, output, host: cfg.source.host, watcher, kind: 'camera' });
    light.start();
    watcher.push({ state: 'UNKNOWN', detail: 'waiting for the switcher' });
    try { this._atemPool.connect(cfg.source.host); } catch (err) { this._onError(err); }
    const state = this._atemPool.state?.(cfg.source.host);
    if (state) this._atemState(cfg.source.host, state);
  }

  async _stopCamera(id, dark) {
    const running = this._camera.get(id);
    if (!running) return;
    this._camera.delete(id);
    this._atemWatchers.get(running.host)?.delete(running.watcher);
    try { running.light.stop(); } catch { /* ignore */ }
    if (dark) {
      try {
        await running.output.apply(makeReading({ state: 'OFF', ttlMs: 3_600_000, checkedAt: this._clock.now() }), { kind: 'camera', now: () => this._clock.now(), lookFor: () => DARK });
      } catch (err) { this._onError(err); }
    }
    try { await running.output.close?.(); } catch (err) { this._onError(err); }
  }

  _atemState(host, state) {
    for (const w of this._atemWatchers.get(host) ?? []) {
      const s = atemTallyState(state, { meIndex: w.meIndex, input: w.input });
      w.push(s ? { state: s } : { state: 'UNKNOWN', detail: 'no switcher state' });
    }
  }

  _atemDown(host) {
    for (const w of this._atemWatchers.get(host) ?? []) w.push({ state: 'UNKNOWN', detail: 'switcher disconnected' });
  }

  /** Status for Bridge.status(). */
  status() {
    return {
      remote: [...this._remote.keys()],
      camera: [...this._camera.keys()],
    };
  }

  async destroy() {
    this._destroyed = true;
    this._atemPool?.off('atem:state', this._onAtemState);
    this._atemPool?.off('atem:disconnected', this._onAtemDown);
    for (const id of [...this._camera.keys()]) await this._stopCamera(id, false);
    // Closing shows the UNKNOWN look: a stopped bridge must not leave a lamp saying "live".
    for (const entry of this._remote.values()) { try { await entry.output.close?.(); } catch { /* ignore */ } }
    this._remote.clear();
  }
}
