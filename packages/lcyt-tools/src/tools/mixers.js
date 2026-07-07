/**
 * mixer.* tools — Setup Hub's Mixers card (Setup Assistant) and
 * Production Assistant's device-control tool (mixer.switch).
 *
 * Bridge-relayed source switching mirrors routes/mixers.js's dispatch logic
 * (buildSwitchCommand) for every mixer type except 'lcyt', which never uses
 * bridge dispatch and always goes through registry.switchSource().
 */

/**
 * @param {{ db, registry, bridgeManager, listMixers, getMixerById, createMixer, updateMixer, deleteMixer, buildSwitchCommand }} deps
 *   db + registry from 'lcyt-production'; buildSwitchCommand from lcyt-production's mixer route module
 * @returns {Array<{ name, description, inputSchema, annotations, handler }>}
 */
export function createMixerTools(deps) {
  const { db, registry, bridgeManager, listMixers, getMixerById, createMixer, updateMixer, deleteMixer, buildSwitchCommand } = deps;

  return [
    {
      name: 'mixer.list',
      description: 'List configured video mixers, with live connection status and active source.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      handler: () => ({ ok: true, mixers: listMixers(db, registry) }),
    },
    {
      name: 'mixer.create',
      description: 'Create a mixer. type is one of roland, amx, atem, monarch_hdx, lcyt.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          type: { type: 'string', enum: ['roland', 'amx', 'atem', 'monarch_hdx', 'lcyt'] },
          connectionConfig: { type: 'object' },
          bridgeInstanceId: { type: 'string' },
        },
        required: ['name', 'type'],
      },
      annotations: {},
      handler: (args) => createMixer(db, registry, args),
    },
    {
      name: 'mixer.update',
      description: 'Update a mixer\'s configuration.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          type: { type: 'string', enum: ['roland', 'amx', 'atem', 'monarch_hdx', 'lcyt'] },
          connectionConfig: { type: 'object' },
          bridgeInstanceId: { type: 'string' },
        },
        required: ['id'],
      },
      annotations: {},
      handler: ({ id, ...patch }) => updateMixer(db, registry, id, patch),
    },
    {
      name: 'mixer.delete',
      description: 'Delete a mixer.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      annotations: { destructiveHint: true },
      handler: ({ id }) => deleteMixer(db, registry, id),
    },
    {
      name: 'mixer.switch',
      description: 'Switch a mixer\'s program source to the given input number.',
      inputSchema: {
        type: 'object',
        properties: { mixerId: { type: 'string' }, inputNumber: { type: 'number' } },
        required: ['mixerId', 'inputNumber'],
      },
      annotations: { destructiveHint: true },
      handler: async ({ mixerId, inputNumber }) => {
        const mixer = getMixerById(db, registry, mixerId);
        if (!mixer) return { ok: false, error: 'Mixer not found' };
        try {
          if (mixer.bridgeInstanceId && bridgeManager) {
            if (!bridgeManager.isConnected(mixer.bridgeInstanceId)) {
              return { ok: false, error: 'Bridge is not connected' };
            }
            const command = buildSwitchCommand(mixer, inputNumber);
            if (command !== null) {
              await bridgeManager.sendCommand(mixer.bridgeInstanceId, command);
              return { ok: true, mixerId, activeSource: inputNumber };
            }
          }
          await registry.switchSource(mixerId, inputNumber);
          return { ok: true, mixerId, activeSource: inputNumber };
        } catch (err) {
          return { ok: false, error: err.message };
        }
      },
    },
  ];
}
