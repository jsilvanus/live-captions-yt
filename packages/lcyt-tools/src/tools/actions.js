/**
 * action.run — run a project's named action (or an inline `|` expression) on the
 * server, the same ActionExecutor behind POST /actions/run. Server atoms (camera,
 * mixer, crop, api, wait) execute; browser atoms are returned in `clientAtoms`.
 *
 * Deliberately not on the Production Assistant's default tool list: it can move
 * cameras, so a role must opt in through its toolAllowlist.
 */

/**
 * @param {{ executor: { run: Function } | (() => { run: Function } | null) }} deps
 *   executor may be a getter because the executor is built after the tool registry
 * @returns {Array<{ name, description, inputSchema, annotations, handler }>}
 */
export function createActionTools(deps) {
  const getExecutor = () => (typeof deps.executor === 'function' ? deps.executor() : deps.executor);

  return [
    {
      name: 'action.run',
      description: 'Run a named action (ref, e.g. "intro") or an inline composite expression (expr, e.g. "camera:pulpit.wide | wait:2s | mixer:main.2") on the server. Steps run in order; a failed step does not stop the rest unless stopOnError is true. Atoms meant for a browser (audio, section, variables) are returned in clientAtoms.',
      inputSchema: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Slug of a named action' },
          expr: { type: 'string', description: 'Inline composite expression; used when ref is not given' },
          stopOnError: { type: 'boolean' },
        },
      },
      annotations: { destructiveHint: true },
      handler: async ({ ref, expr, stopOnError }, ctx) => {
        const executor = getExecutor();
        if (!executor) return { ok: false, error: 'Action runner is not available' };
        if (!ref && !expr) return { ok: false, error: 'ref or expr is required' };
        return executor.run(ctx.apiKey, { ref, expr }, { source: 'tool', stopOnError: stopOnError === true });
      },
    },
  ];
}
