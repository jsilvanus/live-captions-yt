/**
 * mixer.* tools — Setup Hub's Mixers card (Setup Assistant) and
 * Production Assistant's device-control tool (mixer.switch).
 *
 * mixer.switch goes through lcyt-production's ProductionCommands (the same
 * path as the HTTP route), which handles bridge-relayed dispatch.
 */

/**
 * @param {{ db, registry, commands, listMixers, getMixerById, createMixer, updateMixer, deleteMixer }} deps
 *   db + registry + commands (createProductionCommands) from 'lcyt-production'
 * @returns {Array<{ name, description, inputSchema, annotations, handler }>}
 */
export function createMixerTools(deps) {
  const { db, registry, commands, listMixers, getMixerById, createMixer, updateMixer, deleteMixer } = deps;

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
      handler: async ({ mixerId, inputNumber }, ctx) => {
        // Same path as the HTTP route: ownership check, bridge-vs-direct
        // routing and the production-follow (vertical crop) notification.
        const r = await commands.switchMixer(ctx?.apiKey ?? null, mixerId, inputNumber, { source: 'tool' });
        return r.ok ? { ok: true, mixerId, activeSource: inputNumber } : { ok: false, error: r.error };
      },
    },
  ];
}
