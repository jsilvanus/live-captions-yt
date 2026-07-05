/**
 * lcyt-connectors — API Connectors & Variables plugin entry point.
 *
 * Usage in lcyt-backend:
 *   import { initConnectors, createConnectorsRouter, createVariablesRouter } from 'lcyt-connectors';
 *   const { bus, engine } = initConnectors(db, { filesControl });
 *   app.use('/connectors', createConnectorsRouter(db, auth));
 *   app.use('/variables', createVariablesRouter(db, auth, bus, engine));
 *
 * The prefetch tier's repeating background loop (plan §1.2, §4) is owned by
 * the frontend (onPointerChanged sets/clears an interval calling
 * POST /variables/refresh) — there is no server-side loop to manage here.
 */
import { runMigrations } from './db.js';
import { VariablesBus } from './variables-bus.js';
import { createResolutionEngine } from './resolution-engine.js';

export { createConnectorsRouter } from './routes/connectors.js';
export { createVariablesRouter } from './routes/variables.js';
export { VariablesBus } from './variables-bus.js';
export { createResolutionEngine } from './resolution-engine.js';
export * from './db.js';
export { interpolate, interpolatePairs, extractVariableNames } from './interpolate.js';

/**
 * Run migrations and wire up the bus + resolution engine.
 * @param {import('better-sqlite3').Database} db
 * @param {{ filesControl?: object }} [opts]
 */
export function initConnectors(db, opts = {}) {
  runMigrations(db);
  const bus = new VariablesBus();
  const engine = createResolutionEngine({ db, bus, filesControl: opts.filesControl || null });
  return { bus, engine };
}
