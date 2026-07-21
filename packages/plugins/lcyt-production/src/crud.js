/**
 * Plain, directly-callable camera/mixer CRUD helpers — the in-process
 * counterpart to routes/cameras.js and routes/mixers.js's HTTP handlers.
 *
 * Exported for packages/lcyt-tools (plan/mcp's shared tool-schema module):
 * a tool handler has no Express req/res to work with, so it needs a plain
 * function it can call directly with plain arguments, exactly the same
 * reasoning that already applies to `registry.callPreset()` /
 * `registry.switchSource()` (see plan_ai_roles_framework.md).
 *
 * Mirrors the HTTP routes' validation and registry reload/remove behavior.
 * Kept deliberately separate from the route files rather than refactoring
 * them to call these — see CONSIDER.md for the follow-up to de-duplicate.
 */

import { randomUUID } from 'node:crypto';
import { parseCamera, parseMixer } from './registry.js';
import { getSwitchCommand as rolandGetSwitchCommand } from './adapters/mixer/roland.js';
import { getSwitchCommand as amxGetSwitchCommand } from './adapters/mixer/amx.js';
import { getSwitchCommand as atemGetSwitchCommand } from './adapters/mixer/atem.js';
import { getSwitchCommand as monarchHdxGetSwitchCommand } from './adapters/mixer/monarch_hdx.js';
import { getSwitchCommand as obsGetSwitchCommand } from './adapters/mixer/obs.js';

// 'rtmp' (plan_ingest_feeds.md §1a): a named feed pushed via RTMP rather
// than WHIP — kept in sync with routes/cameras.js's own copy of this list.
const CAMERA_CONTROL_TYPES = ['none', 'amx', 'visca-ip', 'webcam', 'mobile', 'rtmp'];
const MIXER_TYPES = ['roland', 'amx', 'atem', 'monarch_hdx', 'lcyt'];
// Mirrors routes/cameras.js's own copy (and lcyt-rtmp's rtmp-manager.js
// SAFE_NAME_RE) — camera_key becomes a raw MediaMTX path/shell-command
// fragment in that plugin's runOnPublish registration.
const CAMERA_KEY_RE = /^[A-Za-z0-9_-]+$/;

// ---------------------------------------------------------------------------
// Cameras
// ---------------------------------------------------------------------------

export function listCameras(db) {
  return db.prepare('SELECT * FROM prod_cameras ORDER BY sort_order, created_at').all().map(parseCamera);
}

export function getCameraById(db, id) {
  const row = db.prepare('SELECT * FROM prod_cameras WHERE id = ?').get(id);
  return row ? parseCamera(row) : null;
}

export function createCamera(db, registry, fields = {}) {
  const {
    name, mixerInput = null, controlType = 'none', controlConfig = {},
    sortOrder = 0, bridgeInstanceId = null, connectionSource = 'backend', cameraKey = null,
    // Optional (plan_ingest_feeds.md's cross-tenant review finding). Not set
    // by packages/lcyt-tools' camera.create handler today — that tool group
    // deliberately treats cameras as a shared, project-wide pool (see
    // lcyt-tools/CLAUDE.md), so MCP-created cameras stay unowned/legacy on
    // purpose. Available here for any future in-process caller that does
    // have real project context to pass along.
    ownerApiKey = null,
    // Video perception metadata (plan_video_perception.md Phase 1)
    label = null, zone = null, overlapLinks = [],
    // Which prod_mixers row mixerInput refers to (Phase 3 code-review fix —
    // disambiguates cameras across multiple mixers; null = unscoped/legacy).
    mixerId = null,
  } = fields;
  if (!name || typeof name !== 'string') return { ok: false, error: 'name is required' };
  if (!CAMERA_CONTROL_TYPES.includes(controlType)) {
    return { ok: false, error: `controlType must be one of: ${CAMERA_CONTROL_TYPES.join(', ')}` };
  }
  if (cameraKey != null && !CAMERA_KEY_RE.test(cameraKey)) {
    return { ok: false, error: 'cameraKey may only contain letters, digits, underscore, and hyphen' };
  }
  const id = randomUUID();
  db.prepare(`
    INSERT INTO prod_cameras (id, name, mixer_input, control_type, control_config, bridge_instance_id, sort_order, connection_source, camera_key, owner_api_key, label, zone, overlap_links, mixer_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, mixerInput, controlType, JSON.stringify(controlConfig), bridgeInstanceId, sortOrder, connectionSource, cameraKey, ownerApiKey, label, zone, JSON.stringify(overlapLinks), mixerId);
  registry.reloadCamera(id).catch((err) => console.warn(`[production-control] reloadCamera after create: ${err.message}`));
  return { ok: true, camera: getCameraById(db, id) };
}

export function updateCamera(db, registry, id, patch = {}) {
  const existing = db.prepare('SELECT * FROM prod_cameras WHERE id = ?').get(id);
  if (!existing) return { ok: false, error: 'Camera not found', status: 404 };

  const name = patch.name ?? existing.name;
  const mixerInput = patch.mixerInput !== undefined ? patch.mixerInput : existing.mixer_input;
  const controlType = patch.controlType ?? existing.control_type;
  const controlConfig = patch.controlConfig ?? JSON.parse(existing.control_config);
  const sortOrder = patch.sortOrder ?? existing.sort_order;
  const bridgeInstanceId = patch.bridgeInstanceId !== undefined ? patch.bridgeInstanceId : existing.bridge_instance_id;
  const connectionSource = patch.connectionSource ?? existing.connection_source ?? 'backend';
  const cameraKey = patch.cameraKey !== undefined ? patch.cameraKey : existing.camera_key;
  const label = patch.label !== undefined ? patch.label : existing.label;
  const zone = patch.zone !== undefined ? patch.zone : existing.zone;
  const overlapLinks = patch.overlapLinks !== undefined ? patch.overlapLinks : JSON.parse(existing.overlap_links || '[]');
  const mixerId = patch.mixerId !== undefined ? patch.mixerId : existing.mixer_id;

  if (controlType && !CAMERA_CONTROL_TYPES.includes(controlType)) {
    return { ok: false, error: `controlType must be one of: ${CAMERA_CONTROL_TYPES.join(', ')}` };
  }
  if (cameraKey != null && !CAMERA_KEY_RE.test(cameraKey)) {
    return { ok: false, error: 'cameraKey may only contain letters, digits, underscore, and hyphen' };
  }

  db.prepare(`
    UPDATE prod_cameras
    SET name = ?, mixer_input = ?, control_type = ?, control_config = ?,
        bridge_instance_id = ?, sort_order = ?, connection_source = ?, camera_key = ?,
        label = ?, zone = ?, overlap_links = ?, mixer_id = ?
    WHERE id = ?
  `).run(name, mixerInput, controlType, JSON.stringify(controlConfig), bridgeInstanceId, sortOrder, connectionSource, cameraKey, label, zone, JSON.stringify(overlapLinks), mixerId, id);

  registry.reloadCamera(id).catch((err) => console.warn(`[production-control] reloadCamera after update: ${err.message}`));
  return { ok: true, camera: getCameraById(db, id) };
}

export function deleteCamera(db, registry, id) {
  const existing = db.prepare('SELECT * FROM prod_cameras WHERE id = ?').get(id);
  if (!existing) return { ok: false, error: 'Camera not found', status: 404 };
  db.prepare('DELETE FROM prod_cameras WHERE id = ?').run(id);
  registry.removeCamera(id).catch(() => {});
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Mixers
// ---------------------------------------------------------------------------

export function listMixers(db, registry) {
  return db.prepare('SELECT * FROM prod_mixers ORDER BY created_at').all().map((row) => {
    const mixer = parseMixer(row);
    return { ...mixer, connected: registry.isMixerConnected(mixer.id), activeSource: registry.getActiveSource(mixer.id) };
  });
}

export function getMixerById(db, registry, id) {
  const row = db.prepare('SELECT * FROM prod_mixers WHERE id = ?').get(id);
  if (!row) return null;
  const mixer = parseMixer(row);
  return { ...mixer, connected: registry.isMixerConnected(mixer.id), activeSource: registry.getActiveSource(mixer.id) };
}

export function createMixer(db, registry, fields = {}) {
  const { name, type, connectionConfig = {}, bridgeInstanceId = null, connectionSource = 'backend', outputKey = null } = fields;
  if (!name || typeof name !== 'string') return { ok: false, error: 'name is required' };
  if (!type || !MIXER_TYPES.includes(type)) return { ok: false, error: `type must be one of: ${MIXER_TYPES.join(', ')}` };
  const id = randomUUID();
  db.prepare(`
    INSERT INTO prod_mixers (id, name, type, connection_config, bridge_instance_id, connection_source, output_key)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, type, JSON.stringify(connectionConfig), bridgeInstanceId, connectionSource, outputKey);
  registry.reloadMixer(id).catch((err) => console.warn(`[production-control] reloadMixer after create: ${err.message}`));
  return { ok: true, mixer: getMixerById(db, registry, id) };
}

export function updateMixer(db, registry, id, patch = {}) {
  const existing = db.prepare('SELECT * FROM prod_mixers WHERE id = ?').get(id);
  if (!existing) return { ok: false, error: 'Mixer not found', status: 404 };

  const name = patch.name ?? existing.name;
  const type = patch.type ?? existing.type;
  const connectionConfig = patch.connectionConfig ?? JSON.parse(existing.connection_config);
  const bridgeInstanceId = patch.bridgeInstanceId !== undefined ? patch.bridgeInstanceId : existing.bridge_instance_id;
  const connectionSource = patch.connectionSource ?? existing.connection_source ?? 'backend';
  const outputKey = patch.outputKey !== undefined ? patch.outputKey : existing.output_key;

  if (type && !MIXER_TYPES.includes(type)) return { ok: false, error: `type must be one of: ${MIXER_TYPES.join(', ')}` };

  db.prepare(`
    UPDATE prod_mixers SET name = ?, type = ?, connection_config = ?, bridge_instance_id = ?, connection_source = ?, output_key = ?
    WHERE id = ?
  `).run(name, type, JSON.stringify(connectionConfig), bridgeInstanceId, connectionSource, outputKey, id);

  registry.reloadMixer(id).catch((err) => console.warn(`[production-control] reloadMixer after update: ${err.message}`));
  return { ok: true, mixer: getMixerById(db, registry, id) };
}

export function deleteMixer(db, registry, id) {
  const existing = db.prepare('SELECT * FROM prod_mixers WHERE id = ?').get(id);
  if (!existing) return { ok: false, error: 'Mixer not found', status: 404 };
  db.prepare('DELETE FROM prod_mixers WHERE id = ?').run(id);
  registry.removeMixer(id).catch(() => {});
  return { ok: true };
}

/**
 * Build the bridge command object for a mixer source switch.
 * Returns null for mixer types that do not use bridge dispatch (e.g. lcyt).
 * Shared by routes/mixers.js (HTTP) and lcyt-tools' mixer.switch tool.
 */
export function buildSwitchCommand(mixer, inputNumber) {
  if (mixer.type === 'lcyt') return null;
  if (mixer.type === 'roland') {
    return {
      host:    mixer.connectionConfig.host,
      port:    mixer.connectionConfig.port ?? 8023,
      payload: rolandGetSwitchCommand(mixer.connectionConfig, inputNumber),
    };
  }
  if (mixer.type === 'amx') {
    return {
      host:    mixer.connectionConfig.host,
      port:    mixer.connectionConfig.port ?? 1319,
      payload: amxGetSwitchCommand(mixer.connectionConfig, inputNumber),
    };
  }
  if (mixer.type === 'atem') {
    return atemGetSwitchCommand(mixer.connectionConfig, inputNumber);
  }
  if (mixer.type === 'obs') {
    return obsGetSwitchCommand(mixer.connectionConfig, inputNumber);
  }
  if (mixer.type === 'monarch_hdx') {
    return monarchHdxGetSwitchCommand(mixer.connectionConfig, inputNumber);
  }
  throw new Error(`No bridge command builder for mixer type '${mixer.type}'`);
}
