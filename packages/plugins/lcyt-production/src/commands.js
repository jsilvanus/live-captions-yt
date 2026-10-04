/**
 * ProductionCommands — the one in-process path for device side effects
 * (camera preset recall, mixer source switch). See
 * docs/plans/plan_backend_actions.md.
 *
 * Before this module the same logic (ownership check, bridge-vs-direct
 * routing, preset lookup, production-follow notification) lived twice: in
 * routes/cameras.js + routes/mixers.js (HTTP) and in lcyt-tools'
 * camera.preset / mixer.switch handlers. The tool copy skipped the ownership
 * check and the production-follow notification, so an AI- or MCP-driven
 * switch never made the vertical crop follow. Every caller (HTTP routes, AI
 * tools, and later the server-side action runner) now goes through here.
 *
 * Callers pass the acting project's `apiKey` (or null for an unauthenticated
 * kiosk request — same fail-open convention as the routes' canAccessCamera()
 * / canAccessMixer(), which this reproduces exactly).
 *
 * Results are plain objects, never throws for expected failures:
 *   { ok: true, ...details, transport: 'direct' | 'bridge' }
 *   { ok: false, code: 'not_found' | 'bad_request' | 'unavailable' | 'forbidden', error }
 * `commandStatus(result)` maps `code` to the HTTP status the routes used.
 *
 * When an EventBus is supplied and an apiKey is known, each command
 * publishes `production.command_result` on that project's bus.
 */

import { parseCamera, parseMixer } from './registry.js';
import { buildSwitchCommand } from './crud.js';
import { isSecurityBlockError } from './bridge-security.js';

const HTTP_STATUS = { not_found: 404, bad_request: 400, unavailable: 503, forbidden: 403 };

/**
 * HTTP status for a failed command result.
 * @param {{ ok: boolean, code?: string }} result
 * @returns {number}
 */
export function commandStatus(result) {
  return HTTP_STATUS[result?.code] ?? 400;
}

function classifyError(err) {
  if (isSecurityBlockError(err)) return 'forbidden';
  const msg = String(err?.message ?? '');
  if (msg.includes('not connected') || msg.includes('timed out')) return 'unavailable';
  return 'bad_request';
}

/**
 * @param {object} deps
 * @param {import('better-sqlite3').Database} deps.db
 * @param {import('./registry.js').DeviceRegistry} deps.registry
 * @param {import('./bridge-manager.js').BridgeManager|null} [deps.bridgeManager]
 * @param {import('lcyt/event-bus').EventBus|null} [deps.eventBus]
 */
export function createProductionCommands({ db, registry, bridgeManager = null, eventBus = null }) {
  function publish(apiKey, data) {
    if (!eventBus || !apiKey) return;
    try { eventBus.publish(apiKey, 'production.command_result', data); } catch { /* never fail a command on telemetry */ }
  }

  function finish(apiKey, base, started, result) {
    publish(apiKey, {
      ...base,
      ok: result.ok,
      ...(result.transport && { transport: result.transport }),
      ...(result.ok ? {} : { error: result.error, code: result.code }),
      durationMs: Date.now() - started,
    });
    return result;
  }

  /**
   * Recall a camera PTZ preset.
   * @param {string|null} apiKey  acting project's key (null = unauthenticated, fail open)
   * @param {string} cameraId
   * @param {string} presetId
   * @param {{ source?: string }} [meta]
   */
  async function callCameraPreset(apiKey, cameraId, presetId, meta = {}) {
    const started = Date.now();
    const base = { kind: 'camera.preset', cameraId, presetId, source: meta.source ?? 'unknown' };
    const row = db.prepare('SELECT * FROM prod_cameras WHERE id = ?').get(cameraId);
    if (!row || (apiKey && row.owner_api_key != null && row.owner_api_key !== apiKey)) {
      return finish(apiKey, base, started, { ok: false, code: 'not_found', error: 'Camera not found' });
    }

    try {
      const camera = parseCamera(row);
      // The crop editor binds crop_source_map.camera_preset to a preset's
      // presetNumber (VISCA) or array index (AMX, no numeric id) — never to
      // `.id`. Recompute that key so production-follow can match a row.
      const allPresets = camera.controlConfig?.presets ?? [];
      const presetIndex = allPresets.findIndex((p) => p.id === presetId);
      const preset = presetIndex === -1 ? null : allPresets[presetIndex];
      const presetKey = preset
        ? (Number.isInteger(preset.presetNumber) ? preset.presetNumber : presetIndex)
        : presetId;

      let transport = 'direct';
      if (camera.bridgeInstanceId && bridgeManager) {
        if (!bridgeManager.isConnected(camera.bridgeInstanceId)) {
          return finish(apiKey, base, started, { ok: false, code: 'unavailable', error: 'Bridge is not connected' });
        }
        if (!preset) {
          return finish(apiKey, base, started, { ok: false, code: 'bad_request', error: `Unknown preset '${presetId}'` });
        }
        await bridgeManager.sendCommand(camera.bridgeInstanceId, {
          host: camera.controlConfig.host,
          port: camera.controlConfig.port,
          payload: preset.command + '\r\n',
        });
        transport = 'bridge';
      } else {
        await registry.callPreset(cameraId, presetId);
      }

      registry.notifyCameraPresetRecalled({ apiKey, cameraId, preset: presetKey });
      return finish(apiKey, base, started, { ok: true, cameraId, presetId, transport });
    } catch (err) {
      return finish(apiKey, base, started, { ok: false, code: classifyError(err), error: err.message });
    }
  }

  /**
   * Switch a mixer's program source.
   * @param {string|null} apiKey
   * @param {string} mixerId
   * @param {number} inputNumber  non-negative integer
   * @param {{ source?: string }} [meta]
   */
  async function switchMixer(apiKey, mixerId, inputNumber, meta = {}) {
    const started = Date.now();
    const base = { kind: 'mixer.switch', mixerId, inputNumber, source: meta.source ?? 'unknown' };
    if (!Number.isInteger(inputNumber) || inputNumber < 0) {
      return finish(apiKey, base, started, { ok: false, code: 'bad_request', error: 'inputNumber must be a non-negative integer' });
    }
    const row = db.prepare('SELECT * FROM prod_mixers WHERE id = ?').get(mixerId);
    if (!row || (apiKey && row.owner_api_key != null && row.owner_api_key !== apiKey)) {
      return finish(apiKey, base, started, { ok: false, code: 'not_found', error: 'Mixer not found' });
    }

    try {
      const mixer = parseMixer(row);
      if (mixer.bridgeInstanceId && bridgeManager) {
        if (!bridgeManager.isConnected(mixer.bridgeInstanceId)) {
          return finish(apiKey, base, started, { ok: false, code: 'unavailable', error: 'Bridge is not connected' });
        }
        const command = buildSwitchCommand(mixer, inputNumber);
        // lcyt mixer returns null — skip bridge dispatch, fall through to registry
        if (command !== null) {
          await bridgeManager.sendCommand(mixer.bridgeInstanceId, command);
          registry.notifyProgramChanged({ apiKey, mixerId, inputNumber });
          return finish(apiKey, base, started, { ok: true, mixerId, activeSource: inputNumber, transport: 'bridge' });
        }
      }

      // Direct via registry (lcyt in-memory tracking and all non-bridge cases)
      await registry.switchSource(mixerId, inputNumber);
      registry.notifyProgramChanged({ apiKey, mixerId, inputNumber });
      return finish(apiKey, base, started, { ok: true, mixerId, activeSource: inputNumber, transport: 'direct' });
    } catch (err) {
      return finish(apiKey, base, started, { ok: false, code: classifyError(err), error: err.message });
    }
  }

  return { callCameraPreset, switchMixer };
}
