/**
 * dsk_template.* tools — Graphics Editor Assistant (dsk_designer role).
 * Thin wrappers around AgentEngine.generateTemplate/editTemplate/suggestStyles
 * (already implemented, Phase 5 of plan_agent.md) — these tools don't persist
 * anything, they just return template JSON for the turn loop / the frontend
 * to act on, exactly like POST /agent/generate-template et al. already do.
 */

/**
 * @param {{ agent: import('lcyt-agent').AgentEngine }} deps
 * @returns {Array<{ name, description, inputSchema, annotations, handler }>}
 */
export function createDskTemplateTools(deps) {
  const { agent } = deps;

  return [
    {
      name: 'dsk_template.generate',
      description: 'Generate a new DSK overlay template (lower-third, etc.) from a natural-language prompt. Returns template JSON, does not save it.',
      inputSchema: {
        type: 'object',
        properties: { prompt: { type: 'string' }, width: { type: 'number' }, height: { type: 'number' } },
        required: ['prompt'],
      },
      annotations: {},
      handler: async ({ prompt, width, height }, { apiKey }) => {
        const template = await agent.generateTemplate(apiKey, prompt, { width, height });
        return { ok: true, template };
      },
    },
    {
      name: 'dsk_template.edit',
      description: 'Edit an existing DSK template JSON per a natural-language instruction. Returns the modified template JSON, does not save it.',
      inputSchema: {
        type: 'object',
        properties: { template: { type: 'object' }, prompt: { type: 'string' } },
        required: ['template', 'prompt'],
      },
      annotations: {},
      handler: async ({ template, prompt }, { apiKey }) => {
        const out = await agent.editTemplate(apiKey, template, prompt);
        return { ok: true, template: out };
      },
    },
    {
      name: 'dsk_template.suggest_styles',
      description: 'Suggest color scheme / font pairing / layout style variations for a DSK template.',
      inputSchema: { type: 'object', properties: { template: { type: 'object' } }, required: ['template'] },
      annotations: { readOnlyHint: true },
      handler: async ({ template }, { apiKey }) => {
        const suggestions = await agent.suggestStyles(apiKey, template);
        return { ok: true, suggestions };
      },
    },
  ];
}
