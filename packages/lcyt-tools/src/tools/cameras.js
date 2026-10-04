/**
 * camera.* tools — Setup Hub's Cameras card (Setup Assistant) and
 * Production Assistant's device-control tool (camera.preset).
 *
 * Cameras/mixers are project-wide (not per-apiKey) in this codebase today —
 * these tools operate on the same global `prod_cameras`/`prod_mixers` tables
 * every project's Setup Hub already reads. apiKey is accepted in the call
 * context for parity with every other tool but isn't used to scope rows.
 */

/**
 * @param {{ db, registry, commands, listCameras, getCameraById, createCamera, updateCamera, deleteCamera }} deps
 *   db + registry from 'lcyt-production'
 * @returns {Array<{ name, description, inputSchema, annotations, handler }>}
 */
export function createCameraTools(deps) {
  const { db, commands, listCameras, getCameraById, createCamera, updateCamera, deleteCamera } = deps;

  return [
    {
      name: 'camera.list',
      description: 'List configured cameras (PTZ control type, presets, mixer input assignment).',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      handler: () => ({ ok: true, cameras: listCameras(db) }),
    },
    {
      name: 'camera.create',
      description: 'Create a camera. controlType is one of none, amx, visca-ip, webcam, mobile, rtmp.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          mixerInput: { type: 'number' },
          controlType: { type: 'string', enum: ['none', 'amx', 'visca-ip', 'webcam', 'mobile', 'rtmp'] },
          controlConfig: { type: 'object' },
          bridgeInstanceId: { type: 'string' },
        },
        required: ['name'],
      },
      annotations: {},
      handler: (args) => createCamera(db, registry, args),
    },
    {
      name: 'camera.update',
      description: 'Update a camera\'s configuration.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          mixerInput: { type: 'number' },
          controlType: { type: 'string', enum: ['none', 'amx', 'visca-ip', 'webcam', 'mobile', 'rtmp'] },
          controlConfig: { type: 'object' },
          bridgeInstanceId: { type: 'string' },
        },
        required: ['id'],
      },
      annotations: {},
      handler: ({ id, ...patch }) => updateCamera(db, registry, id, patch),
    },
    {
      name: 'camera.delete',
      description: 'Delete a camera.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      annotations: { destructiveHint: true },
      handler: ({ id }) => deleteCamera(db, registry, id),
    },
    {
      name: 'camera.preset',
      description: 'Trigger a PTZ preset on a camera by id.',
      inputSchema: {
        type: 'object',
        properties: { cameraId: { type: 'string' }, presetId: { type: 'string' } },
        required: ['cameraId', 'presetId'],
      },
      annotations: { destructiveHint: true },
      handler: async ({ cameraId, presetId }, ctx) => {
        // Same path as the HTTP route: ownership check, bridge-vs-direct
        // routing and the production-follow (vertical crop) notification.
        const r = await commands.callCameraPreset(ctx?.apiKey ?? null, cameraId, presetId, { source: 'tool' });
        return r.ok ? { ok: true, cameraId, presetId } : { ok: false, error: r.error };
      },
    },
  ];
}
