/**
 * lcyt-actions — Named Actions plugin entry point.
 *
 * Usage in lcyt-backend:
 *   import { initActions, createActionsRouter } from 'lcyt-actions';
 *   initActions(db);                                  // runs migrations
 *   app.use('/actions', createActionsRouter(db, auth, { executor, checkProjectRole }));
 *
 * A named action is a project-scoped, reusable composite of metacode atoms
 * (see docs/plans/plan_named_actions.md). This plugin stores/serves the
 * definitions and, via createActionExecutor() + POST /actions/run, runs them on
 * the server (docs/plans/plan_backend_actions.md). Parsing and @-ref expansion
 * (with cycle guard) are shared with the web client through 'lcyt/actions'.
 */
import { runActionsMigrations } from './db.js';

export { createActionsRouter } from './routes/actions.js';
export { createCueActionDispatcher, DEFAULT_COOLDOWN_MS, DEFAULT_CHAIN_WINDOW_MS, DEFAULT_MAX_DEPTH } from './cue-dispatcher.js';
export { createAuthoringGuard } from './authoring-guard.js';
export { createActionExecutor, currentCausation, parseWaitMs, MAX_WAIT_MS, DEFAULT_DEVICE_COOLDOWN_MS } from './executor.js';
export * from './db.js';

/**
 * Run migrations for the action_defs table.
 * @param {import('better-sqlite3').Database} db
 */
export function initActions(db) {
  runActionsMigrations(db);
  return {};
}
