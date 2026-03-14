/**
 * Device registry.
 * Loads cameras and mixers from the database, manages live adapter connections,
 * and provides adapter resolution by device type.
 */

import * as amxAdapter from './adapters/camera/amx.js';
import * as noneAdapter from './adapters/camera/none.js';

// ---------------------------------------------------------------------------
// Adapter maps
// ---------------------------------------------------------------------------

const CAMERA_ADAPTERS = {
  amx:  amxAdapter,
  none: noneAdapter,
};

const MIXER_ADAPTERS = {
  // Phase 2+: roland, atem, obs
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
    /** @type {Map<string, object>} cameraId → connection handle */
    this._cameraConnections = new Map();
    /** @type {Map<string, object>} mixerId → connection handle */
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
      try { await adapter.disconnect(handle); } catch (e) { /* ignore */ }
      this._cameraConnections.delete(id);
    });
    const mixerDisconnects = [...this._mixerConnections.entries()].map(async ([id, { adapter, handle }]) => {
      try { await adapter.disconnect(handle); } catch (e) { /* ignore */ }
      this._mixerConnections.delete(id);
    });
    await Promise.all([...cameraDisconnects, ...mixerDisconnects]);
  }

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
      try { await existing.adapter.disconnect(existing.handle); } catch (e) { /* ignore */ }
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
      try { await existing.adapter.disconnect(existing.handle); } catch (e) { /* ignore */ }
      this._cameraConnections.delete(cameraId);
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
}

// ---------------------------------------------------------------------------
// Row parsers — SQLite stores JSON as TEXT; parse on read
// ---------------------------------------------------------------------------

export function parseCamera(row) {
  return {
    ...row,
    mixerInput: row.mixer_input,
    controlType: row.control_type,
    controlConfig: JSON.parse(row.control_config || '{}'),
    bridgeInstanceId: row.bridge_instance_id,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

export function parseMixer(row) {
  return {
    ...row,
    connectionConfig: JSON.parse(row.connection_config || '{}'),
    bridgeInstanceId: row.bridge_instance_id,
    createdAt: row.created_at,
  };
}
