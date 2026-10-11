/**
 * lcyt-actions — Named Actions plugin entry point.
 *
 * Usage in lcyt-backend:
 *   import { initActions, createActionsRouter } from 'lcyt-actions';
 *   await initActions(db);                            // no-op: action_defs comes from lcyt-backend's schema
 *   app.use('/actions', createActionsRouter(db, auth, { executor, checkProjectRole }));
 *
 * A named action is a project-scoped, reusable composite of metacode atoms
 * (see docs/plans/plan_named_actions.md). This plugin stores/serves the
 * definitions and, via createActionExecutor() + POST /actions/run, runs them on
 * the server (docs/plans/plan_backend_actions.md). Parsing and @-ref expansion
 * (with cycle guard) are shared with the web client through 'lcyt/actions'.
 */
export { createActionsRouter } from './routes/actions.js';
export { createCueActionDispatcher, DEFAULT_COOLDOWN_MS, DEFAULT_CHAIN_WINDOW_MS, DEFAULT_MAX_DEPTH, DEFAULT_RATE_MAX_RUNS, DEFAULT_RATE_WINDOW_MS } from './cue-dispatcher.js';
export { createAuthoringGuard } from './authoring-guard.js';
export { createActionExecutor, currentCausation, parseWaitMs, MAX_WAIT_MS, DEFAULT_DEVICE_COOLDOWN_MS } from './executor.js';
export * from './db.js';

/**
 * Initialise the plugin. The action_defs table is part of lcyt-backend's schema, so there is
 * nothing to migrate; kept so the composition root has one call per plugin.
 * @param {import('lcyt-backend/db').Db} _db Prisma client
 */
export async function initActions(_db) {
  return {};
}
