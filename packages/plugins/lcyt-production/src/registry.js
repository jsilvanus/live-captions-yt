/**
 * Device registry.
 * Loads cameras and mixers from the database, manages live adapter connections,
 * and provides adapter resolution by device type.
 */

import * as amxAdapter from './adapters/camera/amx.js';
import * as noneAdapter from './adapters/camera/none.js';
import * as viscaIpAdapter from './adapters/camera/visca-ip.js';
import * as rolandAdapter from './adapters/mixer/roland.js';
import * as amxMixerAdapter from './adapters/mixer/amx.js';
import * as atemAdapter from './adapters/mixer/atem.js';
import * as obsAdapter from './adapters/mixer/obs.js';
import * as monarchHdxAdapter from './adapters/mixer/monarch_hdx.js';

// ---------------------------------------------------------------------------
// Adapter maps
// ---------------------------------------------------------------------------

const CAMERA_ADAPTERS = {
  amx:        amxAdapter,
  none:       noneAdapter,
  'visca-ip': viscaIpAdapter,
};

const MIXER_ADAPTERS = {
  roland:       rolandAdapter,
  amx:          amxMixerAdapter,
  atem:         atemAdapter,
  obs:          obsAdapter,
  monarch_hdx:  monarchHdxAdapter,
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
  return {
    ...row,
    mixerInput:       row.mixer_input,
    controlType:      row.control_type,
    controlConfig:    JSON.parse(row.control_config || '{}'),
    connectionSource: row.connection_source ?? 'backend',
    bridgeInstanceId: row.bridge_instance_id,
    sortOrder:        row.sort_order,
    createdAt:        row.created_at,
  };
}

export function parseMixer(row) {
  return {
    ...row,
    connectionConfig: JSON.parse(row.connection_config || '{}'),
    connectionSource: row.connection_source ?? 'backend',
    bridgeInstanceId: row.bridge_instance_id,
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
