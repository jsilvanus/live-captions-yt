/**
 * Device registry.
 * Loads cameras and mixers from the database, manages live adapter connections,
 * and provides adapter resolution by device type.
 */

import * as amxAdapter from './adapters/camera/amx.js';
import * as noneAdapter from './adapters/camera/none.js';
import * as viscaIpAdapter from './adapters/camera/visca-ip.js';
import * as browserAdapter from './adapters/camera/browser.js';
import * as rolandAdapter from './adapters/mixer/roland.js';
import * as amxMixerAdapter from './adapters/mixer/amx.js';
import * as atemAdapter from './adapters/mixer/atem.js';
import * as obsAdapter from './adapters/mixer/obs.js';
import * as monarchHdxAdapter from './adapters/mixer/monarch_hdx.js';
import * as lcytMixerAdapter from './adapters/mixer/lcyt.js';

// ---------------------------------------------------------------------------
// Adapter maps
// ---------------------------------------------------------------------------

const CAMERA_ADAPTERS = {
  amx:        amxAdapter,
  none:       noneAdapter,
  'visca-ip': viscaIpAdapter,
  webcam:     browserAdapter,
  mobile:     browserAdapter,
};

const MIXER_ADAPTERS = {
  roland:       rolandAdapter,
  amx:          amxMixerAdapter,
  atem:         atemAdapter,
  obs:          obsAdapter,
  monarch_hdx:  monarchHdxAdapter,
  lcyt:         lcytMixerAdapter,
};

/**
 * Get the camera adapter module for a given camera row.
 * @param {{ controlType: string }} camera
 * @returns {object} adapter with connect/disconnect/callPreset
 */
export function getCameraAdapter(camera) {
  const adapter = CAMERA_ADAPTERS[camera.controlType];
  if (!adapter) throw new Error(`unknown camera controlType: '${camera.controlType}'`);
  return adapter;
}

/**
 * Get the mixer adapter module for a given mixer row.
 * @param {{ type: string }} mixer
 * @returns {object} adapter with connect/disconnect/switchSource/getActiveSource
 */
export function getMixerAdapter(mixer) {
  const adapter = MIXER_ADAPTERS[mixer.type];
  if (!adapter) throw new Error(`unknown mixer type: '${mixer.type}'`);
  return adapter;
}

// ---------------------------------------------------------------------------
// Registry class
// ---------------------------------------------------------------------------

export class DeviceRegistry {
  /**
   * @param {import('better-sqlite3').Database} db
   */
  constructor(db) {
    this._db = db;
    /** @type {Map<string, { adapter: object, handle: object }>} cameraId → entry */
    this._cameraConnections = new Map();
    /** @type {Map<string, { adapter: object, handle: object }>} mixerId → entry */
    this._mixerConnections = new Map();
    /**
     * Production-follow subscribers (plan_vertical_crop.md §4). Kept as
     * plain listener arrays rather than a generic EventEmitter — the plan's
     * own §4 note flags promoting these to real EventBus events once a
     * second consumer needs the same signal (plan_video_perception.md);
     * v1 has exactly one consumer (lcyt-backend wiring CropManager).
     * @type {Array<(data: { apiKey: string|null, mixerId: string, inputNumber: number }) => void>}
     */
    this._programChangedListeners = [];
    /** @type {Array<(data: { apiKey: string|null, cameraId: string, preset: string }) => void>} */
    this._cameraPresetRecalledListeners = [];
  }

  // ---------------------------------------------------------------------------
  // Production-follow subscription (plan_vertical_crop.md §4)
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to mixer program-source switches. Fired by routes/mixers.js
   * after a switch actually took effect, whether dispatched directly via
   * this registry or relayed through a bridge agent (bridge-routed switches
   * never call switchSource() below, so the route — not switchSource() — is
   * the one true firing point for both transports).
   *
   * @param {(data: { apiKey: string|null, mixerId: string, inputNumber: number }) => void} cb
   * @returns {() => void} unsubscribe
   */
  onProgramChanged(cb) {
    this._programChangedListeners.push(cb);
    return () => {
      this._programChangedListeners = this._programChangedListeners.filter(f => f !== cb);
    };
  }

  /**
   * Notify onProgramChanged subscribers. A listener error is caught and
   * logged per-listener so one bad subscriber can't fail the HTTP response
   * for an otherwise-successful mixer switch.
   */
  notifyProgramChanged(data) {
    for (const cb of this._programChangedListeners) {
      try { cb(data); } catch (err) {
        console.warn(`[production-control] onProgramChanged listener error: ${err.message}`);
      }
    }
  }

  /**
   * Subscribe to camera PTZ-preset recalls. Fired by routes/cameras.js
   * after a preset recall actually took effect (direct or bridge-relayed),
   * for the same reason onProgramChanged is fired from the route rather than
   * from callPreset() below.
   *
   * @param {(data: { apiKey: string|null, cameraId: string, preset: string }) => void} cb
   * @returns {() => void} unsubscribe
   */
  onCameraPresetRecalled(cb) {
    this._cameraPresetRecalledListeners.push(cb);
    return () => {
      this._cameraPresetRecalledListeners = this._cameraPresetRecalledListeners.filter(f => f !== cb);
    };
  }

  /** Notify onCameraPresetRecalled subscribers (see notifyProgramChanged). */
  notifyCameraPresetRecalled(data) {
    for (const cb of this._cameraPresetRecalledListeners) {
      try { cb(data); } catch (err) {
        console.warn(`[production-control] onCameraPresetRecalled listener error: ${err.message}`);
      }
    }
  }

  /**
   * Load all cameras and mixers from DB and open adapter connections.
   * Logs warnings for unreachable devices but does not throw.
   */
  async start() {
    const cameras = this._db
      .prepare('SELECT * FROM prod_cameras ORDER BY sort_order, created_at')
      .all()
      .map(parseCamera);

    const mixers = this._db
      .prepare('SELECT * FROM prod_mixers ORDER BY created_at')
      .all()
      .map(parseMixer);

    await Promise.all([
      ...cameras.map(cam => this._connectCamera(cam)),
      ...mixers.map(mix => this._connectMixer(mix)),
    ]);

    console.info(`[production-control] Registry started — ${cameras.length} camera(s), ${mixers.length} mixer(s)`);
  }

  /** Gracefully disconnect all devices. */
  async stop() {
    const cameraDisconnects = [...this._cameraConnections.entries()].map(async ([id, { adapter, handle }]) => {
      try { await adapter.disconnect(handle); } catch { /* ignore */ }
      this._cameraConnections.delete(id);
    });
    const mixerDisconnects = [...this._mixerConnections.entries()].map(async ([id, { adapter, handle }]) => {
      try { await adapter.disconnect(handle); } catch { /* ignore */ }
      this._mixerConnections.delete(id);
    });
    await Promise.all([...cameraDisconnects, ...mixerDisconnects]);
  }

  // ---------------------------------------------------------------------------
  // Camera operations
  // ---------------------------------------------------------------------------

  /**
   * Trigger a preset for a camera by id.
   * @param {string} cameraId
   * @param {string} presetId
   */
  async callPreset(cameraId, presetId) {
    const camera = this._loadCamera(cameraId);
    const entry = this._cameraConnections.get(cameraId);
    if (!entry) throw new Error(`No connection for camera '${camera.name}'`);
    await entry.adapter.callPreset(entry.handle, camera, presetId);
  }

  /**
   * Reload a single camera's connection (e.g. after config update).
   * @param {string} cameraId
   */
  async reloadCamera(cameraId) {
    const existing = this._cameraConnections.get(cameraId);
    if (existing) {
      try { await existing.adapter.disconnect(existing.handle); } catch { /* ignore */ }
      this._cameraConnections.delete(cameraId);
    }
    const camera = this._loadCamera(cameraId);
    await this._connectCamera(camera);
  }

  /**
   * Remove a camera connection (e.g. after deletion).
   * @param {string} cameraId
   */
  async removeCamera(cameraId) {
    const existing = this._cameraConnections.get(cameraId);
    if (existing) {
      try { await existing.adapter.disconnect(existing.handle); } catch { /* ignore */ }
      this._cameraConnections.delete(cameraId);
    }
  }

  // ---------------------------------------------------------------------------
  // Mixer operations
  // ---------------------------------------------------------------------------

  /**
   * Switch the program source on a mixer.
   * @param {string} mixerId
   * @param {number} inputNumber  1-based input number
   */
  async switchSource(mixerId, inputNumber) {
    const mixer = this._loadMixer(mixerId);
    const entry = this._mixerConnections.get(mixerId);
    if (!entry) throw new Error(`No connection for mixer '${mixer.name}'`);
    // Pass mixer so adapters that need connectionConfig (e.g. AMX) can look up commands
    await entry.adapter.switchSource(entry.handle, inputNumber, mixer);
  }

  /**
   * Return the active program source for a mixer, or null if unknown.
   * @param {string} mixerId
   * @returns {number|null}
   */
  getActiveSource(mixerId) {
    const entry = this._mixerConnections.get(mixerId);
    if (!entry) return null;
    return entry.adapter.getActiveSource(entry.handle);
  }

  /**
   * Return whether a mixer TCP connection is currently established.
   * @param {string} mixerId
   * @returns {boolean}
   */
  isMixerConnected(mixerId) {
    const entry = this._mixerConnections.get(mixerId);
    return entry?.handle?.connected === true;
  }

  /**
   * Reload a single mixer's connection (e.g. after config update).
   * @param {string} mixerId
   */
  async reloadMixer(mixerId) {
    const existing = this._mixerConnections.get(mixerId);
    if (existing) {
      try { await existing.adapter.disconnect(existing.handle); } catch { /* ignore */ }
      this._mixerConnections.delete(mixerId);
    }
    const mixer = this._loadMixer(mixerId);
    await this._connectMixer(mixer);
  }

  /**
   * Remove a mixer connection (e.g. after deletion).
   * @param {string} mixerId
   */
  async removeMixer(mixerId) {
    const existing = this._mixerConnections.get(mixerId);
    if (existing) {
      try { await existing.adapter.disconnect(existing.handle); } catch { /* ignore */ }
      this._mixerConnections.delete(mixerId);
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  async _connectCamera(camera) {
    const adapter = getCameraAdapter(camera);
    try {
      const handle = await adapter.connect(camera.controlConfig);
      this._cameraConnections.set(camera.id, { adapter, handle });
    } catch (err) {
      console.warn(`[production-control] Could not connect camera '${camera.name}': ${err.message}`);
    }
  }

  async _connectMixer(mixer) {
    try {
      const adapter = getMixerAdapter(mixer);
      const handle = await adapter.connect(mixer.connectionConfig);
      this._mixerConnections.set(mixer.id, { adapter, handle });
    } catch (err) {
      console.warn(`[production-control] Could not connect mixer '${mixer.name}': ${err.message}`);
    }
  }

  _loadCamera(cameraId) {
    const row = this._db.prepare('SELECT * FROM prod_cameras WHERE id = ?').get(cameraId);
    if (!row) throw new Error(`Camera not found: ${cameraId}`);
    return parseCamera(row);
  }

  _loadMixer(mixerId) {
    const row = this._db.prepare('SELECT * FROM prod_mixers WHERE id = ?').get(mixerId);
    if (!row) throw new Error(`Mixer not found: ${mixerId}`);
    return parseMixer(row);
  }
}

// ---------------------------------------------------------------------------
// Row parsers — SQLite stores JSON as TEXT; parse on read
// ---------------------------------------------------------------------------

export function parseCamera(row) {
  // owner_api_key is a real api_keys.key value (itself a bearer-like
  // credential elsewhere in this system, e.g. the legacy RTMP stream key —
  // plan_selfservice_config_backend.md) — never spread it into the response;
  // callers that need it for an ownership check read row.owner_api_key
  // directly before calling parseCamera().
  const { owner_api_key, ...rest } = row;
  return {
    ...rest,
    mixerInput:       row.mixer_input,
    mixerId:          row.mixer_id ?? null,
    controlType:      row.control_type,
    controlConfig:    JSON.parse(row.control_config || '{}'),
    connectionSource: row.connection_source ?? 'backend',
    bridgeInstanceId: row.bridge_instance_id,
    sortOrder:        row.sort_order,
    cameraKey:        row.camera_key ?? null,
    thumbnailCapturedAt: row.thumbnail_captured_at ?? null,
    label:            row.label ?? null,
    zone:             row.zone ?? null,
    overlapLinks:     JSON.parse(row.overlap_links || '[]'),
    createdAt:        row.created_at,
    isOwned:          owner_api_key != null,
  };
}

export function parseMixer(row) {
  return {
    ...row,
    connectionConfig: JSON.parse(row.connection_config || '{}'),
    connectionSource: row.connection_source ?? 'backend',
    bridgeInstanceId: row.bridge_instance_id,
    outputKey:        row.output_key ?? null,
    createdAt:        row.created_at,
  };
}

export function parseEncoder(row) {
  return {
    ...row,
    connectionConfig: JSON.parse(row.connection_config || '{}'),
    connectionSource: row.connection_source ?? 'backend',
    bridgeInstanceId: row.bridge_instance_id,
    createdAt:        row.created_at,
  };
}
