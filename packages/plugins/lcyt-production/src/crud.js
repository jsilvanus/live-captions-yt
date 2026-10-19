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
import { withCameraFeedKeys, unlinkCameraFeeds } from './camera-feeds.js';
import { getSwitchCommand as rolandGetSwitchCommand } from './adapters/mixer/roland.js';
import { getSwitchCommand as amxGetSwitchCommand } from './adapters/mixer/amx.js';
import { getSwitchCommand as atemGetSwitchCommand } from './adapters/mixer/atem.js';
import { getSwitchCommand as monarchHdxGetSwitchCommand } from './adapters/mixer/monarch_hdx.js';
import { getSwitchCommand as obsGetSwitchCommand } from './adapters/mixer/obs.js';

// Kept in sync with routes/cameras.js's own copy of this list. The 'rtmp' type is gone (feeds-and-devices PR 7):
// a pushed feed is a prod_feeds row linked to a camera of type 'none'.
const CAMERA_CONTROL_TYPES = ['none', 'amx', 'visca-ip', 'webcam', 'mobile'];
const MIXER_TYPES = ['roland', 'amx', 'atem', 'monarch_hdx', 'lcyt'];
// A camera's stream key is a feed key now: create a feed (Feeds card, POST /feeds) and link it to the camera.
const CAMERA_KEY_REMOVED = 'cameraKey is no longer stored on cameras: create a feed (POST /feeds) and link it to the camera';

// ---------------------------------------------------------------------------
// Cameras
// ---------------------------------------------------------------------------

export async function listCameras(db) {
  const rows = await db.prod_cameras.findMany({ orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }] });
  return withCameraFeedKeys(db, rows.map(parseCamera));
}

export async function getCameraById(db, id) {
  const row = await db.prod_cameras.findUnique({ where: { id } });
  if (!row) return null;
  const [camera] = await withCameraFeedKeys(db, [parseCamera(row)]);
  return camera;
}

export async function createCamera(db, registry, fields = {}) {
  const {
    name, mixerInput = null, controlType = 'none', controlConfig = {},
    sortOrder = 0, bridgeInstanceId = null, connectionSource = 'backend', cameraKey,
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
  if (cameraKey != null) return { ok: false, error: CAMERA_KEY_REMOVED };
  const id = randomUUID();
  await db.prod_cameras.create({
    data: {
      id, name, mixer_input: mixerInput, control_type: controlType, control_config: JSON.stringify(controlConfig),
      bridge_instance_id: bridgeInstanceId, sort_order: sortOrder, connection_source: connectionSource,
      owner_api_key: ownerApiKey, label, zone,
      overlap_links: JSON.stringify(overlapLinks), mixer_id: mixerId,
    },
  });
  registry.reloadCamera(id).catch((err) => console.warn(`[production-control] reloadCamera after create: ${err.message}`));
  return { ok: true, camera: await getCameraById(db, id) };
}

export async function updateCamera(db, registry, id, patch = {}) {
  const existing = await db.prod_cameras.findUnique({ where: { id } });
  if (!existing) return { ok: false, error: 'Camera not found', status: 404 };

  const name = patch.name ?? existing.name;
  const mixerInput = patch.mixerInput !== undefined ? patch.mixerInput : existing.mixer_input;
  const controlType = patch.controlType ?? existing.control_type;
  const controlConfig = patch.controlConfig ?? JSON.parse(existing.control_config);
  const sortOrder = patch.sortOrder ?? existing.sort_order;
  const bridgeInstanceId = patch.bridgeInstanceId !== undefined ? patch.bridgeInstanceId : existing.bridge_instance_id;
  const connectionSource = patch.connectionSource ?? existing.connection_source ?? 'backend';
  const label = patch.label !== undefined ? patch.label : existing.label;
  const zone = patch.zone !== undefined ? patch.zone : existing.zone;
  const overlapLinks = patch.overlapLinks !== undefined ? patch.overlapLinks : JSON.parse(existing.overlap_links || '[]');
  const mixerId = patch.mixerId !== undefined ? patch.mixerId : existing.mixer_id;

  if (controlType && !CAMERA_CONTROL_TYPES.includes(controlType)) {
    return { ok: false, error: `controlType must be one of: ${CAMERA_CONTROL_TYPES.join(', ')}` };
  }
  if (patch.cameraKey != null) return { ok: false, error: CAMERA_KEY_REMOVED };

  await db.prod_cameras.updateMany({
    where: { id },
    data: {
      name, mixer_input: mixerInput, control_type: controlType, control_config: JSON.stringify(controlConfig),
      bridge_instance_id: bridgeInstanceId, sort_order: sortOrder, connection_source: connectionSource,
      label, zone, overlap_links: JSON.stringify(overlapLinks), mixer_id: mixerId,
    },
  });

  registry.reloadCamera(id).catch((err) => console.warn(`[production-control] reloadCamera after update: ${err.message}`));
  return { ok: true, camera: await getCameraById(db, id) };
}

export async function deleteCamera(db, registry, id) {
  const existing = await db.prod_cameras.findUnique({ where: { id } });
  if (!existing) return { ok: false, error: 'Camera not found', status: 404 };
  await db.prod_cameras.deleteMany({ where: { id } });
  await unlinkCameraFeeds(db, id);
  registry.removeCamera(id).catch(() => {});
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Mixers
// ---------------------------------------------------------------------------

export async function listMixers(db, registry) {
  return (await db.prod_mixers.findMany({ orderBy: { created_at: 'asc' } })).map((row) => {
    const mixer = parseMixer(row);
    return { ...mixer, connected: registry.isMixerConnected(mixer.id), activeSource: registry.getActiveSource(mixer.id) };
  });
}

export async function getMixerById(db, registry, id) {
  const row = await db.prod_mixers.findUnique({ where: { id } });
  if (!row) return null;
  const mixer = parseMixer(row);
  return { ...mixer, connected: registry.isMixerConnected(mixer.id), activeSource: registry.getActiveSource(mixer.id) };
}

export async function createMixer(db, registry, fields = {}) {
  const {
    name, type, connectionConfig = {}, bridgeInstanceId = null, connectionSource = 'backend', outputKey = null,
    // Optional (mirrors createCamera()'s ownerApiKey — plan_ingest_feeds.md's
    // cross-tenant review finding, applied to prod_mixers). Not set by
    // packages/lcyt-tools' mixer.create handler today for the same reason
    // createCamera()'s comment gives — that tool group treats mixers as a
    // shared, project-wide pool. Available here for any in-process caller
    // that does have real project context to pass along.
    ownerApiKey = null,
  } = fields;
  if (!name || typeof name !== 'string') return { ok: false, error: 'name is required' };
  if (!type || !MIXER_TYPES.includes(type)) return { ok: false, error: `type must be one of: ${MIXER_TYPES.join(', ')}` };
  const id = randomUUID();
  await db.prod_mixers.create({
    data: {
      id, name, type, connection_config: JSON.stringify(connectionConfig), bridge_instance_id: bridgeInstanceId,
      connection_source: connectionSource, output_key: outputKey, owner_api_key: ownerApiKey,
    },
  });
  registry.reloadMixer(id).catch((err) => console.warn(`[production-control] reloadMixer after create: ${err.message}`));
  return { ok: true, mixer: await getMixerById(db, registry, id) };
}

export async function updateMixer(db, registry, id, patch = {}) {
  const existing = await db.prod_mixers.findUnique({ where: { id } });
  if (!existing) return { ok: false, error: 'Mixer not found', status: 404 };

  const name = patch.name ?? existing.name;
  const type = patch.type ?? existing.type;
  const connectionConfig = patch.connectionConfig ?? JSON.parse(existing.connection_config);
  const bridgeInstanceId = patch.bridgeInstanceId !== undefined ? patch.bridgeInstanceId : existing.bridge_instance_id;
  const connectionSource = patch.connectionSource ?? existing.connection_source ?? 'backend';
  const outputKey = patch.outputKey !== undefined ? patch.outputKey : existing.output_key;

  if (type && !MIXER_TYPES.includes(type)) return { ok: false, error: `type must be one of: ${MIXER_TYPES.join(', ')}` };

  await db.prod_mixers.updateMany({
    where: { id },
    data: {
      name, type, connection_config: JSON.stringify(connectionConfig), bridge_instance_id: bridgeInstanceId,
      connection_source: connectionSource, output_key: outputKey,
    },
  });

  registry.reloadMixer(id).catch((err) => console.warn(`[production-control] reloadMixer after update: ${err.message}`));
  return { ok: true, mixer: await getMixerById(db, registry, id) };
}

export async function deleteMixer(db, registry, id) {
  const existing = await db.prod_mixers.findUnique({ where: { id } });
  if (!existing) return { ok: false, error: 'Mixer not found', status: 404 };
  await db.prod_mixers.deleteMany({ where: { id } });
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
