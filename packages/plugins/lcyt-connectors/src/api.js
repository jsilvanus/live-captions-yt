/**
 * lcyt-connectors — API Connectors & Variables plugin entry point.
 *
 * Usage in lcyt-backend:
 *   import {
 *     initConnectors, createConnectorsRouter, createVariablesRouter,
 *     createGlobalNetworkRulesRouter, createOrgNetworkRulesRouter,
 *   } from 'lcyt-connectors';
 *   const { bus, engine } = initConnectors(db, { filesControl });
 *   app.use('/connectors', createConnectorsRouter(db, auth));
 *   app.use('/variables', createVariablesRouter(db, auth, bus, engine));
 *   app.use('/admin/connector-network-rules', createGlobalNetworkRulesRouter(db, createAdminMiddleware(db, jwtSecret)));
 *   app.use(createOrgNetworkRulesRouter(db, createUserAuthMiddleware(jwtSecret)));
 *
 * The prefetch tier's repeating background loop (plan §1.2, §4) is owned by
 * the frontend (onPointerChanged sets/clears an interval calling
 * POST /variables/refresh) — there is no server-side loop to manage here.
 *
 * Every outbound connector HTTP call passes through network-guard.js's SSRF
 * guard first (loopback/private/link-local/reserved addresses blocked by
 * default, with admin-managed global and org-managed enforced overrides —
 * see this plugin's CLAUDE.md "Network policy" section).
 */
import { runMigrations } from './db.js';
import { VariablesBus } from './variables-bus.js';
import { createResolutionEngine } from './resolution-engine.js';
import { createTtlScheduler } from './ttl-scheduler.js';

export { createConnectorsRouter } from './routes/connectors.js';
export { createVariablesRouter } from './routes/variables.js';
export { createGlobalNetworkRulesRouter, createOrgNetworkRulesRouter } from './routes/network-rules.js';
export { VariablesBus } from './variables-bus.js';
export { createResolutionEngine } from './resolution-engine.js';
export { createTtlScheduler } from './ttl-scheduler.js';
export { checkUrlAllowed } from './network-guard.js';
export * from './db.js';
export { interpolate, interpolatePairs, extractVariableNames } from './interpolate.js';
export { parseValueTtl } from './ttl.js';

/**
 * Run migrations and wire up the bus + resolution engine.
 * @param {import('better-sqlite3').Database} db
 * @param {{ filesControl?: object }} [opts]
 */
export function initConnectors(db, opts = {}) {
  runMigrations(db);
  const bus = new VariablesBus();
  const engine = createResolutionEngine({ db, bus, filesControl: opts.filesControl || null });
  const scheduler = createTtlScheduler({ db, bus });
  scheduler.restore();
  return { bus, engine, scheduler };
}
