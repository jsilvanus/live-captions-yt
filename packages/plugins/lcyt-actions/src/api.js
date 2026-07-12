/**
 * lcyt-actions — Named Actions plugin entry point.
 *
 * Usage in lcyt-backend:
 *   import { initActions, createActionsRouter } from 'lcyt-actions';
 *   initActions(db);                                  // runs migrations
 *   app.use('/actions', createActionsRouter(db, auth));
 *
 * A named action is a project-scoped, reusable composite of metacode atoms
 * (see docs/plans/plan_named_actions.md). This plugin stores/serves the
 * definitions; parsing, @-ref expansion (with cycle guard), and send-time
 * execution live in the web client
 * (packages/lcyt-web/src/lib/metacode-actions.js + InputBar).
 */
import { runActionsMigrations } from './db.js';

export { createActionsRouter } from './routes/actions.js';
export * from './db.js';

/**
 * Run migrations for the action_defs table.
 * @param {import('better-sqlite3').Database} db
 */
export function initActions(db) {
  runActionsMigrations(db);
  return {};
}
