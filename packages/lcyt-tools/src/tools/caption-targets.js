/**
 * caption_target.* tools — Setup Hub's CC/Targets tab (plan/ai_roles_framework's
 * Setup Assistant role). Handlers close over the caller's apiKey; a tool never
 * accepts a project id as an argument.
 */

/**
 * @param {{ db, getCaptionTargets, createCaptionTarget, updateCaptionTarget, deleteCaptionTarget }} deps
 *   db + the caption-target DB helpers from 'lcyt-backend/db'
 * @returns {Array<{ name, description, inputSchema, annotations, handler }>}
 */
export function createCaptionTargetTools(deps) {
  const { db, getCaptionTargets, createCaptionTarget, updateCaptionTarget, deleteCaptionTarget } = deps;

  return [
    {
      name: 'caption_target.list',
      description: 'List configured caption delivery targets (YouTube, generic webhook, viewer page) for this project.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      handler: (_args, { apiKey }) => ({ ok: true, targets: getCaptionTargets(db, apiKey) }),
    },
    {
      name: 'caption_target.create',
      description: 'Create a caption delivery target: type "youtube" (needs streamKey), "generic" (needs url, optional headers), or "viewer" (needs viewerKey).',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['youtube', 'generic', 'viewer'] },
          enabled: { type: 'boolean' },
          streamKey: { type: 'string' },
          url: { type: 'string' },
          headers: { type: 'object' },
          viewerKey: { type: 'string' },
          noBatch: { type: 'boolean' },
        },
        required: ['type'],
      },
      annotations: {},
      handler: (args, { apiKey }) => createCaptionTarget(db, apiKey, args),
    },
    {
      name: 'caption_target.update',
      description: 'Update an existing caption delivery target (enabled state or type-specific fields). type is immutable.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          enabled: { type: 'boolean' },
          streamKey: { type: 'string' },
          url: { type: 'string' },
          headers: { type: 'object' },
          viewerKey: { type: 'string' },
          noBatch: { type: 'boolean' },
        },
        required: ['id'],
      },
      annotations: {},
      handler: ({ id, ...patch }, { apiKey }) => updateCaptionTarget(db, apiKey, id, patch),
    },
    {
      name: 'caption_target.delete',
      description: 'Delete a caption delivery target.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      annotations: { destructiveHint: true },
      handler: ({ id }, { apiKey }) => ({ ok: deleteCaptionTarget(db, apiKey, id) }),
    },
  ];
}
