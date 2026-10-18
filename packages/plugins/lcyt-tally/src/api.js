/**
 * lcyt-tally — tally light plugin entry point.
 *
 *   import { initTally, createTallyRouter } from 'lcyt-tally';
 *   const { manager } = await initTally(db, { bridgeManager, getAccessToken, localMode });
 *   apiRouter.use('/tally', scopedAuth('tally'), requireProjectRole(db, 'setup'), createTallyRouter(db, auth, { manager }));
 *
 * A light is either a live signal (is the stream on, read from YouTube) or a
 * camera tally (program/preview of a switcher input). The engine is stream-light
 * (vendor/stream-light, MIT, shared with the standalone program). The tally_lights
 * table comes from lcyt-backend's schema.
 */
export { createTallyRouter, createTallyBridgeRouter } from './routes/tally.js';
export { createTallyManager, resolveRunner } from './manager.js';
export * from './db.js';
export { validateConfig, clashError } from './validate.js';

import { createTallyManager } from './manager.js';

/**
 * Create the manager and start the stored lights.
 * @param {import('lcyt-backend/db').Db} db
 * @param {object} [deps] see createTallyManager
 */
export async function initTally(db, deps = {}) {
  const manager = createTallyManager({ db, ...deps });
  await manager.start();
  return { manager };
}
