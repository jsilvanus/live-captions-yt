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
  }

  _key(apiKey, roleCode) {
    return `${apiKey}:${roleCode}`;
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

    fetcher.on('frame', async (buf) => {
      try {
        const result = await adapter.analyse([buf], prompt, {
          outputMode: roleCode === 'tracker' ? 'json' : (harnessConfig.outputMode ?? 'text'),
          jsonSchema: harnessConfig.jsonSchema,
        });
        session.lastUpdateAt = Date.now();
        session.lastError = null;

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
        logger.warn(`[agent] ${roleCode} vision analysis failed for ${apiKey}: ${err.message}`);
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
