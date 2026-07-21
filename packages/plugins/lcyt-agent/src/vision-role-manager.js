/**
 * VisionRoleManager (plan_ai_roles_framework.md, Runtime Shape 1) — one
 * shared manager parameterized by role, covering both Tracker and
 * Describer: a continuous background loop, wired to a VisionFrameFetcher on
 * one side and a pluggable vision-provider adapter on the other, emitting
 * result events as they arrive. Both roles are strictly non-action —
 * neither ever calls a camera/mixer tool; that's reserved for Assistant.
 *
 * Placement note (per the plan): this class lives in lcyt-agent, not
 * lcyt-rtmp, even though its frame source (VisionFrameFetcher) polls an
 * lcyt-rtmp-owned HTTP endpoint — lcyt-agent is the project's central AI
 * service, and HTTP-polling another plugin's already-public endpoint is the
 * same architectural pattern HlsSegmentFetcher already uses against
 * MediaMTX, just with the AI plugin as the consumer this time.
 */

import { randomUUID } from 'node:crypto';
import { VisionFrameFetcher } from './vision-frame-fetcher.js';
import { createVisionAdapter } from './vision-adapters/index.js';
import logger from 'lcyt/logger';

const TRACKER_PROMPT_DEFAULT = 'Identify and track the requested target(s) in this frame. Respond with JSON: {"objects":[{"label":"person","confidence":0.0-1.0,"bbox":{"x":0-1,"y":0-1,"w":0-1,"h":0-1}}]} — bbox values normalized 0-1 relative to the frame. Empty array if nothing found.';
const DESCRIBER_PROMPT_DEFAULT = 'Describe what is happening in this frame in one or two sentences.';
const DESCRIBER_PROMPT_JSON = 'Describe what is happening in this frame. Respond with JSON matching the requested schema.';

/**
 * How many (prompt, frame, result) captures to retain per (apiKey, roleCode)
 * for the AI Observability page's capture/replay ring buffer
 * (plan_ai_observability.md Stage 1 §2). Deliberately small and in-memory —
 * not a persisted table — per the plan's own "start small, revisit later"
 * open question; 20 is enough to browse "what did it see a minute ago"
 * without holding onto an unbounded number of JPEG frames in memory.
 */
const CAPTURE_LIMIT = 20;

/**
 * @param {string} roleCode — 'tracker' | 'describer'
 */
function buildPrompt(roleCode, harnessConfig) {
  if (harnessConfig.systemPromptOverride) return harnessConfig.systemPromptOverride;
  if (roleCode === 'tracker') {
    const target = harnessConfig.targetLabel ? ` Target: ${harnessConfig.targetLabel}.` : '';
    return TRACKER_PROMPT_DEFAULT + target;
  }
  return harnessConfig.outputMode === 'json' ? DESCRIBER_PROMPT_JSON : DESCRIBER_PROMPT_DEFAULT;
}

export class VisionRoleManager {
  /**
   * @param {import('./roles-bus.js').RolesBus} rolesBus
   */
  constructor(rolesBus) {
    this._rolesBus = rolesBus;
    /** @type {Map<string, { fetcher: VisionFrameFetcher, adapter: object, roleCode: string, lastUpdateAt: number|null, lastError: string|null }>} */
    this._sessions = new Map();
    /**
     * Capture ring buffers, keyed the same way as `_sessions`. Each entry:
     * `{ id, ts, prompt, frame: Buffer, outputMode, jsonSchema, result: {text,json}|null, error: string|null }`.
     * Survives stop()/start() (post-hoc debugging is the whole point) — only
     * evicted by size, never by session lifecycle.
     * @type {Map<string, Array<object>>}
     */
    this._captures = new Map();
  }

  _key(apiKey, roleCode) {
    return `${apiKey}:${roleCode}`;
  }

  _recordCapture(apiKey, roleCode, entry) {
    const key = this._key(apiKey, roleCode);
    let list = this._captures.get(key);
    if (!list) { list = []; this._captures.set(key, list); }
    list.push(entry);
    while (list.length > CAPTURE_LIMIT) list.shift();
  }

  /**
   * List captures for (apiKey, roleCode), newest first, with the raw frame
   * buffer stripped (fetch it separately via `getCapture()` — keeps the
   * browse-list response small).
   * @returns {Array<object>}
   */
  getCaptures(apiKey, roleCode) {
    const list = this._captures.get(this._key(apiKey, roleCode)) || [];
    return list.map(({ frame, ...meta }) => meta).reverse();
  }

  /**
   * @returns {object|null} the full capture entry (including `frame`), or null
   */
  getCapture(apiKey, roleCode, captureId) {
    const list = this._captures.get(this._key(apiKey, roleCode)) || [];
    return list.find((c) => c.id === captureId) || null;
  }

  /**
   * Prompt sandbox / replay (plan_ai_observability.md Stage 1 §3): re-run
   * `adapter.analyse()` against a previously captured frame, optionally with
   * an edited prompt, and return both the original live result and the new
   * one for diffing. Never persists `promptOverride` back to harness_config
   * and never touches the running poll loop — a bounded, explicit, one-shot
   * inference call outside the sampled continuous-vision cadence.
   *
   * @param {string} apiKey
   * @param {string} roleCode
   * @param {string} captureId
   * @param {{ apiSettings: object, vendor: string, promptOverride?: string }} opts
   * @returns {Promise<{ ok: boolean, error?: string, original?: object, replay?: object }>}
   */
  async replay(apiKey, roleCode, captureId, { apiSettings, vendor, promptOverride }) {
    const capture = this.getCapture(apiKey, roleCode, captureId);
    if (!capture) return { ok: false, error: 'Capture not found' };

    let adapter;
    try {
      adapter = createVisionAdapter(vendor, apiSettings);
    } catch (err) {
      return { ok: false, error: err.message };
    }

    const prompt = promptOverride && promptOverride.trim() ? promptOverride : capture.prompt;
    try {
      const result = await adapter.analyse([capture.frame], prompt, {
        outputMode: capture.outputMode,
        jsonSchema: capture.jsonSchema,
      });
      return {
        ok: true,
        original: { prompt: capture.prompt, result: capture.result, error: capture.error },
        replay: { prompt, result: { text: result.text ?? null, json: result.json ?? null } },
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * @param {string} apiKey
   * @param {string} roleCode — 'tracker' | 'describer'
   * @param {object} opts
   * @param {{ apiUrl: string, apiKey: string, model: string }} opts.apiSettings
   * @param {string} opts.vendor — provider vendor for adapter selection
   * @param {object} opts.harnessConfig
   * @returns {{ ok: boolean, error?: string }}
   */
  start(apiKey, roleCode, { apiSettings, vendor, harnessConfig = {} }) {
    const key = this._key(apiKey, roleCode);
    if (this._sessions.has(key)) return { ok: true, alreadyRunning: true };

    let adapter;
    try {
      adapter = createVisionAdapter(vendor, apiSettings);
    } catch (err) {
      return { ok: false, error: err.message };
    }

    const fetcher = new VisionFrameFetcher({ apiKey, pollIntervalMs: harnessConfig.pollIntervalMs });
    const session = { fetcher, adapter, roleCode, lastUpdateAt: null, lastError: null };
    this._sessions.set(key, session);

    const prompt = buildPrompt(roleCode, harnessConfig);
    const outputMode = roleCode === 'tracker' ? 'json' : (harnessConfig.outputMode ?? 'text');
    const jsonSchema = harnessConfig.jsonSchema;

    fetcher.on('frame', async (buf) => {
      const capture = {
        id: randomUUID(), ts: Date.now(), prompt, frame: buf, outputMode, jsonSchema,
        result: null, error: null,
      };
      try {
        const result = await adapter.analyse([buf], prompt, { outputMode, jsonSchema });
        session.lastUpdateAt = Date.now();
        session.lastError = null;
        capture.result = { text: result.text ?? null, json: result.json ?? null };

        if (roleCode === 'tracker') {
          const objects = Array.isArray(result.json?.objects) ? result.json.objects.map((o) => ({
            id: o.id ?? randomUUID(),
            label: o.label ?? 'unknown',
            confidence: typeof o.confidence === 'number' ? o.confidence : 0,
            bbox: o.bbox ?? { x: 0, y: 0, w: 0, h: 0 },
          })) : [];
          this._rolesBus.emit(apiKey, 'tracker', 'tracker_update', { apiKey, ts: session.lastUpdateAt, objects });
        } else {
          this._rolesBus.emit(apiKey, 'describer', 'describer_update', {
            apiKey, ts: session.lastUpdateAt, text: result.text, json: result.json,
          });
        }
      } catch (err) {
        session.lastError = err.message;
        capture.error = err.message;
        logger.warn(`[agent] ${roleCode} vision analysis failed for ${apiKey}: ${err.message}`);
      } finally {
        this._recordCapture(apiKey, roleCode, capture);
      }
    });

    fetcher.on('error', (err) => {
      session.lastError = err.message;
      logger.warn(`[agent] ${roleCode} frame fetch failed for ${apiKey}: ${err.message}`);
    });

    fetcher.start();
    return { ok: true };
  }

  /**
   * @param {string} apiKey
   * @param {string} roleCode
   * @returns {boolean} — false if no session was running
   */
  stop(apiKey, roleCode) {
    const key = this._key(apiKey, roleCode);
    const session = this._sessions.get(key);
    if (!session) return false;
    session.fetcher.stop();
    session.fetcher.removeAllListeners();
    this._sessions.delete(key);
    return true;
  }

  /**
   * Stop any running session and drop all captures for a project — for use
   * when the *project itself* is deleted, a different lifecycle event from
   * stop() (captures deliberately survive an ordinary stop()/start(), see
   * `_captures`' own doc comment above; without this, a deleted project's
   * capture buffers — real JPEG frame Buffers, not just metadata — would
   * stay resident in memory for the lifetime of the process, unbounded
   * across however many projects are ever created and deleted — code-review
   * fix). Callers: `deleteKey()`'s call sites (`routes/keys.js`,
   * `routes/admin.js`).
   * @param {string} apiKey
   */
  clearProject(apiKey) {
    const prefix = `${apiKey}:`;
    for (const key of Array.from(this._sessions.keys())) {
      if (!key.startsWith(prefix)) continue;
      const session = this._sessions.get(key);
      session.fetcher.stop();
      session.fetcher.removeAllListeners();
      this._sessions.delete(key);
    }
    for (const key of Array.from(this._captures.keys())) {
      if (key.startsWith(prefix)) this._captures.delete(key);
    }
  }

  /**
   * @param {string} apiKey
   * @param {string} roleCode
   * @returns {{ running: boolean, lastUpdateAt: number|null, lastError: string|null }}
   */
  status(apiKey, roleCode) {
    const session = this._sessions.get(this._key(apiKey, roleCode));
    if (!session) return { running: false, lastUpdateAt: null, lastError: null };
    return { running: session.fetcher.running, lastUpdateAt: session.lastUpdateAt, lastError: session.lastError };
  }
}
